import { describe, expect, it } from '@jest/globals';
import { contentHash } from '../../../src/changesets/changeset-diff.js';
import {
  normalizeOperations,
  type RowValues,
} from '../../../src/changesets/changeset-operations.js';
import { resultingColumns } from '../../../src/changesets/changeset-schema.js';
import type { WorksheetColumn } from '../../../src/worksheets/worksheets.types.js';

const SKU = '00000000-0000-4000-8000-00000000c001';
const PRICE = '00000000-0000-4000-8000-00000000c002';
const QUANTITY = '00000000-0000-4000-8000-00000000c003';
const TOTAL = '00000000-0000-4000-8000-00000000c004';
const NEW_COLUMN = '00000000-0000-4000-8000-00000000c0aa';
const UNKNOWN = '00000000-0000-4000-8000-00000000c0ff';
const ROW_A = '00000000-0000-4000-8000-0000000000a1';
const OPTION = '00000000-0000-4000-8000-0000000000d1';

/** Total = Precio × Cantidad: sus entradas tienen que seguir siendo numéricas. */
const columns: WorksheetColumn[] = [
  { id: SKU, name: 'SKU', type: 'text', position: 0, required: true },
  { id: PRICE, name: 'Precio', type: 'decimal', position: 1, required: false },
  {
    id: QUANTITY,
    name: 'Cantidad',
    type: 'integer',
    position: 2,
    required: false,
  },
  {
    id: TOTAL,
    name: 'Total',
    type: 'calculated',
    position: 3,
    required: false,
    formula: {
      engine: 'calc-v1',
      expression: {
        op: 'mul',
        args: [{ column: PRICE }, { column: QUANTITY }],
      },
      scale: 2,
      rounding: 'half_up',
    },
  },
];
const baseRows: RowValues = new Map([[ROW_A, { [SKU]: 'A', [PRICE]: '2' }]]);

function normalize(input: unknown[]) {
  return normalizeOperations(input, {
    columns,
    baseRows,
    defaultSortKey: () => 'auto',
  });
}

const retype = (columnId: string, columnType: string, extra: object = {}) => ({
  type: 'change_column_type',
  columnId,
  columnType,
  ...extra,
});

function issuesOf(input: unknown[]) {
  const result = normalize(input);
  return result.ok ? [] : result.issues;
}

describe('change_column_type en un borrador (C5, E4.8)', () => {
  it('cambia el tipo y conserva nombre, posición y obligatoriedad; hacia selección, con sus opciones', () => {
    const result = normalize([
      retype(SKU, 'selection', { options: [{ id: OPTION, label: 'A' }] }),
      { type: 'rename_column', columnId: SKU, name: 'Código' },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operations).toEqual([
      { type: 'rename_column', columnId: SKU, name: 'Código' },
      {
        type: 'change_column_type',
        columnId: SKU,
        columnType: 'selection',
        options: [{ id: OPTION, label: 'A' }],
      },
    ]);
    expect(result.columns[0]).toEqual({
      id: SKU,
      name: 'Código',
      type: 'selection',
      position: 0,
      required: true,
      options: [{ id: OPTION, label: 'A' }],
    });
  });

  it('una celda del mismo borrador se valida contra el tipo nuevo', () => {
    expect(
      issuesOf([
        retype(PRICE, 'integer'),
        { type: 'set_cell', rowId: ROW_A, columnId: PRICE, value: '2.5' },
      ]),
    ).toEqual([{ field: 'operations.1', code: 'OPERATION_VALUE_INVALID' }]);
    expect(
      issuesOf([
        retype(PRICE, 'integer'),
        { type: 'set_cell', rowId: ROW_A, columnId: PRICE, value: '2' },
      ]),
    ).toEqual([]);
  });

  it('desde selección a otro tipo se quitan sus opciones', () => {
    const selection: WorksheetColumn = {
      ...columns[0],
      type: 'selection',
      options: [{ id: OPTION, label: 'A' }],
    };
    expect(
      resultingColumns(
        [selection],
        [{ type: 'change_column_type', columnId: SKU, columnType: 'text' }],
      ),
    ).toEqual([{ ...columns[0], type: 'text' }]);
  });

  it.each([
    [
      'al mismo tipo',
      [retype(PRICE, 'decimal')],
      'operations.0',
      'OPERATION_INVALID',
    ],
    [
      'una calculada',
      [retype(TOTAL, 'decimal')],
      'operations.0',
      'OPERATION_INVALID',
    ],
    [
      'una columna desconocida',
      [retype(UNKNOWN, 'text')],
      'operations.0.columnId',
      'OPERATION_COLUMN_UNKNOWN',
    ],
    [
      'una columna añadida en el mismo borrador',
      [
        {
          type: 'add_column',
          columnId: NEW_COLUMN,
          name: 'Nueva',
          columnType: 'text',
        },
        retype(NEW_COLUMN, 'integer'),
      ],
      'operations.1.columnId',
      'OPERATION_INVALID',
    ],
    [
      'dos veces la misma columna',
      [retype(SKU, 'integer'), retype(SKU, 'decimal')],
      'operations.1',
      'OPERATION_INVALID',
    ],
    [
      'después de borrarla',
      [{ type: 'delete_column', columnId: SKU }, retype(SKU, 'integer')],
      'operations.1',
      'OPERATION_INVALID',
    ],
    [
      'y borrarla después',
      [retype(SKU, 'integer'), { type: 'delete_column', columnId: SKU }],
      'operations.1',
      'OPERATION_INVALID',
    ],
    [
      'hacia selección sin opciones',
      [retype(SKU, 'selection')],
      'operations.0.options',
      'COLUMN_OPTIONS_INVALID',
    ],
    [
      'con opciones hacia otro tipo',
      [retype(SKU, 'integer', { options: [{ label: 'A' }] })],
      'operations.0.options',
      'COLUMN_OPTIONS_INVALID',
    ],
    [
      'una entrada de una calculada hacia un tipo no numérico',
      [retype(QUANTITY, 'text')],
      'operations.0',
      'COLUMN_IN_USE',
    ],
  ])('rechaza cambiar %s', (_case, input, field, code) => {
    expect(issuesOf(input)).toEqual([{ field, code }]);
  });

  it('una entrada de una calculada sí puede pasar de entero a decimal', () => {
    expect(issuesOf([retype(QUANTITY, 'decimal')])).toEqual([]);
  });

  it('la huella del contenido cambia con el tipo y con las opciones', () => {
    const hashOf = (operation: object) =>
      contentHash({
        worksheetId: 'sheet',
        baseRevisionId: 'rev',
        baseSchemaVersion: 1,
        operations: [operation as never],
      });
    expect(hashOf(retype(SKU, 'integer'))).not.toBe(
      hashOf(retype(SKU, 'decimal')),
    );
    expect(
      hashOf(
        retype(SKU, 'selection', { options: [{ id: OPTION, label: 'A' }] }),
      ),
    ).not.toBe(
      hashOf(
        retype(SKU, 'selection', { options: [{ id: OPTION, label: 'B' }] }),
      ),
    );
  });
});
