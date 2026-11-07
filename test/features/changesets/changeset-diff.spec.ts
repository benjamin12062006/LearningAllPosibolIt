import { describe, expect, it } from '@jest/globals';
import {
  compareOperations,
  contentHash,
  countByStatus,
  resultingRows,
  rowCountChange,
} from '../../../src/changesets/changeset-diff.js';
import type {
  Operation,
  RowValues,
} from '../../../src/changesets/changeset-operations.js';

const SKU = '00000000-0000-4000-8000-00000000c001';
const PRICE = '00000000-0000-4000-8000-00000000c002';
const ROW = '00000000-0000-4000-8000-0000000000a1';
const OTHER = '00000000-0000-4000-8000-0000000000b1';
const WORKSHEET = '00000000-0000-4000-8000-0000000000e1';
const BASE = '00000000-0000-4000-8000-0000000000e2';

const rows = (values?: Record<string, unknown>): RowValues =>
  values ? new Map([[ROW, values]]) : new Map();

function compareCell(
  base: string | null,
  head: string | null,
  proposed: string | null,
) {
  const [entry] = compareOperations(
    [{ type: 'set_cell', rowId: ROW, columnId: PRICE, value: proposed }],
    rows(base === null ? {} : { [PRICE]: base }),
    rows(head === null ? {} : { [PRICE]: head }),
  );
  return entry;
}

describe('compareOperations: tabla B/H/P de [13] (T08)', () => {
  it.each([
    // [base, head, propuesta, estado]
    ['1', '1', '2', 'change'],
    ['1', '1', '1', 'noop'],
    ['1', '2', '1', 'noop'],
    ['1', '2', '2', 'satisfied'],
    ['1', '2', '3', 'conflict'],
    [null, null, '2', 'change'],
    ['1', '1', null, 'change'],
    ['1', null, null, 'satisfied'],
    ['1', null, '3', 'conflict'],
  ] as const)('B=%s H=%s P=%s → %s', (base, head, proposed, status) => {
    expect(compareCell(base, head, proposed)).toMatchObject({
      base,
      head,
      proposed,
      status,
      reason: null,
    });
  });

  it('editar una celda de una fila que ya no existe es conflicto estructural', () => {
    const [entry] = compareOperations(
      [{ type: 'set_cell', rowId: ROW, columnId: PRICE, value: '2' }],
      rows({ [PRICE]: '1' }),
      rows(),
    );
    expect(entry).toMatchObject({
      status: 'conflict',
      reason: 'row_deleted',
      head: null,
    });
  });

  it('un vacío no es null: cambiar "" por null es un cambio', () => {
    const [entry] = compareOperations(
      [{ type: 'set_cell', rowId: ROW, columnId: SKU, value: null }],
      rows({ [SKU]: '' }),
      rows({ [SKU]: '' }),
    );
    expect(entry.status).toBe('change');
  });

  it('insertar: nueva → change; mismo ID con los mismos valores → satisfied; distintos → conflicto', () => {
    const insert: Operation = {
      type: 'insert_row',
      rowId: ROW,
      sortKey: 'a',
      values: { [SKU]: 'N' },
    };
    expect(compareOperations([insert], rows(), rows())[0].status).toBe(
      'change',
    );
    expect(
      compareOperations([insert], rows(), rows({ [SKU]: 'N' }))[0].status,
    ).toBe('satisfied');
    expect(
      compareOperations([insert], rows(), rows({ [SKU]: 'M' }))[0],
    ).toMatchObject({ status: 'conflict', reason: 'row_exists' });
  });

  it('borrar: sin cambios → change; ya borrada → satisfied; editada por otra persona → conflicto', () => {
    const remove: Operation = { type: 'delete_row', rowId: ROW };
    const base = rows({ [SKU]: 'A' });
    expect(compareOperations([remove], base, base)[0].status).toBe('change');
    expect(compareOperations([remove], base, rows())[0].status).toBe(
      'satisfied',
    );
    expect(
      compareOperations([remove], base, rows({ [SKU]: 'B' }))[0],
    ).toMatchObject({ status: 'conflict', reason: 'row_edited' });
  });

  it('cuenta las entradas por estado', () => {
    const entries = compareOperations(
      [
        { type: 'set_cell', rowId: ROW, columnId: PRICE, value: '2' },
        { type: 'set_cell', rowId: ROW, columnId: SKU, value: 'A' },
        { type: 'delete_row', rowId: OTHER },
      ],
      new Map([
        [ROW, { [PRICE]: '1', [SKU]: 'A' }],
        [OTHER, { [SKU]: 'B' }],
      ]),
      new Map([[ROW, { [PRICE]: '1', [SKU]: 'A' }]]),
    );
    expect(countByStatus(entries)).toEqual({
      change: 1,
      noop: 1,
      satisfied: 1,
      conflict: 0,
    });
  });
});

