import { describe, expect, it } from '@jest/globals';
import {
  planColumns,
  type ColumnRequest,
  type PlannedColumn,
} from '../../../src/worksheets/column-plan.js';

const price: ColumnRequest = {
  name: 'Precio',
  type: 'decimal',
  required: false,
};
const cost: ColumnRequest = { name: 'Costo', type: 'decimal', required: false };
const quantity: ColumnRequest = {
  name: 'Cantidad',
  type: 'integer',
  required: false,
};

function calculated(
  name: string,
  expression: unknown,
  extra: Partial<{ scale: number; rounding: string; required: boolean }> = {},
): ColumnRequest {
  const { required = false, ...rules } = extra;
  return {
    name,
    type: 'calculated',
    required,
    formula: { expression, scale: 2, rounding: 'half_up', ...rules },
  };
}

const ref = (column: string) => ({ column });
const op = (name: string, left: unknown, right: unknown) => ({
  op: name,
  args: [left, right],
});

function planned(requests: ColumnRequest[]): readonly PlannedColumn[] {
  const plan = planColumns(requests);
  if (!plan.ok) throw new Error(JSON.stringify(plan.issues));
  return plan.columns;
}

function issuesOf(requests: ColumnRequest[]) {
  const plan = planColumns(requests);
  return plan.ok ? [] : plan.issues;
}

