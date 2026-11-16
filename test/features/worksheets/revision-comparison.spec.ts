import { describe, expect, it } from '@jest/globals';
import {
  comparableColumnIds,
  compareRows,
  compareSchemas,
  countByChange,
} from '../../../src/worksheets/revision-comparison.js';
import type { WorksheetColumn } from '../../../src/worksheets/worksheets.types.js';

const sku: WorksheetColumn = {
  id: 'c-sku',
  name: 'SKU',
  type: 'text',
  position: 0,
  required: true,
};
const price: WorksheetColumn = {
  id: 'c-price',
  name: 'Precio',
  type: 'decimal',
  position: 1,
  required: false,
};
const stock: WorksheetColumn = {
  id: 'c-stock',
  name: 'Cantidad',
  type: 'integer',
  position: 2,
  required: false,
};
const total: WorksheetColumn = {
  id: 'c-total',
  name: 'Total',
  type: 'decimal',
  position: 3,
  required: false,
  formula: {
    engine: 'ktsu-formula/1',
    expression: '=Precio*Cantidad',
    scale: 2,
    rounding: 'half_up',
  } as unknown as WorksheetColumn['formula'],
};

describe('Comparar dos revisiones de una hoja', () => {
  it('empareja columnas por ID: nuevas, quitadas y cambiadas', () => {
    const currency: WorksheetColumn = {
      id: 'c-currency',
      name: 'Moneda',
      type: 'text',
      position: 3,
      required: false,
    };
    const difference = compareSchemas(
      [sku, price, stock],
      [
        sku,
        { ...price, type: 'text' },
        { ...stock, name: 'Existencias', position: 0 },
        currency,
      ],
    );

    expect(difference.added).toEqual([
      { id: 'c-currency', name: 'Moneda', type: 'text' },
    ]);
    expect(difference.removed).toEqual([]);
    expect(difference.changed).toEqual([
      {
        id: 'c-price',
        fields: ['type'],
        before: { id: 'c-price', name: 'Precio', type: 'decimal' },
        after: { id: 'c-price', name: 'Precio', type: 'text' },
      },
      {
        id: 'c-stock',
        fields: ['name'],
        before: { id: 'c-stock', name: 'Cantidad', type: 'integer' },
        after: { id: 'c-stock', name: 'Existencias', type: 'integer' },
      },
    ]);
    expect(compareSchemas([sku, price], [sku]).removed).toEqual([
      { id: 'c-price', name: 'Precio', type: 'decimal' },
    ]);
  });

  it('solo compara celdas guardadas en las dos revisiones', () => {
    expect(
      comparableColumnIds([sku, price, total], [sku, total, stock]),
    ).toEqual(['c-sku']);
  });

  it('clasifica altas, bajas y ediciones; una celda sin clave es null', () => {
    const differences = compareRows(
      [
        { rowId: 'nueva', before: null, after: { 'c-sku': 'N-1' } },
        { rowId: 'borrada', before: { 'c-sku': 'B-1' }, after: null },
        {
          rowId: 'editada',
          before: { 'c-sku': 'E-1', 'c-price': '9.99' },
          after: { 'c-sku': 'E-1', 'c-price': '12.00' },
        },
        {
          rowId: 'vuelve-a-su-valor',
          before: { 'c-sku': 'V-1', 'c-price': null },
          after: { 'c-sku': 'V-1' },
        },
        // Sin versión en ninguna de las dos: nació y murió entre ellas.
        { rowId: 'efimera', before: null, after: null },
      ],
      ['c-sku', 'c-price'],
    );

    expect(differences).toEqual([
      {
        rowId: 'nueva',
        change: 'added',
        changedColumnIds: [],
        before: null,
        after: { 'c-sku': 'N-1' },
      },
      {
        rowId: 'borrada',
        change: 'removed',
        changedColumnIds: [],
        before: { 'c-sku': 'B-1' },
        after: null,
      },
      {
        rowId: 'editada',
        change: 'edited',
        changedColumnIds: ['c-price'],
        before: { 'c-price': '9.99' },
        after: { 'c-price': '12.00' },
      },
    ]);
    expect(countByChange(differences)).toEqual({
      added: 1,
      removed: 1,
      edited: 1,
    });
  });

  it('distingue texto vacío de celda vacía', () => {
    const [difference] = compareRows(
      [{ rowId: 'r', before: { 'c-sku': '' }, after: { 'c-sku': null } }],
      ['c-sku'],
    );
    expect(difference.changedColumnIds).toEqual(['c-sku']);
  });
});