describe('resultingRows', () => {
  it('aplica ediciones, inserciones y borrados solo a las filas tocadas', () => {
    const result = resultingRows(
      [
        { type: 'set_cell', rowId: ROW, columnId: PRICE, value: null },
        { type: 'set_cell', rowId: ROW, columnId: SKU, value: 'A2' },
        { type: 'delete_row', rowId: OTHER },
        {
          type: 'insert_row',
          rowId: WORKSHEET,
          sortKey: 'z',
          values: { [SKU]: 'N' },
        },
      ],
      new Map([
        [ROW, { [PRICE]: '1', [SKU]: 'A' }],
        [OTHER, { [SKU]: 'B' }],
      ]),
    );
    expect([...result]).toEqual([
      [ROW, { [SKU]: 'A2' }],
      [WORKSHEET, { [SKU]: 'N' }],
    ]);
  });
});

describe('rowCountChange: filas que gana o pierde la hoja (límite de 5.000)', () => {
  const NEW = '00000000-0000-4000-8000-0000000000c1';

  it.each<[string, Operation[], number]>([
    [
      'insertar suma',
      [{ type: 'insert_row', rowId: NEW, sortKey: 'c', values: {} }],
      1,
    ],
    ['borrar resta', [{ type: 'delete_row', rowId: ROW }], -1],
    [
      'editar no cambia el recuento',
      [{ type: 'set_cell', rowId: ROW, columnId: PRICE, value: '2' }],
      0,
    ],
    [
      'borrar una e insertar otra se compensa',
      [
        { type: 'delete_row', rowId: ROW },
        { type: 'insert_row', rowId: NEW, sortKey: 'c', values: {} },
      ],
      0,
    ],
    [
      'un cambio de columnas no cuenta filas',
      [{ type: 'delete_column', columnId: PRICE }],
      0,
    ],
  ])('%s', (_label, operations, expected) => {
    expect(rowCountChange(operations, rows({ [PRICE]: '1' }))).toBe(expected);
  });
});

describe('contentHash (D4)', () => {
  const content = {
    worksheetId: WORKSHEET,
    baseRevisionId: BASE,
    baseSchemaVersion: 1,
    operations: [
      {
        type: 'insert_row',
        rowId: ROW,
        sortKey: 'a',
        values: { [SKU]: 'N', [PRICE]: '1' },
      },
    ] as Operation[],
  };

  it('no depende del orden de las claves de los valores', () => {
    const reordered = {
      ...content,
      operations: [
        {
          type: 'insert_row',
          rowId: ROW,
          sortKey: 'a',
          values: { [PRICE]: '1', [SKU]: 'N' },
        },
      ] as Operation[],
    };
    expect(contentHash(reordered)).toBe(contentHash(content));
    expect(contentHash(content)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('cambia con la base, el esquema o cualquier valor', () => {
    const hash = contentHash(content);
    expect(contentHash({ ...content, baseRevisionId: WORKSHEET })).not.toBe(
      hash,
    );
    expect(contentHash({ ...content, baseSchemaVersion: 2 })).not.toBe(hash);
    expect(
      contentHash({
        ...content,
        operations: [
          { type: 'set_cell', rowId: ROW, columnId: SKU, value: true },
        ],
      }),
    ).not.toBe(
      contentHash({
        ...content,
        operations: [
          { type: 'set_cell', rowId: ROW, columnId: SKU, value: 'true' },
        ],
      }),
    );
  });
});
