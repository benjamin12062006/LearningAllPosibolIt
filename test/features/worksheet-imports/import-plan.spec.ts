import { describe, expect, it } from '@jest/globals';
import type { RowValues } from '../../../src/changesets/changeset-operations.js';
import {
  parseImportOptions,
  type CsvImportOptions,
} from '../../../src/worksheet-imports/import-options.js';
import {
  convert,
  planImport,
} from '../../../src/worksheet-imports/import-plan.js';
import type { ImportField } from '../../../src/worksheet-imports/worksheet-imports.types.js';
import type { WorksheetColumn } from '../../../src/worksheets/worksheets.types.js';

const SKU = '00000000-0000-4000-8000-00000000c001';
const PRICE = '00000000-0000-4000-8000-00000000c002';
const ACTIVE = '00000000-0000-4000-8000-00000000c003';
const STATE = '00000000-0000-4000-8000-00000000c004';
const TOTAL = '00000000-0000-4000-8000-00000000c005';
const OPEN = '00000000-0000-4000-8000-0000000000d1';
const ROW_A = '00000000-0000-4000-8000-0000000000a1';
const ROW_B = '00000000-0000-4000-8000-0000000000b1';

const columns: WorksheetColumn[] = [
  { id: SKU, name: 'SKU', type: 'text', position: 0, required: true },
  { id: PRICE, name: 'Precio', type: 'decimal', position: 1, required: false },
  { id: ACTIVE, name: 'Activo', type: 'boolean', position: 2, required: false },
  {
    id: STATE,
    name: 'Estado',
    type: 'selection',
    position: 3,
    required: false,
    options: [{ id: OPEN, label: 'Abierto' }],
  },
  {
    id: TOTAL,
    name: 'Total',
    type: 'calculated',
    position: 4,
    required: false,
    formula: {
      engine: 'calc-v1',
      expression: { column: PRICE },
      scale: 2,
      rounding: 'half_up',
    },
  },
];

function options(overrides: Partial<CsvImportOptions> = {}): CsvImportOptions {
  return {
    format: 'csv',
    title: 'Importar CSV',
    delimiter: 'comma',
    mode: 'append',
    matchColumnId: null,
    decimalSeparator: '.',
    booleanLabels: { true: ['true'], false: ['false'] },
    columns: [
      { header: 'sku', columnId: SKU },
      { header: 'precio', columnId: PRICE },
    ],
    excludeRows: [],
    ...overrides,
  };
}

