import { describe, expect, it } from '@jest/globals';
import { randomBytes } from 'node:crypto';
import {
  dateOfSerial,
  isCompoundFile,
  isXlsxContent,
  plainDecimal,
  readWorksheetXlsx,
  type SheetChoice,
} from '../../../src/worksheet-imports/worksheet-xlsx.js';
import {
  MACRO_CONTENT_TYPE,
  row,
  worksheetXml,
  xlsxBook,
  zip,
  type BookFixture,
} from './support/xlsx-fixture.js';

const FIRST_SHEET: SheetChoice = { sheet: null, headerRow: 1 };

/** Cabecera de una columna (`sku`) en la cadena compartida 0. */
const ONE_COLUMN = { strings: ['sku', '007'] };
const ONE_ROW =
  row(1, '<c r="A1" t="s"><v>0</v></c>') +
  row(2, '<c r="A2" t="s"><v>1</v></c>');

function book(rows: string, extra: Partial<BookFixture> = {}): Buffer {
  return xlsxBook({
    sheets: [{ name: 'Datos', rows }],
    ...ONE_COLUMN,
    ...extra,
  });
}

async function tableOf(content: Buffer, choice = FIRST_SHEET) {
  const read = await readWorksheetXlsx(content, choice);
  if (!read.table) throw new Error('Sin tabla');
  return read.table;
}

async function failureOf(run: Promise<unknown>) {
  try {
    await run;
  } catch (error) {
    return (error as { detail?: { code?: string } }).detail?.code;
  }
  throw new Error('No falló');
}

