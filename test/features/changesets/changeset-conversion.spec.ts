import { describe, expect, it } from '@jest/globals';
import {
  planConversion,
  retypedColumnIds,
} from '../../../src/changesets/changeset-conversion.js';
import type { Operation } from '../../../src/changesets/changeset-operations.js';
import type { WorksheetColumn } from '../../../src/worksheets/worksheets.types.js';

const PRICE = '00000000-0000-4000-8000-00000000c001';
const NOTE = '00000000-0000-4000-8000-00000000c002';

const COLUMNS: WorksheetColumn[] = [
  { id: PRICE, name: 'Precio', type: 'text', position: 0, required: false },
  { id: NOTE, name: 'Nota', type: 'text', position: 1, required: false },
];

const TO_DECIMAL: Operation = {
  type: 'change_column_type',
  columnId: PRICE,
  columnType: 'decimal',
};

const rows = (entries: [string, Record<string, unknown>][]) => new Map(entries);

describe('planConversion: la conversión de un borrador, calculada desde la base (C5)', () => {
  it('convierte cada celda con valor, cuenta las incompatibles y deja las vacías', () => {
    const plan = planConversion(
      [TO_DECIMAL],
      COLUMNS,
      rows([
        ['r1', { [PRICE]: '10.50', [NOTE]: 'x' }],
        ['r2', { [PRICE]: 'abc' }],
        ['r3', { [NOTE]: 'sin precio' }],
        ['r4', { [PRICE]: '' }],
      ]),
    );

    expect(plan).toEqual({
      operations: [
        { type: 'set_cell', rowId: 'r1', columnId: PRICE, value: '10.50' },
      ],
      conversions: [
        {
          columnId: PRICE,
          fromType: 'text',
          toType: 'decimal',
          convertedCells: 1,
          incompatibleCells: 2,
        },
      ],
      incompatible: [
        { rowId: 'r2', columnId: PRICE },
        { rowId: 'r4', columnId: PRICE },
      ],
    });
  });

  it('se salta las filas que el borrador borra y las celdas que el borrador ya fija', () => {
    const plan = planConversion(
      [
        TO_DECIMAL,
        { type: 'set_cell', rowId: 'r2', columnId: PRICE, value: '0.00' },
        { type: 'set_cell', rowId: 'r1', columnId: NOTE, value: 'otra' },
        { type: 'delete_row', rowId: 'r3' },
      ],
      COLUMNS,
      rows([
        ['r1', { [PRICE]: '1' }],
        ['r2', { [PRICE]: 'abc' }],
        ['r3', { [PRICE]: 'xyz' }],
      ]),
    );

    expect(plan.operations).toEqual([
      { type: 'set_cell', rowId: 'r1', columnId: PRICE, value: '1' },
    ]);
    expect(plan.incompatible).toEqual([]);
    expect(plan.conversions[0]).toMatchObject({
      convertedCells: 1,
      incompatibleCells: 0,
    });
  });

  it('sin cambio de tipo no hay nada que convertir ni filas que leer', () => {
    const operations: Operation[] = [
      { type: 'rename_column', columnId: PRICE, name: 'Coste' },
    ];

    expect(retypedColumnIds(operations)).toEqual([]);
    expect(
      planConversion(operations, COLUMNS, rows([['r1', { [PRICE]: 'x' }]])),
    ).toEqual({ operations: [], conversions: [], incompatible: [] });
  });

  it('hacia selección usa las opciones nuevas', () => {
    const option = { id: '00000000-0000-4000-8000-0000000000a1', label: 'x' };
    const plan = planConversion(
      [
        {
          type: 'change_column_type',
          columnId: NOTE,
          columnType: 'selection',
          options: [option],
        },
      ],
      COLUMNS,
      rows([
        ['r1', { [NOTE]: 'x' }],
        ['r2', { [NOTE]: 'y' }],
      ]),
    );

    expect(plan.operations).toEqual([
      { type: 'set_cell', rowId: 'r1', columnId: NOTE, value: option.id },
    ]);
    expect(plan.incompatible).toEqual([{ rowId: 'r2', columnId: NOTE }]);
  });
});
