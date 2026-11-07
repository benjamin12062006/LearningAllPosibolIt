import { describe, expect, it } from '@jest/globals';
import { inverseOperations } from '../../../src/changesets/changeset-revert.js';

const SKU = '00000000-0000-4000-8000-00000000c001';
const PRICE = '00000000-0000-4000-8000-00000000c002';
const ROW = '00000000-0000-4000-8000-0000000000a1';

describe('inverseOperations (D10, G6)', () => {
  it('una fila insertada por la revisión se borra si sigue viva', () => {
    const change = {
      rowId: ROW,
      sortKey: 'a',
      before: null,
      after: { [SKU]: 'N' },
    };
    expect(
      inverseOperations([change], new Map([[ROW, { [SKU]: 'N' }]])),
    ).toEqual([{ type: 'delete_row', rowId: ROW }]);
    expect(inverseOperations([change], new Map())).toEqual([]);
  });

  it('una fila borrada por la revisión vuelve con sus valores y su orden', () => {
    expect(
      inverseOperations(
        [
          {
            rowId: ROW,
            sortKey: 'k',
            before: { [SKU]: 'A', [PRICE]: '1', basura: 3 },
            after: null,
          },
        ],
        new Map(),
      ),
    ).toEqual([
      {
        type: 'insert_row',
        rowId: ROW,
        sortKey: 'k',
        values: { [SKU]: 'A', [PRICE]: '1' },
      },
    ]);
  });

  it('solo devuelve las celdas que cambió esa revisión y conserva ediciones posteriores de otras', () => {
    const operations = inverseOperations(
      [
        {
          rowId: ROW,
          sortKey: 'a',
          before: { [SKU]: 'A', [PRICE]: '1' },
          after: { [SKU]: 'A', [PRICE]: '2' },
        },
      ],
      // Después, otra revisión cambió el SKU: se queda como está.
      new Map([[ROW, { [SKU]: 'A-nuevo', [PRICE]: '2' }]]),
    );
    expect(operations).toEqual([
      { type: 'set_cell', rowId: ROW, columnId: PRICE, value: '1' },
    ]);
  });

  it('una celda que la revisión llenó vuelve a null, y lo ya revertido no genera nada', () => {
    const change = {
      rowId: ROW,
      sortKey: 'a',
      before: { [SKU]: 'A' },
      after: { [SKU]: 'A', [PRICE]: '2' },
    };
    expect(
      inverseOperations(
        [change],
        new Map([[ROW, { [SKU]: 'A', [PRICE]: '2' }]]),
      ),
    ).toEqual([{ type: 'set_cell', rowId: ROW, columnId: PRICE, value: null }]);
    expect(
      inverseOperations([change], new Map([[ROW, { [SKU]: 'A' }]])),
    ).toEqual([]);
  });

  it('si la fila editada se borró después, no hay nada que restaurar', () => {
    expect(
      inverseOperations(
        [
          {
            rowId: ROW,
            sortKey: 'a',
            before: { [SKU]: 'A' },
            after: { [SKU]: 'B' },
          },
        ],
        new Map(),
      ),
    ).toEqual([]);
  });
});
