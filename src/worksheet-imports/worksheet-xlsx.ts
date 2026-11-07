import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { SaxesParser, type SaxesTagNS } from 'saxes';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import { IMPORT_LIMITS } from '../catalog-import/import.types.js';
import { ErrorCodes, type ErrorCode } from '../common/http/error-codes.js';
import { ApplicationFailure } from '../common/http/public-error.js';
import {
  displayText,
  type ImportField,
  type ImportTable,
  type TypedCell,
} from './worksheet-imports.types.js';

const MiB = 1024 * 1024;

/**
 * Límites de [12] para el ZIP (plan imports&exports 01, D12). El tamaño
 * comprimido es el de la subida (`IMPORT_LIMITS.fileBytes`, 10 MiB). Son de
 * lanzamiento: el peor caso medido en el spike (5.000 × 200) descomprime
 * 37,8 MiB, con un ratio de 7:1, y se lee en menos de 1 s.
 */
export const XLSX_LIMITS = {
  uncompressedBytes: 50 * MiB,
  entries: 1000,
  compressionRatio: 100,
  readMs: 60_000,
} as const;

/** Qué hoja leer y en qué fila de Excel están las cabeceras (D11). */
export type SheetChoice = Readonly<{ sheet: string | null; headerRow: number }>;

/** Sin hoja elegida en un libro de varias, `sheet` y `table` son `null`. */
export type XlsxRead = Readonly<{
  sheets: readonly string[];
  sheet: string | null;
  table: ImportTable | null;
}>;

/** `PK\3\4`: cabecera local de un ZIP, que es lo que es un `.xlsx`. */
const ZIP_SIGNATURE = Buffer.from('504b0304', 'hex');
/** Contenedor CFB (OLE): un Office cifrado con contraseña o un `.xls` antiguo. */
const COMPOUND_FILE_SIGNATURE = Buffer.from('d0cf11e0a1b11ae1', 'hex');

const CONTENT_TYPES_PART = '[Content_Types].xml';
const WORKBOOK_PART = 'xl/workbook.xml';
const WORKBOOK_RELS_PART = 'xl/_rels/workbook.xml.rels';
const SHARED_STRINGS_PART = 'xl/sharedStrings.xml';
const STYLES_PART = 'xl/styles.xml';

/** Partes que ejecutan código o leen de fuera: un `.xlsx` de datos no las tiene (C32). */
const ACTIVE_PART_PATTERN =
  /(^|\/)(vbaProject\.bin|externalLinks\/|activeX\/|embeddings\/)/i;
const MACRO_CONTENT_TYPE_PATTERN = /macroEnabled|vbaProject/i;

/**
 * Formatos de número que Excel trae de serie y son fechas (ECMA-376, números
 * de formato predefinidos). Los propios se reconocen por su código.
 */
const BUILT_IN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57,
]);

/** `B12` → columna `B` y fila `12`. */
const CELL_REFERENCE_PATTERN = /^([A-Z]{1,3})(\d+)$/;
/** Número tal como lo escribe Excel en `<v>`, con exponente opcional. */
const NUMBER_PATTERN = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;
const ISO_DATE_CELL_PATTERN = /^(\d{4}-\d{2}-\d{2})(T00:00(:00(\.0+)?)?Z?)?$/;
/** Escape de ST_Xstring: `_x` + cuatro cifras hexadecimales + `_`. */
const XSTRING_ESCAPE_PATTERN = /_x([0-9A-Fa-f]{4})_/g;

/** Columnas de Excel: de `A` a `XFD`. */
const MAX_COLUMN_INDEX = 16_383;
const MAX_HEADER_LENGTH = 128;

const DAY_MS = 86_400_000;
/**
 * Excel 1900 cuenta un 29/02/1900 que no existió (serie 60): desde la serie
 * 61 (01/03/1900) las fechas salen de este origen. Las anteriores no se
 * aceptan. En el sistema 1904 la serie 0 es el 01/01/1904 (F65).
 */
const EPOCH_1900 = Date.UTC(1899, 11, 30);
const FIRST_RELIABLE_1900_SERIAL = 61;
const EPOCH_1904 = Date.UTC(1904, 0, 1);
const LAST_DATE_MS = Date.UTC(9999, 11, 31);

