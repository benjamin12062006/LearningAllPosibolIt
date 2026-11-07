import type { ByteSink } from '../artifacts/artifacts.types.js';
import type { ExportCell } from './export-cells.js';
import { ZipWriter } from './zip-writer.js';

/** Las filas de una página, ya convertidas en celdas. */
export type CellPage = readonly (readonly ExportCell[])[];

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS =
  'http://schemas.openxmlformats.org/package/2006/relationships';
const XML_DECLARATION =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const SHEET_PART = 'xl/worksheets/sheet1.xml';

/**
 * Estilo 1: formato de fecha predefinido 14, el que el lector de E5.2 reconoce
 * como fecha. El resto son los mínimos que Excel espera en `styles.xml`.
 */
const DATE_STYLE = 1;

/** Excel limita el nombre de una hoja a 31 caracteres sin `[]:*?/\`. */
const SHEET_NAME_LENGTH = 31;
// Los caracteres de control también se quitan: no caben en un atributo XML.
// oxlint-disable-next-line no-control-regex
const SHEET_NAME_FORBIDDEN_PATTERN = /[[\]:*?/\\\u0000-\u001F]/g;
const FALLBACK_SHEET_NAME = 'Hoja1';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/**
 * Contando desde el 1899-12-30, las series coinciden con las de Excel desde el
 * 1900-03-01: Excel cuenta un 29 de febrero de 1900 que no existió.
 */
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/**
 * Caracteres que no caben tal cual en el texto de una celda (MS-OI29500,
 * ST_Xstring): los de control que XML 1.0 no admite, el retorno de carro (que
 * el lector de XML convertiría en salto de línea) y el guion bajo que empieza
 * un `_xHHHH_` literal, para que no se lea como escape. `&`, `<` y `>` son los
 * de XML.
 */
const TEXT_ESCAPE_PATTERN =
  // oxlint-disable-next-line no-control-regex -- son justo los que hay que escapar.
  /_(?=x[0-9A-Fa-f]{4}_)|[\u0000-\u0008\u000B-\u001F\uFFFE\uFFFF]|[&<>]/g;
const XML_ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

/**
 * Libro de una hoja: las partes fijas y la hoja, que llega ya serializada por
 * trozos (`xlsxSheetXml`) para comprimirla mientras se genera.
 */
export async function writeXlsxPackage(
  sink: ByteSink,
  sheetName: string,
  sheetXml: AsyncIterable<Buffer>,
) {
  const zip = new ZipWriter(sink);
  for (const [name, content] of fixedParts(sheetName)) {
    await zip.addEntry(name, [Buffer.from(content, 'utf8')]);
  }
  await zip.addEntry(SHEET_PART, sheetXml);
  await zip.finish();
}

/** El XML de la hoja: la cabecera en la fila 1 y una página de filas por trozo. */
export async function* xlsxSheetXml(
  header: readonly string[],
  pages: AsyncIterable<CellPage>,
): AsyncGenerator<string> {
  yield `${XML_DECLARATION}<worksheet xmlns="${NS}"><sheetData>`;
  yield rowXml(
    1,
    header.map((name) => ({ kind: 'text', text: name })),
  );

  let rowNumber = 1;
  for await (const page of pages) {
    let chunk = '';
    for (const cells of page) {
      rowNumber += 1;
      chunk += rowXml(rowNumber, cells);
    }
    yield chunk;
  }
  yield '</sheetData></worksheet>';
}

/**
 * Nombre de hoja válido para Excel a partir del de la hoja de la API. Se
 * cuenta por caracteres, no por unidades UTF-16, para no partir un emoji.
 */
export function excelSheetName(name: string) {
  const cleaned = name
    .replace(SHEET_NAME_FORBIDDEN_PATTERN, '_')
    .replace(/^'+|'+$/g, '')
    .trim();
  const shortened = Array.from(cleaned)
    .slice(0, SHEET_NAME_LENGTH)
    .join('')
    .trim();
  return shortened || FALLBACK_SHEET_NAME;
}

/** Serie de Excel (sistema 1900) de una fecha desde el 1900-03-01. */
export function excelSerial(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return (Date.UTC(year, month - 1, day) - EXCEL_EPOCH) / MS_PER_DAY;
}

/** `A`, `B`, …, `Z`, `AA`…: la letra de la columna en la referencia de celda. */
export function columnLetters(index: number) {
  let letters = '';
  for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    letters = String.fromCharCode(65 + ((rest - 1) % 26)) + letters;
  }
  return letters;
}

/** Texto de celda con los escapes de XML y de ST_Xstring. */
export function escapeCellText(text: string) {
  return text.replace(TEXT_ESCAPE_PATTERN, (match) => {
    if (match in XML_ENTITIES) {
      return XML_ENTITIES[match];
    }
    const code = match.charCodeAt(0).toString(16).toUpperCase();
    return `_x${code.padStart(4, '0')}_`;
  });
}

function rowXml(rowNumber: number, cells: readonly ExportCell[]) {
  let xml = `<row r="${rowNumber}">`;
  cells.forEach((cell, index) => {
    xml += cellXml(`${columnLetters(index)}${rowNumber}`, cell);
  });
  return `${xml}</row>`;
}

/**
 * El texto va como `inlineStr`: nunca es una fórmula ([12], «escribir texto
 * como texto»). Una celda vacía no se escribe.
 */
function cellXml(reference: string, cell: ExportCell) {
  switch (cell.kind) {
    case 'empty':
      return '';
    case 'text':
      return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeCellText(cell.text)}</t></is></c>`;
    case 'number':
      return `<c r="${reference}"><v>${cell.text}</v></c>`;
    case 'date':
      return `<c r="${reference}" s="${DATE_STYLE}"><v>${excelSerial(cell.text)}</v></c>`;
    case 'boolean':
      return `<c r="${reference}" t="b"><v>${cell.value ? 1 : 0}</v></c>`;
  }
}

function fixedParts(sheetName: string): [string, string][] {
  return [
    [
      '[Content_Types].xml',
      `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/${SHEET_PART}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ],
    [
      '_rels/.rels',
      `${XML_DECLARATION}<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      'xl/workbook.xml',
      `${XML_DECLARATION}<workbook xmlns="${NS}" xmlns:r="${REL_NS}"><sheets><sheet name="${escapeAttribute(excelSheetName(sheetName))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `${XML_DECLARATION}<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`,
    ],
    ['xl/styles.xml', STYLES],
  ];
}

const STYLES = `${XML_DECLARATION}<styleSheet xmlns="${NS}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/** El nombre de la hoja ya no tiene caracteres de control (`excelSheetName`). */
function escapeAttribute(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
