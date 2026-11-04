import { describe, expect, it } from '@jest/globals';
import { isCanonicalValue } from '../../../src/worksheets/cell-values.js';
import {
  decodeRowCursor,
  encodeRowCursor,
  hashRowQuery,
} from '../../../src/worksheets/row-cursor.js';
import {
  parseRowQuery,
  type ParsedRowQuery,
  type RowQueryInput,
} from '../../../src/worksheets/row-query.js';
import type { WorksheetColumn } from '../../../src/worksheets/worksheets.types.js';

const columns: WorksheetColumn[] = [
  { id: 'c-sku', name: 'SKU', type: 'text', position: 0, required: true },
  {
    id: 'c-price',
    name: 'Precio',
    type: 'decimal',
    position: 1,
    required: false,
  },
  {
    id: 'c-qty',
    name: 'Cantidad',
    type: 'integer',
    position: 2,
    required: false,
  },
  { id: 'c-date', name: 'Alta', type: 'date', position: 3, required: false },
  { id: 'c-on', name: 'Activo', type: 'boolean', position: 4, required: false },
];

function parse(input: RowQueryInput) {
  return parseRowQuery(input, columns);
}

function issuesOf(input: RowQueryInput) {
  const result = parse(input);
  return result.ok ? [] : result.issues;
}

function queryOf(input: RowQueryInput): ParsedRowQuery {
  const result = parse(input);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.query;
}

describe('Valores canónicos de celda', () => {
  it.each([
    ['text', '', true],
    ['text', 'x'.repeat(8193), false],
    ['integer', '-12', true],
    ['integer', '1.5', false],
    ['integer', 12, false],
    ['decimal', '10.50', true],
    ['decimal', '1e3', false],
    ['decimal', '.5', false],
    ['date', '2026-02-28', true],
    ['date', '2026-02-30', false],
    ['date', '2026-2-3', false],
    ['boolean', false, true],
    ['boolean', 'true', false],
  ] as const)('%s %p → %s', (type, value, expected) => {
    expect(isCanonicalValue(type, value)).toBe(expected);
  });
});