export function isXlsxContent(content: Buffer) {
  return content.subarray(0, 4).equals(ZIP_SIGNATURE);
}

export function isCompoundFile(content: Buffer) {
  return content.subarray(0, 8).equals(COMPOUND_FILE_SIGNATURE);
}

/**
 * Lee una hoja de un XLSX (plan imports&exports 01, D11–D13). Antes de
 * descomprimir nada comprueba el ZIP y rechaza el contenido activo; después
 * lee el libro, elige la hoja y la recorre por trozos. Al primer problema del
 * archivo lanza; los problemas de una celda viajan en la tabla.
 */
export async function readWorksheetXlsx(
  content: Buffer,
  choice: SheetChoice,
): Promise<XlsxRead> {
  if (content.length > IMPORT_LIMITS.fileBytes) {
    throw new ApplicationFailure(ErrorCodes.IMPORT_FILE_TOO_LARGE);
  }
  const zip = await XlsxPackage.open(content);
  try {
    assertNoMacroContentType(await zip.text(CONTENT_TYPES_PART));
    const workbook = parseWorkbook(await zip.text(WORKBOOK_PART));
    const sheets = workbook.sheets.map(({ name }) => name);
    const sheet = chooseSheet(workbook.sheets, choice.sheet);
    if (!sheet) {
      return { sheets, sheet: null, table: null };
    }

    const relationships = parseRelationships(
      await zip.text(WORKBOOK_RELS_PART),
    );
    const cellContext: CellContext = {
      strings: parseSharedStrings(await zip.optionalText(SHARED_STRINGS_PART)),
      dateStyles: parseDateStyles(await zip.optionalText(STYLES_PART)),
      date1904: workbook.date1904,
    };
    const rows = await readSheetRows(
      zip,
      sheetPartOf(sheet, relationships),
      cellContext,
      choice.headerRow,
    );
    return {
      sheets,
      sheet: sheet.name,
      table: toTable(rows, choice.headerRow, content),
    };
  } finally {
    zip.close();
  }
}

function fail(code: ErrorCode): never {
  throw new ApplicationFailure(code);
}

// ── Paquete ZIP ──

/**
 * El ZIP abierto, ya comprobado, con el plazo de lectura de todo el libro.
 * El tamaño no se vuelve a contar al descomprimir: el total declarado ya está
 * acotado y yauzl falla si una entrada da más de lo que declara (F62).
 */
class XlsxPackage {
  private readonly deadline = Date.now() + XLSX_LIMITS.readMs;

  private constructor(
    private readonly zip: ZipFile,
    private readonly entries: ReadonlyMap<string, Entry>,
  ) {}

  /** Comprueba el directorio central antes de descomprimir ninguna parte. */
  static async open(content: Buffer): Promise<XlsxPackage> {
    const zip = await openZip(content);
    try {
      const entries = await listEntries(zip);
      assertWithinLimits(content, entries);
      assertNoActiveParts(entries);
      return new XlsxPackage(zip, entries);
    } catch (error) {
      zip.close();
      throw error;
    }
  }

  /** Una parte que el libro debe tener. */
  async text(name: string): Promise<string> {
    const text = await this.optionalText(name);
    return text ?? fail(ErrorCodes.XLSX_INVALID);
  }

  async optionalText(name: string): Promise<string | null> {
    if (!this.entries.has(name)) {
      return null;
    }
    const decoder = new Utf8Decoder();
    let text = '';
    await this.stream(name, (chunk) => {
      text += decoder.decode(chunk);
    });
    return text + decoder.finish();
  }

  /**
   * Descomprime una parte por trozos y se para al pasar el plazo. Un error de
   * `onChunk` (por ejemplo, pasar de 5.000 filas) corta la lectura.
   */
  async stream(name: string, onChunk: (chunk: Buffer) => void): Promise<void> {
    const entry = this.entries.get(name) ?? fail(ErrorCodes.XLSX_INVALID);
    const stream = await this.openStream(entry);
    try {
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        this.assertOnTime();
        onChunk(chunk);
      }
    } catch (error) {
      stream.destroy();
      throw error instanceof ApplicationFailure
        ? error
        : new ApplicationFailure(ErrorCodes.XLSX_INVALID);
    }
  }

  close() {
    this.zip.close();
  }

  private async openStream(entry: Entry): Promise<Readable> {
    try {
      return await this.zip.openReadStreamPromise(entry);
    } catch {
      return fail(ErrorCodes.XLSX_INVALID);
    }
  }

  private assertOnTime() {
    if (Date.now() > this.deadline) {
      fail(ErrorCodes.XLSX_LIMITS_EXCEEDED);
    }
  }
}