function plan(
  rows: ImportField[][],
  overrides: Partial<CsvImportOptions> = {},
  sheet: RowValues = new Map(),
  headers = ['sku', 'precio', 'otra'],
) {
  let next = 0;
  return planImport({
    table: {
      format: 'csv',
      headers,
      rows,
      fileHash: 'f'.repeat(64),
      fileBytes: 10,
    },
    columns,
    rows: sheet,
    options: options(overrides),
    sortPrefix: 'T',
    newId: () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`,
  });
}

describe('convert: texto del archivo → valor canónico (D4, T04)', () => {
  const rules = {
    decimalSeparator: '.' as const,
    booleanLabels: { true: ['sí'], false: ['no'] },
  };
  it.each([
    [columns[0], '007', { kind: 'value', value: '007' }],
    [columns[0], ' con espacios ', { kind: 'value', value: ' con espacios ' }],
    [columns[0], '', { kind: 'empty' }],
    [columns[1], '19.990', { kind: 'value', value: '19.990' }],
    [columns[1], '1e3', { kind: 'invalid' }],
    [columns[1], ' 2', { kind: 'invalid' }],
    [columns[2], 'sí', { kind: 'value', value: true }],
    [columns[2], 'true', { kind: 'invalid' }],
    [columns[3], 'Abierto', { kind: 'value', value: OPEN }],
    [columns[3], 'abierto', { kind: 'invalid' }],
  ])('%#: %s', (column, raw, expected) => {
    expect(convert(column, raw, rules)).toEqual(expected);
  });

  it('con coma decimal convierte «1,50» y rechaza el punto', () => {
    const comma = { ...rules, decimalSeparator: ',' as const };
    expect(convert(columns[1], '1,50', comma)).toEqual({
      kind: 'value',
      value: '1.50',
    });
    expect(convert(columns[1], '1.50', comma)).toEqual({ kind: 'invalid' });
  });
});

describe('convert: celdas de XLSX con tipo (D13, T13)', () => {
  const column = (id: string) => columns.find((c) => c.id === id)!;
  const DATE: WorksheetColumn = {
    id: '00000000-0000-4000-8000-00000000c006',
    name: 'Alta',
    type: 'date',
    position: 5,
    required: false,
  };
  const INTEGER: WorksheetColumn = { ...DATE, name: 'Stock', type: 'integer' };
  // Con coma decimal y etiquetas propias: no afectan a las celdas con tipo.
  const textRules = {
    decimalSeparator: ',' as const,
    booleanLabels: { true: ['sí'], false: ['no'] },
  };

  it.each<[string, WorksheetColumn, ImportField, unknown]>([
    [
      'número a decimal, sin separador',
      column(PRICE),
      { kind: 'number', text: '10.5' },
      { kind: 'value', value: '10.5' },
    ],
    [
      'número a texto',
      column(SKU),
      { kind: 'number', text: '7' },
      { kind: 'value', value: '7' },
    ],
    [
      'número entero',
      INTEGER,
      { kind: 'number', text: '12' },
      { kind: 'value', value: '12' },
    ],
    [
      'número con decimales a entero',
      INTEGER,
      { kind: 'number', text: '1.5' },
      { kind: 'invalid' },
    ],
    [
      'fecha',
      DATE,
      { kind: 'date', text: '2026-03-15' },
      { kind: 'value', value: '2026-03-15' },
    ],
    [
      'número a fecha',
      DATE,
      { kind: 'number', text: '46096' },
      { kind: 'invalid' },
    ],
    [
      'fecha a decimal',
      column(PRICE),
      { kind: 'date', text: '2026-03-15' },
      { kind: 'invalid' },
    ],
    [
      'booleano',
      column(ACTIVE),
      { kind: 'boolean', text: 'false' },
      { kind: 'value', value: false },
    ],
    [
      'texto a booleano con etiqueta',
      column(ACTIVE),
      'sí',
      { kind: 'value', value: true },
    ],
    [
      'texto con coma a decimal',
      column(PRICE),
      '1,50',
      { kind: 'value', value: '1.50' },
    ],
    [
      'error de fórmula',
      column(PRICE),
      { kind: 'error', text: '#DIV/0!' },
      { kind: 'invalid', code: 'XLSX_CELL_ERROR' },
    ],
    [
      'error en texto',
      column(SKU),
      { kind: 'error', text: '#N/A' },
      { kind: 'invalid', code: 'XLSX_CELL_ERROR' },
    ],
    [
      'fórmula sin valor',
      column(SKU),
      { kind: 'uncalculated', text: '' },
      { kind: 'invalid', code: 'XLSX_FORMULA_NOT_CALCULATED' },
    ],
    [
      'celda ausente',
      column(SKU),
      undefined as unknown as ImportField,
      { kind: 'empty' },
    ],
  ])('%s', (_label, target, field, expected) => {
    expect(convert(target, field, textRules)).toEqual(expected);
  });

  it('un error de fórmula es un problema de la fila con su código, nunca un vacío', () => {
    const result = plan([['A', { kind: 'error', text: '#DIV/0!' }]]);
    expect(result).toMatchObject({
      ok: true,
      operations: [],
      problems: [{ sourceRow: 1, field: 'precio', code: 'XLSX_CELL_ERROR' }],
    });
  });
});

describe('planImport', () => {
  it('append: inserta en el orden del archivo, ignora cabeceras sin mapear y no escribe vacíos', () => {
    const result = plan([
      ['007', '10.50', 'x'],
      ['008', '', 'y'],
    ]);
    expect(result).toMatchObject({
      ok: true,
      problems: [],
      report: { rows: 2, inserted: 2, updated: 0, ignoredHeaders: ['otra'] },
      operations: [
        {
          type: 'insert_row',
          sortKey: 'T#00001',
          values: { [SKU]: '007', [PRICE]: '10.50' },
        },
        { type: 'insert_row', sortKey: 'T#00002', values: { [SKU]: '008' } },
      ],
    });
  });

  it('una fila con problemas no entra; excluida, queda registrada con sus códigos (T15)', () => {
    const rows = [
      ['A', '1'],
      ['', 'abc'],
      ['C', '3'],
    ];
    const failed = plan(rows);
    expect(failed).toMatchObject({
      ok: true,
      problems: [
        { sourceRow: 2, field: 'precio', code: 'CELL_VALUE_INVALID' },
        { sourceRow: 2, field: 'sku', code: 'CELL_REQUIRED' },
      ],
      report: { invalid: 1 },
    });

    const excluded = plan(rows, { excludeRows: [2, 3] });
    expect(excluded).toMatchObject({
      ok: true,
      problems: [],
      excluded: [
        { sourceRow: 2, codes: ['CELL_VALUE_INVALID', 'CELL_REQUIRED'] },
        { sourceRow: 3, codes: [] },
      ],
      included: [{ sourceRow: 1, action: 'insert' }],
      report: { inserted: 1, excluded: 2, invalid: 0 },
    });
  });

  it('upsert: actualiza solo celdas que cambian, inserta claves nuevas y no borra lo que falta', () => {
    const sheet: RowValues = new Map([
      [ROW_A, { [SKU]: 'A', [PRICE]: '1.00' }],
      [ROW_B, { [SKU]: 'B', [PRICE]: '2.00' }],
    ]);
    const result = plan(
      [
        ['A', '1.50'],
        ['B', ''],
        ['C', '3'],
      ],
      { mode: 'upsert', matchColumnId: SKU },
      sheet,
    );
    expect(result).toMatchObject({
      ok: true,
      problems: [],
      report: { updated: 1, unchanged: 1, inserted: 1 },
      included: [
        { sourceRow: 1, rowId: ROW_A, action: 'update' },
        { sourceRow: 2, rowId: ROW_B, action: 'unchanged' },
        { sourceRow: 3, action: 'insert' },
      ],
    });
    expect(result.ok && result.operations).toEqual([
      { type: 'set_cell', rowId: ROW_A, columnId: PRICE, value: '1.50' },
      expect.objectContaining({
        type: 'insert_row',
        values: { [SKU]: 'C', [PRICE]: '3' },
      }),
    ]);
  });

  it('upsert: clave vacía, repetida en el archivo o en la hoja es un problema de fila', () => {
    const sheet: RowValues = new Map([
      [ROW_A, { [SKU]: 'X' }],
      [ROW_B, { [SKU]: 'X' }],
    ]);
    const result = plan(
      [
        ['', '1'],
        ['D', '1'],
        ['D', '2'],
        ['X', '3'],
      ],
      { mode: 'upsert', matchColumnId: SKU },
      sheet,
    );
    expect(
      result.ok &&
        result.problems.map(({ sourceRow, code }) => [sourceRow, code]),
    ).toEqual([
      [1, 'IMPORT_KEY_MISSING'],
      [2, 'IMPORT_KEY_DUPLICATE'],
      [3, 'IMPORT_KEY_DUPLICATE'],
      [4, 'IMPORT_KEY_AMBIGUOUS'],
    ]);
  });

  it('una columna nueva entra como add_column y recibe valores; selección con opciones nuevas', () => {
    const result = plan([['A', 'rojo']], {
      columns: [
        { header: 'sku', columnId: SKU },
        {
          header: 'precio',
          newColumn: {
            name: 'Color',
            type: 'selection',
            options: [{ label: 'rojo' }],
          },
        },
      ],
    });
    expect(result.ok && result.operations).toEqual([
      {
        type: 'add_column',
        columnId: '00000000-0000-4000-8000-000000000001',
        name: 'Color',
        columnType: 'selection',
        options: [
          { id: '00000000-0000-4000-8000-000000000002', label: 'rojo' },
        ],
      },
      expect.objectContaining({
        type: 'insert_row',
        values: {
          [SKU]: 'A',
          '00000000-0000-4000-8000-000000000001':
            '00000000-0000-4000-8000-000000000002',
        },
      }),
    ]);
  });

  it('rechaza un mapeo con cabeceras o columnas repetidas o inexistentes, calculadas, nombres usados y clave sin mapear', () => {
    const result = plan([['A', '1']], {
      mode: 'upsert',
      matchColumnId: ACTIVE,
      columns: [
        { header: 'sku', columnId: SKU },
        { header: 'sku', columnId: PRICE },
        { header: 'falta', columnId: PRICE },
        { header: 'precio', columnId: TOTAL },
        { header: 'otra', newColumn: { name: ' precio ', type: 'text' } },
      ],
    });
    expect(result).toEqual({
      ok: false,
      code: 'IMPORT_MAPPING_INVALID',
      issues: [
        { field: 'columns.1.header', code: 'IMPORT_MAPPING_INVALID' },
        { field: 'columns.2.header', code: 'IMPORT_MAPPING_INVALID' },
        { field: 'columns.3.columnId', code: 'IMPORT_MAPPING_INVALID' },
        { field: 'columns.4.newColumn', code: 'IMPORT_MAPPING_INVALID' },
        { field: 'matchColumnId', code: 'IMPORT_MAPPING_INVALID' },
      ],
    });
  });

  it('una exclusión fuera del archivo se rechaza', () => {
    expect(plan([['A', '1']], { excludeRows: [2] })).toMatchObject({
      ok: false,
      code: 'IMPORT_OPTIONS_INVALID',
    });
  });
});

describe('parseImportOptions', () => {
  it('pone valores por defecto y acepta un mapeo mínimo', () => {
    expect(
      parseImportOptions(
        { mode: 'append', columns: [{ header: 'sku', columnId: SKU }] },
        'csv',
      ),
    ).toEqual({
      ok: true,
      options: options({ columns: [{ header: 'sku', columnId: SKU }] }),
    });
  });

  it('señala cada opción inválida', () => {
    const result = parseImportOptions(
      {
        mode: 'upsert',
        delimiter: 'tab',
        decimalSeparator: ';',
        booleanLabels: { true: ['x'], false: ['x'] },
        columns: [{ header: 'a' }],
        excludeRows: [1, 1],
        extra: true,
      },
      'csv',
    );
    expect(result.ok ? [] : result.issues.map(({ field }) => field)).toEqual([
      'extra',
      'delimiter',
      'matchColumnId',
      'decimalSeparator',
      'booleanLabels',
      'columns.0',
      'excludeRows',
    ]);
    expect(parseImportOptions('texto', 'csv')).toMatchObject({ ok: false });
  });

  it('cada formato tiene sus opciones: sheet y headerRow en XLSX, delimiter en CSV', () => {
    const base = {
      mode: 'append',
      columns: [{ header: 'sku', columnId: SKU }],
    };
    expect(parseImportOptions(base, 'xlsx')).toMatchObject({
      ok: true,
      options: {
        format: 'xlsx',
        title: 'Importar XLSX',
        sheet: null,
        headerRow: 1,
      },
    });
    expect(
      parseImportOptions({ ...base, sheet: 'Productos', headerRow: 3 }, 'xlsx'),
    ).toMatchObject({
      ok: true,
      options: { sheet: 'Productos', headerRow: 3 },
    });
    const fields = (raw: object, format: 'csv' | 'xlsx') => {
      const result = parseImportOptions({ ...base, ...raw }, format);
      return result.ok ? [] : result.issues.map(({ field }) => field);
    };
    expect(fields({ delimiter: 'comma' }, 'xlsx')).toEqual(['delimiter']);
    expect(fields({ sheet: 'Datos', headerRow: 2 }, 'csv')).toEqual([
      'sheet',
      'headerRow',
    ]);
    expect(fields({ sheet: '', headerRow: 0 }, 'xlsx')).toEqual([
      'sheet',
      'headerRow',
    ]);
    expect(fields({ headerRow: 1.5 }, 'xlsx')).toEqual(['headerRow']);
  });
});
