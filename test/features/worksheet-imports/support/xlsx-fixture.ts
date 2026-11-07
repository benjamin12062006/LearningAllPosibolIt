import { crc32, deflateRawSync } from 'node:zlib';

/**
 * Libros XLSX de prueba escritos a mano (como los fixtures del spike, ficha
 * imports&exports 02): cada prueba ve el XML exacto de sus celdas. El ZIP se
 * escribe aquí con `zlib`, sin librerías, para poder falsear lo que haga falta
 * (marca de cifrado, tamaño declarado).
 */

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS =
  'http://schemas.openxmlformats.org/package/2006/relationships';
export const MAIN_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
export const MACRO_CONTENT_TYPE =
  'application/vnd.ms-excel.sheet.macroEnabled.main+xml';

export type ZipEntry = Readonly<{
  name: string;
  data: Buffer | string;
  /** Marca la entrada como cifrada (bit 0 de los indicadores). */
  encrypted?: boolean;
  /** Tamaño descomprimido que se declara en lugar del real. */
  declaredSize?: number;
}>;

export type SheetFixture = Readonly<{ name: string; rows: string }>;

export type BookFixture = Readonly<{
  sheets: readonly SheetFixture[];
  /** Cadenas compartidas: texto plano o `<r>…</r>` ya escrito. */
  strings?: readonly string[];
  date1904?: boolean;
  mainContentType?: string;
  extraParts?: readonly ZipEntry[];
  /** Cambia o quita partes del libro por nombre. */
  replaceParts?: Readonly<Record<string, string | null>>;
}>;

/**
 * Estilos: 0 general, 1 fecha estándar (`numFmtId` 14), 2 fecha con formato
 * propio y 3 número con texto entre comillas (no es fecha).
 */
const STYLES = `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="${NS}">
<numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="0.00 &quot;días&quot;"/></numFmts>
<cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs>
</styleSheet>`;

export function xlsxBook(book: BookFixture): Buffer {
  const parts = new Map<string, string>(bookParts(book));
  for (const [name, data] of Object.entries(book.replaceParts ?? {})) {
    if (data === null) parts.delete(name);
    else parts.set(name, data);
  }
  return zip([
    ...[...parts].map(([name, data]) => ({ name, data })),
    ...(book.extraParts ?? []),
  ]);
}

/** Una fila de celdas `<c>` ya escritas. */
export function row(number: number, cells: string) {
  return `<row r="${number}">${cells}</row>`;
}

function bookParts(book: BookFixture): [string, string][] {
  const sheets = book.sheets;
  const overrides = [
    `<Override PartName="/xl/workbook.xml" ContentType="${book.mainContentType ?? MAIN_CONTENT_TYPE}"/>`,
    ...sheets.map(
      (_, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    ),
  ];
  const workbookRels = [
    ...sheets.map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    ),
    `<Relationship Id="rIdS" Type="${REL_NS}/sharedStrings" Target="sharedStrings.xml"/>`,
    `<Relationship Id="rIdY" Type="${REL_NS}/styles" Target="styles.xml"/>`,
  ];
  const strings = (book.strings ?? [])
    .map((text) =>
      text.startsWith('<r>')
        ? `<si>${text}</si>`
        : `<si><t xml:space="preserve">${escapeXml(text)}</t></si>`,
    )
    .join('');
  return [
    [
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.join('')}</Types>`,
    ],
    [
      '_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      'xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${NS}" xmlns:r="${REL_NS}"><workbookPr${book.date1904 ? ' date1904="1"' : ''}/><sheets>${sheets
        .map(
          (sheet, index) =>
            `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
        )
        .join('')}</sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PKG_REL_NS}">${workbookRels.join('')}</Relationships>`,
    ],
    ['xl/styles.xml', STYLES],
    [
      'xl/sharedStrings.xml',
      `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="${NS}">${strings}</sst>`,
    ],
    ...sheets.map((sheet, index): [string, string] => [
      `xl/worksheets/sheet${index + 1}.xml`,
      worksheetXml(sheet.rows),
    ]),
  ];
}

export function worksheetXml(rows: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${NS}"><sheetData>${rows}</sheetData></worksheet>`;
}

function escapeXml(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** ZIP con deflate: cabeceras locales, directorio central y fin de directorio. */
export function zip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(entry.data, 'utf8');
    const compressed = deflateRawSync(data);
    const flags = (entry.encrypted ? 0x1 : 0) | 0x800;
    const size = entry.declaredSize ?? data.length;
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
