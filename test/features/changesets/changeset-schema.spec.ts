import { describe, expect, it } from '@jest/globals';
import {
  compareOperations,
  contentHash,
} from '../../../src/changesets/changeset-diff.js';
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
const OTHER_NEW = '00000000-0000-4000-8000-00000000c0bb';
const ROW_A = '00000000-0000-4000-8000-0000000000a1';
const OPTION = '00000000-0000-4000-8000-0000000000d1';

/** Total = Precio × Cantidad: borrar cualquiera de las dos deja la fórmula sin entrada. */
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

const add = (columnId: string, name: string, extra: object = {}) => ({
  type: 'add_column',
  columnId,
  name,
  columnType: 'text',
  ...extra,
});

describe('cambios de esquema en un borrador (E4.7)', () => {
  it('añadir una columna permite escribir en ella en el mismo borrador, y va al final', () => {
    const result = normalize([
      { type: 'set_cell', rowId: ROW_A, columnId: NEW_COLUMN, value: 'rojo' },
      add(NEW_COLUMN, ' Color '),
    ]);
    expect(result).toMatchObject({
      ok: true,
      operations: [
        {
          type: 'add_column',
          columnId: NEW_COLUMN,
          name: 'Color',
          columnType: 'text',
        },
        { type: 'set_cell', rowId: ROW_A, columnId: NEW_COLUMN, value: 'rojo' },
      ],
    });
    expect(
      result.ok &&
        result.columns.map(({ id, position, required }) => [
          id,
          position,
          required,
        ]),
    ).toEqual([
      [SKU, 0, true],
      [PRICE, 1, false],
      [QUANTITY, 2, false],
      [TOTAL, 3, false],
      [NEW_COLUMN, 4, false],
    ]);
  });

  it('renombrar conserva el ID, así las fórmulas siguen apuntando a la columna (T06)', () => {
    const result = normalize([
      { type: 'rename_column', columnId: PRICE, name: 'Precio de venta' },
    ]);
    expect(result.ok).toBe(true);
    const renamed = result.ok ? result.columns : [];
    expect(renamed.find(({ id }) => id === PRICE)?.name).toBe(
      'Precio de venta',
    );
    expect(renamed.find(({ id }) => id === TOTAL)?.formula?.expression).toEqual(
      columns[3].formula?.expression,
    );
  });

  it('borrar una columna que usa una fórmula se rechaza en la operación que la borra (T06)', () => {
    expect(normalize([{ type: 'delete_column', columnId: QUANTITY }])).toEqual({
      ok: false,
      issues: [{ field: 'operations.0', code: 'COLUMN_IN_USE' }],
    });
  });

  it('se puede borrar si la fórmula que la usa también se borra', () => {
    const result = normalize([
      { type: 'delete_column', columnId: QUANTITY },
      { type: 'delete_column', columnId: TOTAL },
    ]);
    expect(result.ok && result.columns.map(({ id }) => id)).toEqual([
      SKU,
      PRICE,
    ]);
  });

  it('las filas ya no pueden escribir en una columna borrada en el borrador', () => {
    expect(
      normalize([
        { type: 'delete_column', columnId: SKU },
        { type: 'set_cell', rowId: ROW_A, columnId: SKU, value: 'B' },
      ]),
    ).toEqual({
      ok: false,
      issues: [{ field: 'operations.1', code: 'OPERATION_COLUMN_UNKNOWN' }],
    });
  });

  it('funde alta y renombre, anula alta y borrado, y descarta un renombre al mismo nombre', () => {
    const result = normalize([
      add(NEW_COLUMN, 'Color'),
      { type: 'rename_column', columnId: NEW_COLUMN, name: 'Tono' },
      add(OTHER_NEW, 'Temporal'),
      { type: 'delete_column', columnId: OTHER_NEW },
      { type: 'rename_column', columnId: SKU, name: 'SKU' },
    ]);
    expect(result).toMatchObject({
      ok: true,
      operations: [{ type: 'add_column', columnId: NEW_COLUMN, name: 'Tono' }],
    });
    expect(result.ok && result.operations).toHaveLength(1);
  });

  it('los nombres siguen siendo únicos, también al intercambiarlos', () => {
    expect(normalize([add(NEW_COLUMN, ' precio ')])).toEqual({
      ok: false,
      issues: [
        { field: 'operations.0.name', code: 'WORKSHEET_COLUMN_DUPLICATE' },
      ],
    });
    const swapped = normalize([
      { type: 'rename_column', columnId: SKU, name: 'Precio' },
      { type: 'rename_column', columnId: PRICE, name: 'SKU' },
    ]);
    expect(swapped.ok).toBe(true);
  });

  it('selección: crea IDs de opción y conserva los que ya trae', () => {
    const result = normalize([
      add(NEW_COLUMN, 'Estado', {
        columnType: 'selection',
        options: [{ id: OPTION, label: 'Activo' }, { label: 'Baja' }],
      }),
    ]);
    const options = result.ok ? result.columns[4].options : [];
    expect(options).toEqual([
      { id: OPTION, label: 'Activo' },
      { id: expect.stringMatching(/^[0-9a-f-]{36}$/), label: 'Baja' },
    ]);
    expect(
      normalize([add(NEW_COLUMN, 'Estado', { columnType: 'selection' })]),
    ).toMatchObject({
      ok: false,
      issues: [
        { field: 'operations.0.options', code: 'COLUMN_OPTIONS_INVALID' },
      ],
    });
  });

  it('rechaza IDs repetidos o desconocidos, tipos no permitidos y formas inválidas', () => {
    const result = normalize([
      add(PRICE, 'Otra'),
      { type: 'rename_column', columnId: NEW_COLUMN, name: 'X' },
      add(OTHER_NEW, 'Calculada', { columnType: 'calculated' }),
      { type: 'delete_column', columnId: SKU },
      { type: 'delete_column', columnId: SKU },
      { type: 'rename_column', columnId: SKU, name: '' },
      add(NEW_COLUMN, 'Con opciones', { options: [{ label: 'a' }] }),
    ]);
    expect(result.ok ? [] : result.issues).toEqual([
      { field: 'operations.0.columnId', code: 'OPERATION_COLUMN_EXISTS' },
      { field: 'operations.1.columnId', code: 'OPERATION_COLUMN_UNKNOWN' },
      { field: 'operations.2', code: 'OPERATION_INVALID' },
      { field: 'operations.4', code: 'OPERATION_INVALID' },
      { field: 'operations.5', code: 'OPERATION_INVALID' },
      { field: 'operations.6.options', code: 'COLUMN_OPTIONS_INVALID' },
    ]);
  });

  it('resultingColumns renumera posiciones y no toca las columnas de la base', () => {
    const result = resultingColumns(columns, [
      { type: 'delete_column', columnId: SKU },
      {
        type: 'add_column',
        columnId: NEW_COLUMN,
        name: 'N',
        columnType: 'boolean',
      },
    ]);
    expect(result.map(({ id, position }) => [id, position])).toEqual([
      [PRICE, 0],
      [QUANTITY, 1],
      [TOTAL, 2],
      [NEW_COLUMN, 3],
    ]);
    expect(columns[0].position).toBe(0);
  });
});