describe('Planificar las columnas de una hoja nueva', () => {
  it('da IDs distintos, posiciones y nombres normalizados', () => {
    const columns = planned([price, { ...quantity, name: ' Cantidad ' }]);

    expect(
      columns.map(({ position, nameNormalized }) => [position, nameNormalized]),
    ).toEqual([
      [0, 'precio'],
      [1, 'cantidad'],
    ]);
    expect(new Set(columns.map(({ columnId }) => columnId)).size).toBe(2);
  });

  it('señala cada nombre repetido sin distinguir mayúsculas ni espacios', () => {
    expect(
      issuesOf([
        price,
        cost,
        { ...quantity, name: ' precio ' },
        { ...cost, name: 'COSTO' },
      ]),
    ).toEqual([
      { field: 'columns.2.name', code: 'WORKSHEET_COLUMN_DUPLICATE' },
      { field: 'columns.3.name', code: 'WORKSHEET_COLUMN_DUPLICATE' },
    ]);
  });

  describe('selección', () => {
    it('da un ID estable a cada opción y conserva la etiqueta', () => {
      const [status] = planned([
        {
          name: 'Estado',
          type: 'selection',
          required: true,
          options: [{ label: 'Nuevo' }, { label: 'Usado' }],
        },
      ]);

      expect(status.options).toEqual([
        { id: expect.any(String), label: 'Nuevo' },
        { id: expect.any(String), label: 'Usado' },
      ]);
    });

    it.each<[string, ColumnRequest]>([
      ['sin opciones', { name: 'E', type: 'selection', required: false }],
      [
        'lista vacía',
        { name: 'E', type: 'selection', required: false, options: [] },
      ],
      [
        'etiquetas repetidas',
        {
          name: 'E',
          type: 'selection',
          required: false,
          options: [{ label: 'A' }, { label: ' a ' }],
        },
      ],
      [
        'más de 100 opciones',
        {
          name: 'E',
          type: 'selection',
          required: false,
          options: Array.from({ length: 101 }, (_, i) => ({ label: `o${i}` })),
        },
      ],
      ['opciones en otra columna', { ...price, options: [{ label: 'A' }] }],
    ])('rechaza %s', (_label, request) => {
      expect(issuesOf([request])).toEqual([
        { field: 'columns.0.options', code: 'COLUMN_OPTIONS_INVALID' },
      ]);
    });
  });

  describe('calculadas', () => {
    it('guarda la fórmula con IDs de columna, no con nombres (T06)', () => {
      const [priceColumn, quantityColumn, total] = planned([
        price,
        quantity,
        calculated('Total', op('mul', ref('precio'), ref('CANTIDAD'))),
      ]);

      expect(total.formula).toEqual({
        engine: 'calc-v1',
        expression: {
          op: 'mul',
          args: [
            { column: priceColumn.columnId },
            { column: quantityColumn.columnId },
          ],
        },
        scale: 2,
        rounding: 'half_up',
      });
      expect(JSON.stringify(total.formula)).not.toContain('Precio');
    });

    it('admite una calculada que usa otra y constantes decimales', () => {
      const columns = planned([
        price,
        cost,
        calculated('Beneficio', op('sub', ref('Precio'), ref('Costo'))),
        calculated('Margen', op('div', ref('Beneficio'), ref('Precio')), {
          scale: 4,
        }),
        calculated('Con IVA', op('mul', ref('Precio'), { value: '1.16' })),
      ]);

      expect(columns[3].formula?.scale).toBe(4);
      expect(columns[4].formula?.expression).toMatchObject({
        args: [{}, { value: '1.16' }],
      });
    });

    it.each<[string, ColumnRequest[], string, string]>([
      [
        'columna inexistente',
        [calculated('T', ref('Nada'))],
        'columns.0.formula.expression.column',
        'COLUMN_FORMULA_REFERENCE_INVALID',
      ],
      [
        'columna de texto',
        [
          { name: 'SKU', type: 'text', required: false },
          calculated('T', ref('SKU')),
        ],
        'columns.1.formula.expression.column',
        'COLUMN_FORMULA_REFERENCE_INVALID',
      ],
      [
        'operador desconocido',
        [price, calculated('T', op('pow', ref('Precio'), ref('Precio')))],
        'columns.1.formula.expression',
        'COLUMN_FORMULA_INVALID',
      ],
      [
        'un solo argumento',
        [price, calculated('T', { op: 'add', args: [ref('Precio')] })],
        'columns.1.formula.expression',
        'COLUMN_FORMULA_INVALID',
      ],
      [
        'constante numérica en lugar de texto',
        [price, calculated('T', op('mul', ref('Precio'), { value: 1.16 }))],
        'columns.1.formula.expression.args.1',
        'COLUMN_FORMULA_INVALID',
      ],
      [
        'escala fuera de rango',
        [price, calculated('T', ref('Precio'), { scale: 7 })],
        'columns.1.formula',
        'COLUMN_FORMULA_INVALID',
      ],
      [
        'redondeo desconocido',
        [price, calculated('T', ref('Precio'), { rounding: 'ceil' })],
        'columns.1.formula',
        'COLUMN_FORMULA_INVALID',
      ],
      [
        'calculada obligatoria',
        [price, calculated('T', ref('Precio'), { required: true })],
        'columns.1.required',
        'COLUMN_FORMULA_INVALID',
      ],
      [
        'fórmula en otra columna',
        [
          {
            ...price,
            formula: {
              expression: ref('Precio'),
              scale: 2,
              rounding: 'half_up',
            },
          },
        ],
        'columns.0.formula',
        'COLUMN_FORMULA_INVALID',
      ],
    ])('rechaza %s', (_label, requests, field, code) => {
      expect(issuesOf(requests)).toEqual([{ field, code }]);
    });

    it('limita la profundidad a 5 y el árbol a 25 nodos', () => {
      const deep = op(
        'add',
        op(
          'add',
          op('add', op('add', ref('Precio'), ref('Precio')), ref('Precio')),
          ref('Precio'),
        ),
        ref('Precio'),
      );
      expect(issuesOf([price, calculated('T', deep)])).toEqual([]);
      expect(
        issuesOf([price, calculated('T', op('add', deep, ref('Precio')))]),
      ).toContainEqual({
        field:
          'columns.1.formula.expression.args.0.args.0.args.0.args.0.args.0',
        code: 'COLUMN_FORMULA_INVALID',
      });

      // 13 hojas y 12 operaciones = 25 nodos; uno más pasa el límite.
      const wide = (leaves: number): unknown =>
        leaves === 1
          ? ref('Precio')
          : op(
              'add',
              wide(Math.floor(leaves / 2)),
              wide(Math.ceil(leaves / 2)),
            );
      expect(issuesOf([price, calculated('T', wide(13))])).toEqual([]);
      expect(issuesOf([price, calculated('T', wide(14))])).toEqual([
        {
          field: 'columns.1.formula.expression',
          code: 'COLUMN_FORMULA_INVALID',
        },
      ]);
    });

    it('detecta ciclos directos e indirectos y marca cada columna del ciclo', () => {
      expect(issuesOf([calculated('A', ref('A'))])).toEqual([
        { field: 'columns.0.formula', code: 'COLUMN_FORMULA_CYCLE' },
      ]);
      expect(
        issuesOf([
          price,
          calculated('A', op('add', ref('B'), ref('Precio'))),
          calculated('B', op('mul', ref('C'), ref('Precio'))),
          calculated('C', ref('A')),
          calculated('Fuera', ref('A')),
        ]),
      ).toEqual([
        { field: 'columns.1.formula', code: 'COLUMN_FORMULA_CYCLE' },
        { field: 'columns.2.formula', code: 'COLUMN_FORMULA_CYCLE' },
        { field: 'columns.3.formula', code: 'COLUMN_FORMULA_CYCLE' },
      ]);
    });

    it('una cadena sin ciclo es válida aunque se declare en cualquier orden', () => {
      expect(
        issuesOf([
          calculated('Margen', op('div', ref('Beneficio'), ref('Precio'))),
          calculated('Beneficio', op('sub', ref('Precio'), ref('Costo'))),
          price,
          cost,
        ]),
      ).toEqual([]);
    });
  });
});