describe('readWorksheetXlsx: tipos de celda (D13, T13)', () => {
  it('texto tal cual, números con su texto exacto, booleanos, fechas por estilo, fórmulas y errores', async () => {
    const table = await tableOf(
      xlsxBook({
        sheets: [
          {
            name: 'Productos',
            rows:
              row(
                1,
                ['sku', 'nombre', 'precio', 'activo', 'alta', 'total']
                  .map((_, i) => `<c r="${'ABCDEF'[i]}1" t="s"><v>${i}</v></c>`)
                  .join(''),
              ) +
              row(
                2,
                '<c r="A2" t="s"><v>6</v></c>' +
                  '<c r="B2" t="s"><v>7</v></c>' +
                  '<c r="C2"><v>10.5</v></c>' +
                  '<c r="D2" t="b"><v>1</v></c>' +
                  '<c r="E2" s="1"><v>46096</v></c>' +
                  '<c r="F2"><f>0.1+0.2</f><v>0.30000000000000004</v></c>',
              ) +
              row(
                3,
                '<c r="A3" t="inlineStr"><is><t>008</t></is></c>' +
                  '<c r="B3" t="s"><v>8</v></c>' +
                  '<c r="C3"><v>1.5E-3</v></c>' +
                  '<c r="D3" t="b"><v>0</v></c>' +
                  '<c r="E3" s="2"><v>46097</v></c>' +
                  '<c r="F3" t="e"><f>1/0</f><v>#DIV/0!</v></c>',
              ) +
              row(
                4,
                '<c r="A4" t="str"><f>"0"&amp;"09"</f><v>009</v></c>' +
                  '<c r="C4" s="3"><v>7</v></c>' +
                  '<c r="E4" s="1"><v>46096.5</v></c>' +
                  '<c r="F4"><f>A1*2</f></c>',
              ) +
              row(5, '<c r="A5" t="d"><v>2026-03-15T00:00:00</v></c>'),
          },
        ],
        strings: [
          'sku',
          'nombre',
          'precio',
          'activo',
          'alta',
          'total',
          '007',
          '  Tornillo  ',
          '<r><t>Tuer</t></r><r><t>ca</t></r>',
        ],
      }),
    );
    expect(table.headers).toEqual([
      'sku',
      'nombre',
      'precio',
      'activo',
      'alta',
      'total',
    ]);
    expect(table.rows).toEqual([
      [
        '007',
        '  Tornillo  ',
        { kind: 'number', text: '10.5' },
        { kind: 'boolean', text: 'true' },
        { kind: 'date', text: '2026-03-15' },
        { kind: 'number', text: '0.30000000000000004' },
      ],
      [
        '008',
        'Tuerca',
        { kind: 'number', text: '0.0015' },
        { kind: 'boolean', text: 'false' },
        { kind: 'date', text: '2026-03-16' },
        { kind: 'error', text: '#DIV/0!' },
      ],
      // Un número con texto entre comillas en el formato no es fecha, y una
      // serie con hora no se trunca: sigue siendo número.
      [
        '009',
        '',
        { kind: 'number', text: '7' },
        '',
        { kind: 'number', text: '46096.5' },
        { kind: 'uncalculated', text: '' },
      ],
      [{ kind: 'date', text: '2026-03-15' }, '', '', '', '', ''],
    ]);
    expect(table.format).toBe('xlsx');
    expect(table.fileHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('el sistema de fechas sale del libro: la misma serie es 1.462 días después en 1904 (F65)', async () => {
    const rows =
      row(1, '<c r="A1" t="s"><v>0</v></c>') +
      row(2, '<c r="A2" s="1"><v>44634</v></c>');
    const in1904 = await tableOf(book(rows, { date1904: true }));
    const in1900 = await tableOf(book(rows));
    expect(in1904.rows).toEqual([[{ kind: 'date', text: '2026-03-15' }]]);
    expect(in1900.rows).toEqual([[{ kind: 'date', text: '2022-03-14' }]]);
  });

  it('lee nombres locales aunque el libro use un prefijo de espacio de nombres', async () => {
    const prefixed =
      '<?xml version="1.0" encoding="UTF-8"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>' +
      '<x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>sku</x:t></x:is></x:c></x:row>' +
      '<x:row r="2"><x:c r="A2"><x:v>5</x:v></x:c></x:row>' +
      '</x:sheetData></x:worksheet>';
    const table = await tableOf(
      book('', { replaceParts: { 'xl/worksheets/sheet1.xml': prefixed } }),
    );
    expect(table.rows).toEqual([[{ kind: 'number', text: '5' }]]);
  });
});

describe('readWorksheetXlsx: escapes de texto de Excel (ST_Xstring, E5.3)', () => {
  it('decodifica _xHHHH_ en cadenas compartidas y en línea; _x005F_ protege un escape literal', async () => {
    const rows =
      row(1, '<c r="A1" t="s"><v>0</v></c>') +
      row(2, '<c r="A2" t="s"><v>1</v></c>') +
      row(
        3,
        '<c r="A3" t="inlineStr"><is><t>_x005F_x0041_ y _x0001_</t></is></c>',
      );
    const table = await tableOf(
      book(rows, { strings: ['sku', 'línea_x000D_\nnueva'] }),
    );
    expect(table.rows).toEqual([['línea\r\nnueva'], ['_x0041_ y \u0001']]);
  });

  it('un _x0000_ hace inválido el libro: PostgreSQL no guarda NUL', async () => {
    const rows =
      row(1, '<c r="A1" t="s"><v>0</v></c>') +
      row(2, '<c r="A2" t="inlineStr"><is><t>a_x0000_b</t></is></c>');
    expect(await failureOf(readWorksheetXlsx(book(rows), FIRST_SHEET))).toBe(
      'XLSX_INVALID',
    );
  });
});

describe('readWorksheetXlsx: hojas, cabeceras y filas (D11)', () => {
  const twoSheets = xlsxBook({
    sheets: [
      { name: 'Notas', rows: row(1, '<c r="A1" t="s"><v>2</v></c>') },
      { name: 'Productos', rows: ONE_ROW },
    ],
    strings: ['sku', '007', 'no importar'],
  });

  it('con varias hojas y sin elegir, solo devuelve la lista: nunca toma la primera (C31)', async () => {
    expect(await readWorksheetXlsx(twoSheets, FIRST_SHEET)).toEqual({
      sheets: ['Notas', 'Productos'],
      sheet: null,
      table: null,
    });
    const chosen = await readWorksheetXlsx(twoSheets, {
      sheet: 'Productos',
      headerRow: 1,
    });
    expect(chosen.sheet).toBe('Productos');
    expect(chosen.table?.rows).toEqual([['007']]);
    expect(
      await failureOf(
        readWorksheetXlsx(twoSheets, { sheet: 'Otra', headerRow: 1 }),
      ),
    ).toBe('XLSX_SHEET_NOT_FOUND');
  });

  it('la cabecera puede estar más abajo; las filas anteriores y las vacías no cuentan', async () => {
    const table = await tableOf(
      book(
        row(1, '<c r="A1" t="inlineStr"><is><t>Informe</t></is></c>') +
          row(
            3,
            '<c r="A3" t="s"><v>0</v></c><c r="B3" t="inlineStr"><is><t>precio</t></is></c>',
          ) +
          row(4, '<c r="B4"><v>1</v></c>') +
          row(5, '<c r="A5" t="inlineStr"><is><t></t></is></c>') +
          row(7, '<c r="A7" t="s"><v>1</v></c>'),
      ),
      { sheet: null, headerRow: 3 },
    );
    expect(table.headers).toEqual(['sku', 'precio']);
    expect(table.rows).toEqual([
      ['', { kind: 'number', text: '1' }],
      ['007', ''],
    ]);
  });

  it.each([
    [
      'sin filas de datos',
      row(1, '<c r="A1" t="s"><v>0</v></c>'),
      'XLSX_EMPTY',
    ],
    [
      'sin la fila de cabecera elegida',
      row(2, '<c r="A2" t="s"><v>0</v></c>'),
      'XLSX_EMPTY',
    ],
    [
      'una cabecera vacía en medio',
      row(1, '<c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c>') +
        row(2, '<c r="A2"><v>1</v></c>'),
      'CSV_HEADERS_INVALID',
    ],
    [
      'cabeceras repetidas',
      row(1, '<c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>0</v></c>') +
        row(2, '<c r="A2"><v>1</v></c>'),
      'CSV_HEADERS_INVALID',
    ],
    [
      'un dato a la derecha de la última cabecera',
      row(1, '<c r="A1" t="s"><v>0</v></c>') +
        row(2, '<c r="A2"><v>1</v></c><c r="C2"><v>2</v></c>'),
      'CSV_HEADERS_INVALID',
    ],
  ])('rechaza %s', async (_label, rows, code) => {
    expect(await failureOf(readWorksheetXlsx(book(rows), FIRST_SHEET))).toBe(
      code,
    );
  });

  it('acepta 5.000 filas de datos y rechaza la 5.001', async () => {
    const rowsOf = (count: number) =>
      row(1, '<c r="A1" t="s"><v>0</v></c>') +
      Array.from({ length: count }, (_, index) =>
        row(index + 2, `<c r="A${index + 2}"><v>${index}</v></c>`),
      ).join('');
    expect((await tableOf(book(rowsOf(5000)))).rows).toHaveLength(5000);
    expect(
      await failureOf(readWorksheetXlsx(book(rowsOf(5001)), FIRST_SHEET)),
    ).toBe('XLSX_ROW_LIMIT');
  });
});

describe('readWorksheetXlsx: archivos peligrosos o dañados (D12, T14)', () => {
  const validParts = (rows = ONE_ROW) =>
    xlsxBook({ sheets: [{ name: 'Datos', rows }], ...ONE_COLUMN });

  it('reconoce un ZIP y un contenedor CFB (Office cifrado o .xls) por sus primeros bytes', () => {
    expect(isXlsxContent(validParts())).toBe(true);
    expect(isXlsxContent(Buffer.from('sku\n007\n'))).toBe(false);
    expect(isCompoundFile(Buffer.from('d0cf11e0a1b11ae1000000', 'hex'))).toBe(
      true,
    );
  });

  it('una bomba (60 MiB de espacios en la hoja) se rechaza sin descomprimirla', async () => {
    const padding = ' '.repeat(60 * 1024 * 1024);
    const bomb = book('', {
      replaceParts: {
        'xl/worksheets/sheet1.xml': worksheetXml(ONE_ROW + padding),
      },
    });
    const started = Date.now();
    expect(await failureOf(readWorksheetXlsx(bomb, FIRST_SHEET))).toBe(
      'XLSX_LIMITS_EXCEEDED',
    );
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('un ratio de compresión de más de 100:1 se rechaza aunque el total sea pequeño', async () => {
    const padding = ' '.repeat(4 * 1024 * 1024);
    const compressed = book('', {
      replaceParts: {
        'xl/worksheets/sheet1.xml': worksheetXml(ONE_ROW + padding),
      },
    });
    expect(await failureOf(readWorksheetXlsx(compressed, FIRST_SHEET))).toBe(
      'XLSX_LIMITS_EXCEEDED',
    );
  });

  it('más de 50 MiB declarados se rechazan aunque el ratio sea menor de 100:1', async () => {
    // 1 MiB aleatorio no se comprime: el archivo pesa ~1 MiB y declara 51 MiB.
    const large = book(ONE_ROW, {
      extraParts: [
        { name: 'customXml/blob.bin', data: randomBytes(1024 * 1024) },
        {
          name: 'customXml/item1.xml',
          data: '<a/>',
          declaredSize: 50 * 1024 * 1024,
        },
      ],
    });
    expect(await failureOf(readWorksheetXlsx(large, FIRST_SHEET))).toBe(
      'XLSX_LIMITS_EXCEEDED',
    );
  });

  it('más de 1.000 entradas en el ZIP se rechazan', async () => {
    const many = book(ONE_ROW, {
      extraParts: Array.from({ length: 1000 }, (_, index) => ({
        name: `customXml/item${index}.xml`,
        data: '<a/>',
      })),
    });
    expect(await failureOf(readWorksheetXlsx(many, FIRST_SHEET))).toBe(
      'XLSX_LIMITS_EXCEEDED',
    );
  });

  it.each<[string, Partial<BookFixture>]>([
    [
      'macros (vbaProject.bin)',
      { extraParts: [{ name: 'xl/vbaProject.bin', data: 'VBA' }] },
    ],
    [
      'un libro habilitado para macros',
      { mainContentType: MACRO_CONTENT_TYPE },
    ],
    [
      'un enlace externo',
      {
        extraParts: [
          {
            name: 'xl/externalLinks/externalLink1.xml',
            data: '<externalLink/>',
          },
        ],
      },
    ],
    [
      'un objeto incrustado',
      { extraParts: [{ name: 'xl/embeddings/oleObject1.bin', data: 'OLE' }] },
    ],
    [
      'un DOCTYPE con entidades',
      {
        replaceParts: {
          'xl/sharedStrings.xml':
            '<?xml version="1.0"?><!DOCTYPE sst [<!ENTITY a "aaaa">]><sst><si><t>&a;</t></si></sst>',
        },
      },
    ],
  ])('rechaza %s como contenido activo (C32)', async (_label, extra) => {
    expect(
      await failureOf(readWorksheetXlsx(book(ONE_ROW, extra), FIRST_SHEET)),
    ).toBe('XLSX_ACTIVE_CONTENT');
  });

  it('rechaza una entrada marcada como cifrada', async () => {
    const parts = zip([
      { name: 'xl/workbook.xml', data: '<workbook/>', encrypted: true },
    ]);
    expect(await failureOf(readWorksheetXlsx(parts, FIRST_SHEET))).toBe(
      'XLSX_ENCRYPTED',
    );
  });

  it.each([
    ['truncado', () => validParts().subarray(0, 200)],
    [
      'con el tamaño descomprimido falseado',
      () =>
        zip([
          { name: '[Content_Types].xml', data: '<Types/>' },
          {
            name: 'xl/workbook.xml',
            data: '<workbook>' + ' '.repeat(10_000) + '</workbook>',
            declaredSize: 100,
          },
        ]),
    ],
    [
      'sin libro',
      () => zip([{ name: '[Content_Types].xml', data: '<Types/>' }]),
    ],
    [
      'con XML mal formado',
      () =>
        book('', {
          replaceParts: {
            'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row>',
          },
        }),
    ],
    [
      'con UTF-8 inválido',
      () =>
        zip([
          { name: '[Content_Types].xml', data: '<Types/>' },
          {
            name: 'xl/workbook.xml',
            data: Buffer.from([0x3c, 0xff, 0xfe, 0x3e]),
          },
        ]),
    ],
    [
      'con una cadena compartida que no existe',
      () =>
        book(
          row(1, '<c r="A1" t="s"><v>0</v></c>') +
            row(2, '<c r="A2" t="s"><v>9</v></c>'),
        ),
    ],
  ])('rechaza un libro %s como inválido', async (_label, content) => {
    expect(await failureOf(readWorksheetXlsx(content(), FIRST_SHEET))).toBe(
      'XLSX_INVALID',
    );
  });
});

describe('plainDecimal y dateOfSerial', () => {
  it.each([
    ['10.5', '10.5'],
    ['7', '7'],
    ['1.5E-3', '0.0015'],
    ['1E-3', '0.001'],
    ['-2.5e+2', '-250'],
    ['1.23E2', '123'],
    ['4.6096E4', '46096'],
    ['0E0', '0'],
    ['abc', 'abc'],
  ])('%s → %s, sin redondear', (raw, expected) => {
    expect(plainDecimal(raw)).toBe(expected);
  });

  it.each<[string, boolean, string | null]>([
    ['61', false, '1900-03-01'],
    ['60', false, null],
    ['46096', false, '2026-03-15'],
    ['0', true, '1904-01-01'],
    ['44634', true, '2026-03-15'],
    ['2958466', false, null],
    ['46096.5', false, null],
  ])('serie %s (1904: %s) → %s', (serial, date1904, expected) => {
    expect(dateOfSerial(serial, date1904)).toBe(expected);
  });
});
