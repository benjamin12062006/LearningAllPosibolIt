import { describe, expect, it } from '@jest/globals';
import { readWorksheetCsv } from '../../../src/worksheet-imports/worksheet-csv.js';

const csv = (text: string) => Buffer.from(text, 'utf8');

function failureOf(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return (error as { detail?: unknown }).detail;
  }
  throw new Error('No falló');
}

describe('readWorksheetCsv (D2, T13)', () => {
  it('quita el BOM, respeta comillas, comas y saltos dentro de un campo y no recorta nada', () => {
    const table = readWorksheetCsv(
      csv('﻿SKU,Nombre\n007," Tornillo, 5 mm "\n"A""B","dos\nlíneas"\n'),
      'comma',
    );
    expect(table.headers).toEqual(['SKU', 'Nombre']);
    expect(table.rows).toEqual([
      ['007', ' Tornillo, 5 mm '],
      ['A"B', 'dos\nlíneas'],
    ]);
    expect(table.fileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(table.fileBytes).toBe(
      csv('﻿SKU,Nombre\n007," Tornillo, 5 mm "\n"A""B","dos\nlíneas"\n').length,
    );
  });

  it('conserva los espacios de un campo sin comillas, también alrededor del separador', () => {
    expect(readWorksheetCsv(csv('a,b\n 007 , x\n'), 'comma').rows).toEqual([
      [' 007 ', ' x'],
    ]);
  });

  it('admite punto y coma, CRLF y líneas vacías', () => {
    expect(
      readWorksheetCsv(csv('a;b\r\n1;2\r\n\r\n3;4\r\n'), 'semicolon').rows,
    ).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('una fila con otro número de campos falla con su número de fila de datos', () => {
    expect(
      failureOf(() => readWorksheetCsv(csv('a,b\n1,2\n3\n'), 'comma')),
    ).toMatchObject({
      code: 'CSV_INVALID',
      sourceRow: 2,
    });
  });

  it.each([
    ['cabeceras repetidas', 'a,a\n1,2\n', 'CSV_HEADERS_INVALID'],
    ['cabecera vacía', 'a, \n1,2\n', 'CSV_HEADERS_INVALID'],
    ['sin filas', 'a,b\n', 'CSV_EMPTY'],
    ['vacío', '', 'CSV_EMPTY'],
    ['comilla sin cerrar', 'a\n"x\n', 'CSV_INVALID'],
  ])('rechaza %s', (_label, text, code) => {
    expect(failureOf(() => readWorksheetCsv(csv(text), 'comma'))).toMatchObject(
      { code },
    );
  });

  it('rechaza UTF-8 inválido, NUL y más de 5.000 filas', () => {
    expect(
      failureOf(() =>
        readWorksheetCsv(Buffer.from([0x61, 0x0a, 0xff, 0x0a]), 'comma'),
      ),
    ).toMatchObject({ code: 'CSV_INVALID_ENCODING' });
    expect(
      failureOf(() => readWorksheetCsv(csv('a\nx\0y\n'), 'comma')),
    ).toMatchObject({
      code: 'CSV_INVALID',
    });
    const big = `a\n${'1\n'.repeat(5001)}`;
    expect(failureOf(() => readWorksheetCsv(csv(big), 'comma'))).toMatchObject({
      code: 'IMPORT_ROW_LIMIT',
    });
  });
});
