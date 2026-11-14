import { describe, expect, it } from '@jest/globals';
import type { RowOutcome } from '../../../src/evaluations/engine/evaluate-row.js';
import type {
  ProductValues,
  RowProblem,
} from '../../../src/evaluations/engine/google-merchant.profile.js';
import { compareOutcomes } from '../../../src/evaluations/rules-preview.js';

const BASE_VALUES: ProductValues = { title: 'Mesa', price: '10.00 USD' };

function valid(sourceRow: number, values = BASE_VALUES): RowOutcome {
  return {
    sourceRow,
    externalId: `SKU-${sourceRow}`,
    outcome: 'valid',
    values,
  };
}

function invalid(
  sourceRow: number,
  problems: RowProblem[],
  values = BASE_VALUES,
): RowOutcome {
  return {
    sourceRow,
    externalId: `SKU-${sourceRow}`,
    outcome: 'invalid',
    values,
    problems,
  };
}

function excluded(sourceRow: number, excludedByRule: number): RowOutcome {
  return {
    sourceRow,
    externalId: `SKU-${sourceRow}`,
    outcome: 'excluded',
    excludedByRule,
  };
}

const NO_PRICE: RowProblem = { attribute: 'price', code: 'FIELD_MISSING' };
const BAD_LINK: RowProblem = { attribute: 'link', code: 'URL_INVALID' };
const LONG_TITLE: RowProblem = { attribute: 'title', code: 'TEXT_TOO_LONG' };

describe('compareOutcomes', () => {
  it('con los mismos resultados no cambia ningún producto', () => {
    const rows = [valid(1), invalid(2, [NO_PRICE]), excluded(3, 2)];

    const comparison = compareOutcomes(rows, rows);

    expect(comparison.products).toEqual([]);
    expect(comparison.outcomeChanges).toEqual([]);
    expect(comparison.changedValues).toEqual([]);
    expect(comparison.problems).toEqual({
      appeared: [],
      resolved: [],
      persisting: [{ ...NO_PRICE, productCount: 1 }],
    });
    expect(comparison.counts.current).toEqual(comparison.counts.proposed);
    expect(comparison.counts.current).toEqual({
      total: 3,
      valid: 1,
      invalid: 1,
      excluded: 1,
    });
  });

  it('reparte los problemas en nuevos, resueltos y los que siguen', () => {
    const current = [
      invalid(1, [NO_PRICE, BAD_LINK]),
      invalid(2, [NO_PRICE]),
      valid(3),
    ];
    const proposed = [
      invalid(1, [NO_PRICE, LONG_TITLE]),
      valid(2),
      invalid(3, [LONG_TITLE]),
    ];

    const { problems, products } = compareOutcomes(current, proposed);

    expect(problems).toEqual({
      appeared: [{ ...LONG_TITLE, productCount: 2 }],
      // A igualdad de productos, por atributo: `link` antes que `price`.
      resolved: [
        { ...BAD_LINK, productCount: 1 },
        { ...NO_PRICE, productCount: 1 },
      ],
      persisting: [{ ...NO_PRICE, productCount: 1 }],
    });
    expect(products.map((product) => product.sourceRow)).toEqual([1, 2, 3]);
  });

  it('el orden de los problemas de un producto no es un cambio', () => {
    const comparison = compareOutcomes(
      [invalid(1, [NO_PRICE, BAD_LINK])],
      [invalid(1, [BAD_LINK, NO_PRICE])],
    );

    expect(comparison.products).toEqual([]);
    expect(comparison.problems.appeared).toEqual([]);
    expect(comparison.problems.resolved).toEqual([]);
  });

  it('cuenta los cambios de resultado por origen y destino', () => {
    const current = [
      valid(1),
      valid(2),
      invalid(3, [NO_PRICE]),
      excluded(4, 1),
    ];
    const proposed = [excluded(1, 1), excluded(2, 1), valid(3), valid(4)];

    const { outcomeChanges, counts } = compareOutcomes(current, proposed);

    expect(outcomeChanges).toEqual([
      { from: 'valid', to: 'excluded', productCount: 2 },
      { from: 'excluded', to: 'valid', productCount: 1 },
      { from: 'invalid', to: 'valid', productCount: 1 },
    ]);
    expect(counts.proposed).toEqual({
      total: 4,
      valid: 2,
      invalid: 0,
      excluded: 2,
    });
  });

  it('da el valor anterior y el nuevo de cada atributo que cambia', () => {
    const comparison = compareOutcomes(
      [valid(1, { title: 'Mesa', price: '10.00 USD' })],
      [valid(1, { title: 'Acme Mesa', price: '10.00 USD', brand: 'Acme' })],
    );

    expect(comparison.products).toEqual([
      {
        sourceRow: 1,
        externalId: 'SKU-1',
        current: { outcome: 'valid', problems: [], excludedByRule: null },
        proposed: { outcome: 'valid', problems: [], excludedByRule: null },
        values: [
          { attribute: 'title', before: 'Mesa', after: 'Acme Mesa' },
          // `null`: con las reglas vigentes el producto no tenía marca.
          { attribute: 'brand', before: null, after: 'Acme' },
        ],
      },
    ]);
    expect(comparison.changedValues).toEqual([
      { attribute: 'brand', productCount: 1 },
      { attribute: 'title', productCount: 1 },
    ]);
  });

  it('un valor vacío no es lo mismo que no tener el atributo', () => {
    const { products } = compareOutcomes(
      [valid(1, { title: 'Mesa', brand: '' })],
      [valid(1, { title: 'Mesa' })],
    );

    expect(products[0].values).toEqual([
      { attribute: 'brand', before: '', after: null },
    ]);
  });

  it('de un producto excluido no se comparan valores: lo dice su resultado', () => {
    const { products, changedValues } = compareOutcomes(
      [valid(1)],
      [excluded(1, 2)],
    );

    expect(changedValues).toEqual([]);
    expect(products).toEqual([
      {
        sourceRow: 1,
        externalId: 'SKU-1',
        current: { outcome: 'valid', problems: [], excludedByRule: null },
        proposed: { outcome: 'excluded', problems: [], excludedByRule: 2 },
        values: [],
      },
    ]);
  });

  it('que lo excluya la regla de otra posición no es un cambio', () => {
    const comparison = compareOutcomes([excluded(1, 3)], [excluded(1, 4)]);

    expect(comparison.products).toEqual([]);
    expect(comparison.outcomeChanges).toEqual([]);
  });

  it('los productos cambiados van en el orden del catálogo', () => {
    const current = [valid(1), valid(2), valid(3), valid(4)];
    const proposed = [
      valid(1, { title: 'Otra' }),
      valid(2),
      excluded(3, 1),
      invalid(4, [NO_PRICE]),
    ];

    const { products } = compareOutcomes(current, proposed);

    expect(products.map((product) => product.externalId)).toEqual([
      'SKU-1',
      'SKU-3',
      'SKU-4',
    ]);
  });

  it('rechaza dos evaluaciones de catálogos distintos', () => {
    expect(() => compareOutcomes([valid(1)], [])).toThrow(
      'Las dos evaluaciones tienen que ser del mismo catálogo.',
    );
  });
});