async function openZip(content: Buffer): Promise<ZipFile> {
  try {
    return await yauzl.fromBufferPromise(content, {
      lazyEntries: true,
      validateEntrySizes: true,
      strictFileNames: true,
    });
  } catch {
    return fail(ErrorCodes.XLSX_INVALID);
  }
}

/** Con `lazyEntries`, cada entrada llega al pedirla: se para en la 1.001. */
function listEntries(zip: ZipFile): Promise<Map<string, Entry>> {
  return new Promise((resolve, reject) => {
    const entries = new Map<string, Entry>();
    zip.on('entry', (entry: Entry) => {
      if (entries.size >= XLSX_LIMITS.entries) {
        reject(new ApplicationFailure(ErrorCodes.XLSX_LIMITS_EXCEEDED));
        return;
      }
      entries.set(entry.fileName, entry);
      zip.readEntry();
    });
    zip.on('end', () => resolve(entries));
    zip.on('error', () =>
      reject(new ApplicationFailure(ErrorCodes.XLSX_INVALID)),
    );
    zip.readEntry();
  });
}

/**
 * Lo declarado en el directorio central: ninguna entrada cifrada, como mucho
 * 50 MiB en total y un ratio de 100:1 sobre el archivo. Una bomba de 300 KB
 * que se expande a 300 MiB se rechaza aquí sin descomprimir nada.
 */
function assertWithinLimits(
  content: Buffer,
  entries: ReadonlyMap<string, Entry>,
) {
  let declaredBytes = 0;
  for (const entry of entries.values()) {
    if (entry.isEncrypted()) {
      fail(ErrorCodes.XLSX_ENCRYPTED);
    }
    declaredBytes += entry.uncompressedSize;
  }
  const isTooLarge = declaredBytes > XLSX_LIMITS.uncompressedBytes;
  const isTooCompressed =
    declaredBytes > XLSX_LIMITS.compressionRatio * content.length;
  if (isTooLarge || isTooCompressed) {
    fail(ErrorCodes.XLSX_LIMITS_EXCEEDED);
  }
}

function assertNoActiveParts(entries: ReadonlyMap<string, Entry>) {
  for (const name of entries.keys()) {
    if (ACTIVE_PART_PATTERN.test(name)) {
      fail(ErrorCodes.XLSX_ACTIVE_CONTENT);
    }
  }
}

function assertNoMacroContentType(contentTypes: string) {
  if (MACRO_CONTENT_TYPE_PATTERN.test(contentTypes)) {
    fail(ErrorCodes.XLSX_ACTIVE_CONTENT);
  }
}

/**
 * UTF-8 estricto por trozos: un carácter puede quedar partido entre dos
 * trozos. Un byte inválido es un libro inválido, no un error interno.
 */
class Utf8Decoder {
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });

  decode(chunk: Buffer): string {
    return this.run(() => this.decoder.decode(chunk, { stream: true }));
  }

  finish(): string {
    return this.run(() => this.decoder.decode());
  }

  private run(decode: () => string): string {
    try {
      return decode();
    } catch {
      return fail(ErrorCodes.XLSX_INVALID);
    }
  }
}

// ── XML ──

type XmlHandlers = Readonly<{
  open?: (tag: SaxesTagNS) => void;
  close?: (tag: SaxesTagNS) => void;
  text?: (text: string) => void;
}>;

/**
 * Parser con espacios de nombres para leer nombres locales: hay generadores
 * que escriben `<x:c>` en vez de `<c>`. saxes no expande entidades de un DTD
 * (F63), y además cualquier `DOCTYPE` se rechaza: un libro de Excel no lo usa.
 */
function xmlParser(handlers: XmlHandlers) {
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => fail(ErrorCodes.XLSX_ACTIVE_CONTENT));
  parser.on('error', () => fail(ErrorCodes.XLSX_INVALID));
  if (handlers.open) parser.on('opentag', handlers.open);
  if (handlers.close) parser.on('closetag', handlers.close);
  if (handlers.text) parser.on('text', handlers.text);
  return parser;
}

