import { describe, expect, it } from '@jest/globals';
import {
  mentionedRowIds,
  normalizeOperations,
  type RowValues,
} from '../../../src/changesets/changeset-operations.js';
import type { WorksheetColumn } from '../../../src/worksheets/worksheets.types.js';

const SKU = '00000000-0000-4000-8000-00000000c001';
const PRICE = '00000000-0000-4000-8000-00000000c002';
const MARGIN = '00000000-0000-4000-8000-00000000c003';
const UNKNOWN_COLUMN = '00000000-0000-4000-8000-00000000c0ff';

const ROW_A = '00000000-0000-4000-8000-0000000000a1';
const ROW_B = '00000000-0000-4000-8000-0000000000b1';
const NEW_ROW = '00000000-0000-4000-8000-0000000000f1';

/** Precio va antes que SKU en la hoja: el resultado sigue esa posición. */
const columns: WorksheetColumn[] = [
  { id: SKU, name: 'SKU', type: 'text', position: 2, required: true },
  { id: PRICE, name: 'Precio', type: 'decimal', position: 1, required: false },
  {
    id: MARGIN,
    name: 'Margen',
    type: 'calculated',
    position: 3,
    required: false,
    formula: {
      engine: 'calc-v1',
      expression: { column: PRICE },
      scale: 2,
      rounding: 'half_up',
    },
  },
];

const baseRows: RowValues = new Map([
  [ROW_A, { [SKU]: 'A-001', [PRICE]: '10.00' }],
  [ROW_B, { [SKU]: 'B-002' }],
]);

/** Sin el esquema resultante: estas pruebas solo miran las operaciones. */
function normalize(input: unknown[]) {
  const result = normalizeOperations(input, {
    columns,
    baseRows,
    defaultSortKey: (index) => `auto#${index}`,
  });
  return result.ok
    ? { ok: true as const, operations: result.operations }
    : result;
}

const set = (rowId: string, columnId: string, value: unknown) => ({
  type: 'set_cell',
  rowId,
  columnId,
  value,
});

describe('normalizeOperations (D2)', () => {
  it('deja una sola escritura por celda: gana la última', () => {
    expect(
      normalize([
        set(ROW_A, PRICE, '11.00'),
        set(ROW_A, PRICE, '12.00'),
        set(ROW_A, SKU, 'A-XYZ'),
      ]),
    ).toEqual({
      ok: true,
      operations: [set(ROW_A, PRICE, '12.00'), set(ROW_A, SKU, 'A-XYZ')],
    });
  });

  it('ordena las celdas de una fila por la posición de su columna y las filas por aparición', () => {
    const result = normalize([
      set(ROW_B, SKU, 'B'),
      set(ROW_A, SKU, 'A'),
      set(ROW_A, PRICE, '1'),
    ]);
    expect(result).toEqual({
      ok: true,
      operations: [
        set(ROW_B, SKU, 'B'),
        set(ROW_A, PRICE, '1'),
        set(ROW_A, SKU, 'A'),
      ],
    });
  });

  it('funde las ediciones de una fila insertada en su inserción, y null quita la celda', () => {
    expect(
      normalize([
        { type: 'insert_row', rowId: NEW_ROW, values: { [SKU]: 'N-1' } },
        set(NEW_ROW, PRICE, '5.5'),
        set(NEW_ROW, SKU, null),
      ]),
    ).toEqual({
      ok: true,
      operations: [
        {
          type: 'insert_row',
          rowId: NEW_ROW,
          sortKey: 'auto#0',
          values: { [PRICE]: '5.5' },
        },
      ],
    });
  });

  it('respeta la clave de orden que trae la inserción', () => {
    const result = normalize([
      { type: 'insert_row', rowId: NEW_ROW, sortKey: 'm', values: {} },
    ]);
    expect(result).toMatchObject({
      ok: true,
      operations: [{ sortKey: 'm' }],
    });
  });

  it('borrar una fila insertada en el mismo borrador la anula del todo', () => {
    expect(
      normalize([
        { type: 'insert_row', rowId: NEW_ROW, values: { [SKU]: 'N' } },
        { type: 'delete_row', rowId: NEW_ROW },
      ]),
    ).toEqual({ ok: true, operations: [] });
  });

  it('borrar una fila de la base sustituye a sus ediciones previas', () => {
    expect(
      normalize([set(ROW_A, SKU, 'X'), { type: 'delete_row', rowId: ROW_A }]),
    ).toEqual({
      ok: true,
      operations: [{ type: 'delete_row', rowId: ROW_A }],
    });
  });

  it('editar una fila ya borrada en el borrador es un error con su posición', () => {
    expect(
      normalize([{ type: 'delete_row', rowId: ROW_A }, set(ROW_A, SKU, 'X')]),
    ).toEqual({
      ok: false,
      issues: [{ field: 'operations.1', code: 'OPERATION_INVALID' }],
    });
  });

  it('rechaza filas desconocidas, inserciones repetidas y columnas o valores inválidos', () => {
    const result = normalize([
      set(NEW_ROW, SKU, 'X'),
      { type: 'insert_row', rowId: ROW_A, values: {} },
      set(ROW_A, UNKNOWN_COLUMN, 'X'),
      set(ROW_A, MARGIN, '1'),
      set(ROW_A, PRICE, '1,5'),
      { type: 'delete_row', rowId: NEW_ROW },
      {
        type: 'insert_row',
        rowId: NEW_ROW,
        values: { [PRICE]: 'abc' },
      },
    ]);
    expect(result).toEqual({
      ok: false,
      issues: [
        { field: 'operations.0.rowId', code: 'OPERATION_ROW_UNKNOWN' },
        { field: 'operations.1.rowId', code: 'OPERATION_ROW_EXISTS' },
        { field: 'operations.2', code: 'OPERATION_COLUMN_UNKNOWN' },
        { field: 'operations.3', code: 'OPERATION_VALUE_INVALID' },
        { field: 'operations.4', code: 'OPERATION_VALUE_INVALID' },
        { field: 'operations.5.rowId', code: 'OPERATION_ROW_UNKNOWN' },
        {
          field: `operations.6.values.${PRICE}`,
          code: 'OPERATION_VALUE_INVALID',
        },
      ],
    });
  });

  it('rechaza formas desconocidas, claves de más e IDs que no son UUID', () => {
    const result = normalize([
      { type: 'rename_row', rowId: ROW_A },
      { ...set(ROW_A, SKU, 'X'), extra: true },
      set('fila-1', SKU, 'X'),
      { type: 'set_cell', rowId: ROW_A, columnId: SKU },
      { type: 'insert_row', rowId: NEW_ROW, sortKey: '' },
      null,
    ]);
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? [] : result.issues.map(({ field }) => field)).toEqual([
      'operations.0',
      'operations.1',
      'operations.2',
      'operations.3',
      'operations.4',
      'operations.5',
    ]);
  });

  it('mentionedRowIds recoge los IDs aunque la petición esté mal formada', () => {
    expect(
      mentionedRowIds([
        set(ROW_A, SKU, 'X'),
        { rowId: ROW_A },
        { rowId: ROW_B, nonsense: 1 },
        { rowId: 3 },
        'texto',
      ]),
    ).toEqual([ROW_A, ROW_B]);
  });
});