describe('Análisis del filtro, el orden y las columnas', () => {
  it('sin filtro ni selección devuelve todas las columnas en el orden de la hoja', () => {
    expect(queryOf({})).toEqual({
      filter: null,
      sort: [],
      columnIds: ['c-sku', 'c-price', 'c-qty', 'c-date', 'c-on'],
    });
  });

  it('acepta grupos anidados con operadores de cada tipo', () => {
    const query = queryOf({
      filter: {
        and: [
          { column: 'c-price', op: 'gte', value: '10' },
          {
            or: [
              { column: 'c-sku', op: 'contains', value: 'A-' },
              { column: 'c-on', op: 'equals', value: true },
              { column: 'c-qty', op: 'is_null' },
            ],
          },
          { column: 'c-date', op: 'in', value: ['2026-01-05', '2026-02-01'] },
        ],
      },
    });

    expect(query.filter).toMatchObject({
      kind: 'and',
      children: [
        { kind: 'predicate', op: 'gte', values: ['10'] },
        { kind: 'or', children: [{}, {}, { op: 'is_null', values: [] }] },
        { kind: 'predicate', op: 'in' },
      ],
    });
  });

  it.each([
    [
      'columna desconocida',
      { column: 'nope', op: 'equals', value: 'x' },
      'filter.column',
      'ROW_FILTER_COLUMN_UNKNOWN',
    ],
    [
      'contains en decimal',
      { column: 'c-price', op: 'contains', value: '1' },
      'filter.op',
      'ROW_FILTER_OPERATOR_INVALID',
    ],
    [
      'lt en booleano',
      { column: 'c-on', op: 'lt', value: true },
      'filter.op',
      'ROW_FILTER_OPERATOR_INVALID',
    ],
    [
      'decimal no canónico',
      { column: 'c-price', op: 'gt', value: '1e3' },
      'filter.value',
      'ROW_FILTER_VALUE_INVALID',
    ],
    [
      'número en lugar de cadena',
      { column: 'c-qty', op: 'equals', value: 3 },
      'filter.value',
      'ROW_FILTER_VALUE_INVALID',
    ],
    [
      'is_null con valor',
      { column: 'c-sku', op: 'is_null', value: 'x' },
      'filter.value',
      'ROW_FILTER_VALUE_INVALID',
    ],
    [
      'in vacío',
      { column: 'c-sku', op: 'in', value: [] },
      'filter.value',
      'ROW_FILTER_VALUE_INVALID',
    ],
    [
      'clave desconocida',
      { column: 'c-sku', op: 'equals', value: 'x', regex: '.*' },
      'filter',
      'ROW_FILTER_INVALID',
    ],
    [
      'operador desconocido',
      { column: 'c-sku', op: 'like', value: '%' },
      'filter',
      'ROW_FILTER_INVALID',
    ],
    ['and y or a la vez', { and: [], or: [] }, 'filter', 'ROW_FILTER_INVALID'],
  ])('rechaza %s', (_label, filter, field, code) => {
    expect(issuesOf({ filter })).toEqual([{ field, code }]);
  });

  it('señala el campo exacto dentro de un grupo', () => {
    expect(
      issuesOf({
        filter: {
          and: [
            { column: 'c-sku', op: 'equals', value: 'x' },
            { column: 'c-date', op: 'gt', value: '2026-13-01' },
          ],
        },
      }),
    ).toEqual([
      { field: 'filter.and.1.value', code: 'ROW_FILTER_VALUE_INVALID' },
    ]);
  });

  it('limita la profundidad a 3 niveles, los predicados a 20 y `in` a 100 valores', () => {
    const leaf = { column: 'c-sku', op: 'equals', value: 'x' };
    expect(issuesOf({ filter: { and: [{ or: [{ and: [leaf] }] }] } })).toEqual(
      [],
    );
    expect(
      issuesOf({ filter: { and: [{ or: [{ and: [{ or: [leaf] }] }] }] } }),
    ).toEqual([
      { field: 'filter.and.0.or.0.and.0.or', code: 'ROW_FILTER_INVALID' },
    ]);
    expect(
      issuesOf({ filter: { and: Array.from({ length: 21 }, () => leaf) } }),
    ).toEqual([{ field: 'filter', code: 'ROW_FILTER_INVALID' }]);
    expect(
      issuesOf({
        filter: {
          column: 'c-sku',
          op: 'in',
          value: Array.from({ length: 101 }, (_, i) => `v${i}`),
        },
      }),
    ).toEqual([{ field: 'filter.value', code: 'ROW_FILTER_VALUE_INVALID' }]);
  });

  it('valida las columnas de orden y de selección, y quita duplicados de la selección', () => {
    expect(
      issuesOf({
        sort: [{ columnId: 'nope', direction: 'asc' }],
        columns: ['c-sku', 'nope'],
      }),
    ).toEqual([
      { field: 'sort.0.columnId', code: 'ROW_FILTER_COLUMN_UNKNOWN' },
      { field: 'columns.1', code: 'ROW_FILTER_COLUMN_UNKNOWN' },
    ]);
    expect(queryOf({ columns: ['c-qty', 'c-sku', 'c-qty'] }).columnIds).toEqual(
      ['c-qty', 'c-sku'],
    );
  });
});

describe('Cursor de filas', () => {
  const cursor = {
    revisionId: 'rev-1',
    queryHash: 'a'.repeat(64),
    offset: 50,
  };

  it('se decodifica tal como se codificó', () => {
    expect(decodeRowCursor(encodeRowCursor(cursor))).toEqual(cursor);
  });

  it.each([
    ['texto cualquiera', 'hola'],
    ['JSON que no es cursor', Buffer.from('{"a":1}').toString('base64url')],
    ['desplazamiento negativo', encodeRowCursor({ ...cursor, offset: -1 })],
    ['desplazamiento enorme', encodeRowCursor({ ...cursor, offset: 999_999 })],
    ['hash corto', encodeRowCursor({ ...cursor, queryHash: 'abc' })],
  ])('rechaza %s', (_label, text) => {
    expect(decodeRowCursor(text)).toBeNull();
  });

  it('el hash depende del filtro, el orden y las columnas, pero no de cómo se escribió el JSON', () => {
    const base = queryOf({
      filter: { column: 'c-sku', op: 'equals', value: 'x' },
    });
    const sameWithKeysReordered = queryOf({
      filter: { value: 'x', op: 'equals', column: 'c-sku' },
    });
    const otherValue = queryOf({
      filter: { column: 'c-sku', op: 'equals', value: 'y' },
    });
    const otherSort = queryOf({
      filter: { column: 'c-sku', op: 'equals', value: 'x' },
      sort: [{ columnId: 'c-price', direction: 'desc' }],
    });

    expect(hashRowQuery(sameWithKeysReordered)).toBe(hashRowQuery(base));
    expect(hashRowQuery(otherValue)).not.toBe(hashRowQuery(base));
    expect(hashRowQuery(otherSort)).not.toBe(hashRowQuery(base));
  });
});