function parseXml(xml: string, handlers: XmlHandlers) {
  xmlParser(handlers).write(xml).close();
}

function attributeOf(tag: SaxesTagNS, local: string): string | undefined {
  for (const attribute of Object.values(tag.attributes)) {
    if (attribute.local === local) {
      return attribute.value;
    }
  }
  return undefined;
}

// ── Libro: hojas, relaciones, cadenas y estilos ──

type SheetEntry = Readonly<{ name: string; relationshipId: string }>;

function parseWorkbook(xml: string) {
  const sheets: SheetEntry[] = [];
  let date1904 = false;
  parseXml(xml, {
    open: (tag) => {
      if (tag.local === 'workbookPr') {
        const value = attributeOf(tag, 'date1904');
        date1904 = value === '1' || value === 'true';
      }
      if (tag.local === 'sheet') {
        const name = attributeOf(tag, 'name');
        const relationshipId = attributeOf(tag, 'id');
        if (!name || !relationshipId) {
          fail(ErrorCodes.XLSX_INVALID);
        }
        sheets.push({ name, relationshipId });
      }
    },
  });
  if (sheets.length === 0) {
    fail(ErrorCodes.XLSX_INVALID);
  }
  return { sheets, date1904 };
}

/** Sin nombre, solo se elige sola la hoja de un libro que tiene una (C31). */
function chooseSheet(
  sheets: readonly SheetEntry[],
  name: string | null,
): SheetEntry | null {
  if (name === null) {
    return sheets.length === 1 ? sheets[0] : null;
  }
  return (
    sheets.find((sheet) => sheet.name === name) ??
    fail(ErrorCodes.XLSX_SHEET_NOT_FOUND)
  );
}

function parseRelationships(xml: string) {
  const targets = new Map<string, string>();
  parseXml(xml, {
    open: (tag) => {
      const id = attributeOf(tag, 'Id');
      const target = attributeOf(tag, 'Target');
      if (tag.local === 'Relationship' && id && target) {
        targets.set(id, target);
      }
    },
  });
  return targets;
}

/** `worksheets/sheet1.xml` o `/xl/worksheets/sheet1.xml` → `xl/worksheets/sheet1.xml`. */
function sheetPartOf(
  sheet: SheetEntry,
  relationships: ReadonlyMap<string, string>,
) {
  const target =
    relationships.get(sheet.relationshipId) ?? fail(ErrorCodes.XLSX_INVALID);
  return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
}

/**
 * Cada `<si>` es una cadena; con formato, son varios `<r><t>` que se unen.
 * La guía fonética (`<rPh>`) no forma parte del texto.
 */
function parseSharedStrings(xml: string | null): string[] {
  const strings: string[] = [];
  if (xml === null) {
    return strings;
  }
  let current = '';
  let inText = false;
  let inPhonetic = false;
  parseXml(xml, {
    open: (tag) => {
      if (tag.local === 'si') current = '';
      if (tag.local === 'rPh') inPhonetic = true;
      if (tag.local === 't' && !inPhonetic) inText = true;
    },
    close: (tag) => {
      if (tag.local === 'si') strings.push(unescapeXstring(current));
      if (tag.local === 'rPh') inPhonetic = false;
      if (tag.local === 't') inText = false;
    },
    text: (text) => {
      if (inText) current += text;
    },
  });
  return strings;
}

/** Índices de `cellXfs` cuyo formato de número es una fecha. */
function parseDateStyles(xml: string | null): Set<number> {
  const dateStyles = new Set<number>();
  if (xml === null) {
    return dateStyles;
  }
  const customFormats = new Map<number, string>();
  let inCellFormats = false;
  let index = 0;
  parseXml(xml, {
    open: (tag) => {
      if (tag.local === 'numFmt') {
        customFormats.set(
          Number(attributeOf(tag, 'numFmtId')),
          attributeOf(tag, 'formatCode') ?? '',
        );
      }
      if (tag.local === 'cellXfs') inCellFormats = true;
      if (tag.local === 'xf' && inCellFormats) {
        const formatId = Number(attributeOf(tag, 'numFmtId') ?? 0);
        const isDate =
          BUILT_IN_DATE_FORMATS.has(formatId) ||
          isDateFormatCode(customFormats.get(formatId));
        if (isDate) dateStyles.add(index);
        index += 1;
      }
    },
    close: (tag) => {
      if (tag.local === 'cellXfs') inCellFormats = false;
    },
  });
  return dateStyles;
}

