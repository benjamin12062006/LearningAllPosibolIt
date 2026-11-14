import { describe, expect, it } from '@jest/globals';
import { copyColumns } from '../../../src/worksheets/worksheet-copy.js';
import type { WorksheetColumn } from '../../../src/worksheets/worksheets.types.js';

const price: WorksheetColumn = {
  id: 'price',
  name: 'Precio',
  type: 'decimal',
  position: 0,
  required: true,
};
const cost: WorksheetColumn = {
  ...price,
  id: 'cost',
  name: 'Costo',
  position: 1,
};
const state: WorksheetColumn = {
  id: 'state',
  name: 'Estado',
  type: 'selection',
  position: 2,
  required: false,
  options: [{ id: 'new', label: 'Nuevo' }],
};
const margin: WorksheetColumn = {
  id: 'margin',
  name: ' Margen ',
  type: 'calculated',
  position: 3,
  required: false,
  formula: {
    engine: 'calc-v1',
    expression: {
      op: 'div',
      args: [
        { op: 'sub', args: [{ column: 'price' }, { column: 'cost' }] },
        { op: 'mul', args: [{ column: 'price' }, { value: '100' }] },
      ],
    },
    scale: 2,
    rounding: 'half_up',
  },
};

describe('copyColumns', () => {
  it('da un ID nuevo a cada columna y conserva lo demás', () => {
    const { columns, newIdOf } = copyColumns([price, cost, state]);

    expect(
      columns.map(({ name, type, position, required }) => ({
        name,
        type,
        position,
        required,
      })),
    ).toEqual([
      { name: 'Precio', type: 'decimal', position: 0, required: true },
      { name: 'Costo', type: 'decimal', position: 1, required: true },
      { name: 'Estado', type: 'selection', position: 2, required: false },
    ]);
    const ids = columns.map((column) => column.columnId);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) {
      expect(['price', 'cost', 'state']).not.toContain(id);
    }
    expect([...newIdOf.keys()]).toEqual(['price', 'cost', 'state']);
    expect(ids).toEqual(
      ['price', 'cost', 'state'].map((id) => newIdOf.get(id)),
    );
  });

  it('las opciones de selección conservan su ID y las demás columnas no tienen', () => {
    const { columns } = copyColumns([price, state]);

    expect(columns[1].options).toEqual([{ id: 'new', label: 'Nuevo' }]);
    expect(columns[0]).not.toHaveProperty('options');
    expect(columns[0]).not.toHaveProperty('formula');
  });

  it('reescribe todas las columnas de una fórmula anidada y deja los literales', () => {
    const { columns, newIdOf } = copyColumns([price, cost, margin]);
    const newPrice = newIdOf.get('price');
    const newCost = newIdOf.get('cost');

    expect(columns[2].formula).toEqual({
      engine: 'calc-v1',
      expression: {
        op: 'div',
        args: [
          { op: 'sub', args: [{ column: newPrice }, { column: newCost }] },
          { op: 'mul', args: [{ column: newPrice }, { value: '100' }] },
        ],
      },
      scale: 2,
      rounding: 'half_up',
    });
  });

  it('no cambia las columnas de origen', () => {
    const before = JSON.stringify(margin);

    copyColumns([price, cost, margin]);

    expect(JSON.stringify(margin)).toBe(before);
  });

  it('una fórmula que cita una columna que la hoja no tiene es un error', () => {
    expect(() => copyColumns([margin])).toThrow(
      'La fórmula cita una columna que la hoja no tiene: price.',
    );
  });
});
