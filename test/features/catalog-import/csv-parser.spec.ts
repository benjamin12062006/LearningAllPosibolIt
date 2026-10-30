import { describe, expect, it } from '@jest/globals';
import { Readable } from 'node:stream';
import { parseCatalogCsv } from '../../../src/catalog-import/csv-parser.js';
import { IMPORT_LIMITS } from '../../../src/catalog-import/import.types.js';

async function events(
  input: string | Buffer,
  idColumn = 'id',
  delimiter: 'comma' | 'semicolon' = 'comma',
) {
  const result = [];
  for await (const event of parseCatalogCsv(
    Readable.from([Buffer.isBuffer(input) ? input : Buffer.from(input)]),
    { idColumn, delimiter },
  ))
    result.push(event);
  return result;
}

describe('Parser CSV real', () => {
  it('conserva BOM, ceros, espacios, números y campos multilínea sin convertir valores', async () => {
    const result = await events(
      '\ufeffid,title,price\r\n000123,"Café, ""especial""\nsegunda línea"," 1.234,50 "\r\n\r\n',
    );
    expect(result[0]).toEqual({
      kind: 'headers',
      headers: ['id', 'title', 'price'],
    });
    expect(result[1]).toEqual({
      kind: 'row',
      row: {
        sourceRow: 1,
        externalId: '000123',
        originalValues: {
          id: '000123',
          title: 'Café, "especial"\nsegunda línea',
          price: ' 1.234,50 ',
        },
      },
    });
    expect(result[2]).toMatchObject({ kind: 'complete', count: 1 });
  });

  it('admite punto y coma explícito y compara IDs de forma textual exacta', async () => {
    const result = await events(
      'id;title\n001;Uno\n 001 ;Otro\n1;Tres\n',
      'id',
      'semicolon',
    );
    expect(
      result
        .filter((event) => event.kind === 'row')
        .map((event) => event.row.externalId),
    ).toEqual(['001', ' 001 ', '1']);
  });

  it('conserva encabezados especiales como propiedades propias sin modificar prototipos', async () => {
    const result = await events('id,__proto__,constructor\n1,valor,texto\n');
    const row = result.find((event) => event.kind === 'row');
    expect(row?.row.originalValues).toEqual(
      JSON.parse('{"id":"1","__proto__":"valor","constructor":"texto"}'),
    );
    expect(Object.getPrototypeOf(row?.row.originalValues)).toBe(
      Object.prototype,
    );
  });

  it('decodifica secuencias UTF-8 repartidas entre chunks', async () => {
    const source = Readable.from(
      Array.from(Buffer.from('id,title\n1,niño\n'), (byte) =>
        Buffer.from([byte]),
      ),
    );
    const result = [];
    for await (const event of parseCatalogCsv(source, {
      idColumn: 'id',
      delimiter: 'comma',
    }))
      result.push(event);
    expect(result[1]).toMatchObject({
      row: { originalValues: { title: 'niño' } },
    });
  });

  it.each([
    ['', 'CSV_EMPTY'],
    ['id\n', 'CSV_EMPTY'],
    ['id,id\n1,2', 'CSV_HEADERS_INVALID'],
    ['id,\n1,2', 'CSV_HEADERS_INVALID'],
    ['other\n1', 'CSV_COLUMN_MISSING'],
    ['id\n   ', 'CSV_ID_MISSING'],
    ['id\n1\n1', 'CSV_DUPLICATE_ID'],
    ['id,title\n1', 'CSV_INVALID'],
    ['id\n"unterminated', 'CSV_INVALID'],
    ['id\n\0', 'CSV_INVALID'],
  ])('rechaza entrada inválida %j con código %s', async (input, code) => {
    await expect(events(input)).rejects.toMatchObject({ detail: { code } });
  });

  it.each([
    Buffer.from([0x69, 0x64, 0x0a, 0xff]),
    Buffer.from([0x69, 0x64, 0x0a, 0xc3]),
  ])('rechaza UTF-8 inválido o incompleto', async (input) => {
    await expect(events(input)).rejects.toMatchObject({
      detail: { code: 'CSV_INVALID_ENCODING' },
    });
  });

  it('acepta 5.000 filas y rechaza la 5.001 con su ordinal lógico', async () => {
    const input = `id\n${Array.from({ length: IMPORT_LIMITS.rows }, (_, i) => i.toString()).join('\n')}`;
    expect((await events(input)).at(-1)).toMatchObject({
      kind: 'complete',
      count: 5000,
    });
    await expect(events(`${input}\n5000`)).rejects.toMatchObject({
      detail: { code: 'IMPORT_ROW_LIMIT', sourceRow: 5001 },
    });
  });

  it('rechaza exceso de columnas, cabeceras largas y registros anormales', async () => {
    await expect(
      events(`${Array.from({ length: 201 }, (_, i) => `c${i}`).join(',')}\n1`),
    ).rejects.toMatchObject({ detail: { code: 'CSV_HEADERS_INVALID' } });
    await expect(events(`${'x'.repeat(129)}\n1`)).rejects.toMatchObject({
      detail: { code: 'CSV_HEADERS_INVALID' },
    });
    await expect(
      events(`id,title\n1,${'x'.repeat(IMPORT_LIMITS.recordSize + 1)}`),
    ).rejects.toMatchObject({ detail: { code: 'CSV_INVALID' } });
  });

  it('rechaza el byte que supera el máximo de archivo durante lectura', async () => {
    await expect(
      events(Buffer.alloc(IMPORT_LIMITS.fileBytes + 1, 0x61)),
    ).rejects.toMatchObject({ detail: { code: 'IMPORT_FILE_TOO_LARGE' } });
  });

  it('caracteriza el límite de registro con texto ASCII y multibyte en csv-parse 7', async () => {
    expect(
      (await events(`id,title\n1,${'x'.repeat(600_000)}`)).at(-1),
    ).toMatchObject({ kind: 'complete', count: 1 });
    await expect(
      events(`id,title\n1,${'é'.repeat(600_000)}`),
    ).rejects.toMatchObject({ detail: { code: 'CSV_INVALID' } });
  });
});