/**
 * `dd/mm/yyyy` es fecha; `0.00 "días"` no: el texto entre comillas, los
 * corchetes (colores, condiciones) y los caracteres escapados no cuentan.
 */
function isDateFormatCode(code: string | undefined) {
  if (!code) {
    return false;
  }
  const bare = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
  return /[dmyhs]/i.test(bare);
}

// ── Hoja: filas y celdas ──

type CellContext = Readonly<{
  strings: readonly string[];
  dateStyles: ReadonlySet<number>;
  date1904: boolean;
}>;

/** Una fila de Excel con sus celdas por índice de columna (desde 0). */
type SheetRow = Readonly<{
  excelRow: number;
  cells: ReadonlyMap<number, ImportField>;
}>;

/** La celda mientras se lee: su tipo, su estilo y el texto de `<v>` o `<is>`. */
type PendingCell = {
  column: number;
  type: string;
  style: number;
  hasFormula: boolean;
  hasValue: boolean;
  raw: string;
};

/**
 * Recorre la hoja por trozos sin construir un árbol. Las filas anteriores a
 * la cabecera no se guardan; al pasar de 5.000 filas de datos se para.
 */
async function readSheetRows(
  zip: XlsxPackage,
  part: string,
  context: CellContext,
  headerRow: number,
): Promise<SheetRow[]> {
  const rows: SheetRow[] = [];
  const reader = new SheetReader(context, (row) => {
    if (row.excelRow < headerRow || row.cells.size === 0) {
      return;
    }
    rows.push(row);
    const dataRows = rows.length - 1;
    if (dataRows > IMPORT_LIMITS.rows) {
      fail(ErrorCodes.XLSX_ROW_LIMIT);
    }
  });
  const parser = xmlParser(reader.handlers);
  const decoder = new Utf8Decoder();
  await zip.stream(part, (chunk) => {
    parser.write(decoder.decode(chunk));
  });
  parser.write(decoder.finish()).close();
  return rows;
}

/**
 * Estado del recorrido de una hoja: fila y celda en curso. Las referencias
 * (`r="C5"`) son opcionales en el estándar: sin ellas, la posición sigue a la
 * anterior.
 */
class SheetReader {
  private excelRow = 0;
  private nextColumn = 0;
  private cells = new Map<number, ImportField>();
  private cell: PendingCell | null = null;
  private collecting = false;
  private inPhonetic = false;

  readonly handlers: XmlHandlers = {
    open: (tag) => this.open(tag),
    close: (tag) => this.close(tag),
    text: (text) => {
      if (this.collecting && this.cell) this.cell.raw += text;
    },
  };

  constructor(
    private readonly context: CellContext,
    private readonly onRow: (row: SheetRow) => void,
  ) {}

  private open(tag: SaxesTagNS) {
    switch (tag.local) {
      case 'row':
        this.startRow(attributeOf(tag, 'r'));
        break;
      case 'c':
        this.startCell(tag);
        break;
      case 'f':
        if (this.cell) this.cell.hasFormula = true;
        break;
      case 'rPh':
        this.inPhonetic = true;
        break;
      case 'v':
        this.startValue();
        break;
      case 't':
        if (this.cell?.type === 'inlineStr' && !this.inPhonetic) {
          this.startValue();
        }
        break;
    }
  }

  private close(tag: SaxesTagNS) {
    switch (tag.local) {
      case 'v':
      case 't':
        this.collecting = false;
        break;
      case 'rPh':
        this.inPhonetic = false;
        break;
      case 'c':
        this.finishCell();
        break;
      case 'row':
        this.onRow({ excelRow: this.excelRow, cells: this.cells });
        break;
    }
  }

  private startRow(reference: string | undefined) {
    this.excelRow = reference ? Number(reference) : this.excelRow + 1;
    if (!Number.isInteger(this.excelRow) || this.excelRow < 1) {
      fail(ErrorCodes.XLSX_INVALID);
    }
    this.nextColumn = 0;
    this.cells = new Map();
  }