describe('comparar y firmar cambios de esquema', () => {
  const rename = {
    type: 'rename_column' as const,
    columnId: PRICE,
    name: 'Venta',
  };

  it('un cambio de esquema choca si otra revisión publicó otro esquema', () => {
    const removedColumnIds = new Set<string>();
    expect(
      compareOperations([rename], new Map(), new Map(), {
        changed: false,
        removedColumnIds,
      })[0],
    ).toMatchObject({ rowId: null, columnId: PRICE, status: 'change' });
    expect(
      compareOperations([rename], new Map(), new Map(), {
        changed: true,
        removedColumnIds,
      })[0],
    ).toMatchObject({ status: 'conflict', reason: 'schema_changed' });
  });

  it('escribir en una columna que otra revisión borró es conflicto estructural', () => {
    const entries = compareOperations(
      [
        { type: 'set_cell', rowId: ROW_A, columnId: PRICE, value: '3' },
        {
          type: 'insert_row',
          rowId: OTHER_NEW,
          sortKey: 'z',
          values: { [PRICE]: '1' },
        },
        { type: 'set_cell', rowId: ROW_A, columnId: SKU, value: 'B' },
      ],
      baseRows,
      baseRows,
      { changed: true, removedColumnIds: new Set([PRICE]) },
    );
    expect(entries.map(({ status, reason }) => [status, reason])).toEqual([
      ['conflict', 'column_deleted'],
      ['conflict', 'column_deleted'],
      ['change', null],
    ]);
  });

  it('la huella cambia con el nombre, el tipo o las opciones de una columna', () => {
    const content = (
      operations: Parameters<typeof contentHash>[0]['operations'],
    ) =>
      contentHash({
        worksheetId: SKU,
        baseRevisionId: PRICE,
        baseSchemaVersion: 1,
        operations,
      });
    const base = {
      type: 'add_column' as const,
      columnId: NEW_COLUMN,
      name: 'Estado',
      columnType: 'selection' as const,
      options: [{ id: OPTION, label: 'Activo' }],
    };
    const hashes = new Set([
      content([base]),
      content([{ ...base, name: 'Estados' }]),
      content([{ ...base, options: [{ id: OPTION, label: 'Activa' }] }]),
      content([{ ...base, columnType: 'text', options: undefined }]),
      content([rename]),
    ]);
    expect(hashes.size).toBe(5);
  });
});
