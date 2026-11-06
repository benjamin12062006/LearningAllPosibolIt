import { describe, expect, it } from '@jest/globals';
import {
  planColumns,
  type ColumnRequest,
} from '../../../src/worksheets/column-plan.js';
import { evaluateRow } from '../../../src/worksheets/row-evaluation.js';
import type { WorksheetColumn } from '../../../src/worksheets/worksheets.types.js';

const ref = (column: string) => ({ column });
const op = (name: string, left: unknown, right: unknown) => ({
  op: name,
  args: [left, right],
});
function calculated(
  name: string,
  expression: unknown,
  scale = 2,
): ColumnRequest {
  return {
    name,
    type: 'calculated',
    required: false,
    formula: { expression, scale, rounding: 'half_up' },
  };
}

/** Las columnas tal como se guardan y se leen: con IDs, opciones y fórmula. */
function columnsOf(requests: ColumnRequest[]): WorksheetColumn[] {
  const plan = planColumns(requests);
  if (!plan.ok) throw new Error(JSON.stringify(plan.issues));
  return plan.columns.map((column) => ({
    id: column.columnId,
    name: column.name,
    type: column.type,
    position: column.position,
    required: column.required,
    ...(column.options ? { options: column.options } : {}),
    ...(column.formula ? { formula: column.formula } : {}),
  }));
}

// Los cuatro cálculos iniciales de docs-diagrams/12.
const columns = columnsOf([
  { name: 'SKU', type: 'text', required: true },
  { name: 'Costo', type: 'decimal', required: false },
  { name: 'Precio', type: 'decimal', required: false },
  { name: 'Cantidad', type: 'integer', required: false },
  {
    name: 'Estado',
    type: 'selection',
    required: false,
    options: [{ label: 'Nuevo' }, { label: 'Usado' }],
  },
  calculated('Costo total', op('mul', ref('Costo'), ref('Cantidad'))),
  calculated('Venta total', op('mul', ref('Precio'), ref('Cantidad'))),
  calculated('Beneficio', op('sub', ref('Venta total'), ref('Costo total'))),
  calculated(
    'Margen',
    op('div', op('sub', ref('Precio'), ref('Costo')), ref('Precio')),
    4,
  ),
]);
const id = Object.fromEntries(
  columns.map((column) => [column.name, column.id]),
);
const allIds = columns.map((column) => column.id);
const newOption = columns[4].options![0].id;

function valuesOf(cells: Record<string, unknown>) {
  const byName: Record<string, unknown> = {};
  for (const [name, columnId] of Object.entries(id))
    byName[name] = cells[columnId];
  return byName;
}

function row(cells: Record<string, unknown>) {
  const stored: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(cells)) stored[id[name]] = value;
  return stored;
}

describe('Evaluar una fila: calculadas y problemas', () => {
  it('calcula costo, venta, beneficio y margen con importes exactos', () => {
    const { values, problems } = evaluateRow(
      columns,
      row({
        SKU: '0001',
        Costo: '12.10',
        Precio: '19.99',
        Cantidad: '3',
        Estado: newOption,
      }),
      allIds,
    );

    expect(valuesOf(values)).toMatchObject({
      SKU: '0001',
      'Costo total': '36.30',
      'Venta total': '59.97',
      Beneficio: '23.67',
      Margen: '0.3947',
    });
    expect(problems).toEqual([]);
  });

  it('precio cero: el margen queda sin valor y con un problema explícito', () => {
    const { values, problems } = evaluateRow(
      columns,
      row({ SKU: 'A', Costo: '5', Precio: '0', Cantidad: '2' }),
      allIds,
    );

    expect(valuesOf(values).Margen).toBeNull();
    expect(problems).toEqual([
      { columnId: id.Margen, code: 'CALC_DIVISION_BY_ZERO' },
    ]);
  });

  it('una entrada vacía deja el cálculo vacío, sin problema; una mal guardada, con problema', () => {
    const empty = evaluateRow(columns, row({ SKU: 'A', Precio: '10' }), allIds);
    expect(valuesOf(empty.values)['Venta total']).toBeNull();
    expect(empty.problems).toEqual([]);

    const broken = evaluateRow(
      columns,
      row({ SKU: 'A', Costo: 'abc', Precio: '10', Cantidad: '1' }),
      [id.Costo, id['Costo total'], id.Margen],
    );
    expect(broken.problems).toEqual([
      { columnId: id.Costo, code: 'CELL_VALUE_INVALID' },
      { columnId: id['Costo total'], code: 'CALC_INPUT_INVALID' },
      { columnId: id.Margen, code: 'CALC_INPUT_INVALID' },
    ]);
  });

  it('señala la obligatoria vacía y la opción que no existe; respeta SKU con ceros', () => {
    const { values, problems } = evaluateRow(
      columns,
      row({ Estado: 'no-es-una-opcion' }),
      [id.SKU, id.Estado],
    );
    expect(problems).toEqual([
      { columnId: id.SKU, code: 'CELL_REQUIRED' },
      { columnId: id.Estado, code: 'CELL_VALUE_INVALID' },
    ]);
    expect(Object.keys(values)).toEqual([id.SKU, id.Estado]);

    expect(
      evaluateRow(columns, row({ SKU: '000123' }), [id.SKU]).values,
    ).toEqual({
      [id.SKU]: '000123',
    });
  });

  it('ignora un valor guardado para una calculada: su valor sale del motor', () => {
    const { values } = evaluateRow(
      columns,
      row({ SKU: 'A', Precio: '2', Cantidad: '3', 'Venta total': '999' }),
      [id['Venta total']],
    );

    expect(values).toEqual({ [id['Venta total']]: '6.00' });
  });

  it('una calculada que lee a otra usa el valor ya redondeado', () => {
    const chained = columnsOf([
      { name: 'A', type: 'decimal', required: false },
      calculated('Tercio', op('div', ref('A'), { value: '3' }), 2),
      calculated('Triple', op('mul', ref('Tercio'), { value: '3' }), 2),
    ]);
    const [a, third, triple] = chained.map((column) => column.id);

    expect(evaluateRow(chained, { [a]: '1' }, [third, triple]).values).toEqual({
      [third]: '0.33',
      [triple]: '0.99',
    });
  });
});