  private startCell(tag: SaxesTagNS) {
    const column = columnOf(attributeOf(tag, 'r'), this.nextColumn);
    this.nextColumn = column + 1;
    this.cell = {
      column,
      type: attributeOf(tag, 't') ?? 'n',
      style: Number(attributeOf(tag, 's') ?? 0),
      hasFormula: false,
      hasValue: false,
      raw: '',
    };
  }

  private startValue() {
    if (this.cell) {
      this.cell.hasValue = true;
      this.collecting = true;
    }
  }

  /** Una celda vacía no se guarda: es lo mismo que no tenerla. */
  private finishCell() {
    if (!this.cell) {
      return;
    }
    const field = fieldOf(this.cell, this.context);
    if (field !== '') {
      this.cells.set(this.cell.column, field);
    }
    this.cell = null;
  }
}

/** `C5` → 2; sin referencia, la columna siguiente a la anterior. */
function columnOf(reference: string | undefined, next: number) {
  if (reference === undefined) {
    return next;
  }
  const match = CELL_REFERENCE_PATTERN.exec(reference);
  if (!match) {
    fail(ErrorCodes.XLSX_INVALID);
  }
  let column = 0;
  for (const letter of match[1]) {
    column = column * 26 + (letter.charCodeAt(0) - 64);
  }
  if (column - 1 > MAX_COLUMN_INDEX) {
    fail(ErrorCodes.XLSX_INVALID);
  }
  return column - 1;
}

/**
 * Celda → campo de importación según su tipo (F64, D13). Una fórmula sin
 * valor guardado no se calcula: se marca para que la fila tenga un problema.
 */
function fieldOf(cell: PendingCell, context: CellContext): ImportField {
  if (!cell.hasValue) {
    return cell.hasFormula ? { kind: 'uncalculated', text: '' } : '';
  }
  switch (cell.type) {
    case 's':
      return sharedString(context.strings, cell.raw);
    case 'str':
    case 'inlineStr':
      return unescapeXstring(cell.raw);
    case 'b':
      return booleanCell(cell.raw);
    case 'e':
      return { kind: 'error', text: cell.raw };
    case 'd':
      return isoDateCell(cell.raw);
    case 'n':
      return numberCell(cell, context);
    default:
      return fail(ErrorCodes.XLSX_INVALID);
  }
}

/**
 * `_x000D_` → retorno de carro (MS-OI29500, ST_Xstring): así escribe Excel los
 * caracteres que no caben en XML, y `_x005F_` delante de un `_xHHHH_` literal.
 * Se lee de izquierda a derecha, así que `_x005F_x0041_` vuelve a ser
 * `_x0041_`. PostgreSQL no admite NUL: un `_x0000_` hace inválido el archivo,
 * como un NUL en un CSV.
 */
function unescapeXstring(text: string) {
  return text.replace(XSTRING_ESCAPE_PATTERN, (_escape, hex: string) => {
    const code = Number.parseInt(hex, 16);
    if (code === 0) {
      fail(ErrorCodes.XLSX_INVALID);
    }
    return String.fromCharCode(code);
  });
}

function sharedString(strings: readonly string[], raw: string): string {
  const index = Number(raw);
  const isKnownIndex = Number.isInteger(index) && index >= 0;
  return (
    (isKnownIndex ? strings[index] : undefined) ?? fail(ErrorCodes.XLSX_INVALID)
  );
}

function booleanCell(raw: string): TypedCell {
  if (raw !== '0' && raw !== '1') {
    fail(ErrorCodes.XLSX_INVALID);
  }
  return { kind: 'boolean', text: raw === '1' ? 'true' : 'false' };
}

/** `t="d"` (Office 2010): texto ISO; sin hora, es una fecha civil. */
function isoDateCell(raw: string): ImportField {
  const match = ISO_DATE_CELL_PATTERN.exec(raw);
  return match ? { kind: 'date', text: match[1] } : raw;
}

/**
 * Un número con estilo de fecha y serie entera es una fecha; con decimales
 * lleva hora y no se trunca: sigue siendo un número (y no entrará en una
 * columna de fecha).
 */
function numberCell(cell: PendingCell, context: CellContext): ImportField {
  const text = plainDecimal(cell.raw);
  if (context.dateStyles.has(cell.style)) {
    const date = dateOfSerial(text, context.date1904);
    if (date !== null) {
      return { kind: 'date', text: date };
    }
  }
  return { kind: 'number', text };
}

/**
 * `1.5E-3` → `0.0015`, moviendo la coma sobre los dígitos escritos: nada se
 * redondea. Sin exponente, el texto se deja tal cual; lo que no tiene forma
 * de número también, y la columna lo rechazará.
 */
export function plainDecimal(raw: string): string {
  const match = NUMBER_PATTERN.exec(raw);
  const exponentText = match?.[4];
  if (!match || exponentText === undefined) {
    return raw;
  }
  const [, sign, whole, fraction = ''] = match;
  const exponent = Number(exponentText);
  // Un double no pasa de 1e308: un exponente mayor no es un número de Excel.
  if (Math.abs(exponent) > 400) {
    return raw;
  }
  const digits = whole + fraction;
  const point = whole.length + exponent;
  let integerPart: string;
  let fractionPart: string;
  if (point <= 0) {
    integerPart = '0';
    fractionPart = '0'.repeat(-point) + digits;
  } else if (point >= digits.length) {
    integerPart = digits + '0'.repeat(point - digits.length);
    fractionPart = '';
  } else {
    integerPart = digits.slice(0, point);
    fractionPart = digits.slice(point);
  }
  integerPart = integerPart.replace(/^0+(?=\d)/, '');
  fractionPart = fractionPart.replace(/0+$/, '');
  const isZero = /^0$/.test(integerPart) && fractionPart === '';
  const body = fractionPart ? `${integerPart}.${fractionPart}` : integerPart;
  return isZero ? '0' : `${sign}${body}`;
}

/** Serie entera de Excel → `YYYY-MM-DD`, o `null` si no es una fecha fiable. */
export function dateOfSerial(text: string, date1904: boolean): string | null {
  if (!/^\d+$/.test(text)) {
    return null;
  }
  const serial = Number(text);
  if (!date1904 && serial < FIRST_RELIABLE_1900_SERIAL) {
    return null;
  }
  const time = (date1904 ? EPOCH_1904 : EPOCH_1900) + serial * DAY_MS;
  if (time > LAST_DATE_MS) {
    return null;
  }
  return new Date(time).toISOString().slice(0, 10);
}

// ── Tabla ──

/**
 * Las filas leídas → cabeceras y filas de datos, como el CSV. Las cabeceras
 * siguen las reglas del CSV (únicas, no vacías, como mucho 200 y 128
 * caracteres). Un dato a la derecha de la última cabecera es un error de
 * cabeceras: no hay a qué columna llevarlo y no se descarta en silencio.
 */
function toTable(
  rows: readonly SheetRow[],
  headerRow: number,
  content: Buffer,
): ImportTable {
  const [header, ...dataRows] = rows;
  if (!header || header.excelRow !== headerRow || dataRows.length === 0) {
    fail(ErrorCodes.XLSX_EMPTY);
  }
  const headers = headerTexts(header);
  for (const row of dataRows) {
    const hasDataBeyondHeaders = [...row.cells.keys()].some(
      (column) => column >= headers.length,
    );
    if (hasDataBeyondHeaders) {
      fail(ErrorCodes.CSV_HEADERS_INVALID);
    }
  }
  return {
    format: 'xlsx',
    headers,
    rows: dataRows.map(({ cells }) =>
      headers.map((_, column) => cells.get(column) ?? ''),
    ),
    fileHash: createHash('sha256').update(content).digest('hex'),
    fileBytes: content.length,
  };
}

function headerTexts(row: SheetRow): string[] {
  const width = Math.max(...row.cells.keys()) + 1;
  const headers: string[] = [];
  for (let column = 0; column < width; column += 1) {
    const cell = row.cells.get(column);
    headers.push(cell === undefined ? '' : displayText(cell));
  }
  const hasTooManyColumns = headers.length > IMPORT_LIMITS.columns;
  const hasInvalidName = headers.some(
    (header) => !header.trim() || header.length > MAX_HEADER_LENGTH,
  );
  const hasRepeatedName = new Set(headers).size !== headers.length;
  if (hasTooManyColumns || hasInvalidName || hasRepeatedName) {
    fail(ErrorCodes.CSV_HEADERS_INVALID);
  }
  return headers;
}
