import { describe, expect, it } from '@jest/globals';
import { evaluateRow } from '../../../src/evaluations/engine/evaluate-row.js';
import type { Rule } from '../../../src/evaluations/engine/ruleset.js';
import {
  FULL_MAPPING,
  USD,
  productRow,
  ruleset,
} from './support/engine-fixtures.js';

function problemsOf(values: Record<string, string>, externalId?: string) {
  const outcome = evaluateRow(
    productRow(values, { externalId }),
    ruleset(),
    USD,
  );
  return outcome.outcome === 'invalid' ? outcome.problems : [];
}

describe('evaluateRow: resultado y valores para el canal', () => {
  it('da por válida una fila completa y normaliza el precio como texto', () => {
    const outcome = evaluateRow(productRow(), ruleset(), USD);
    expect(outcome).toEqual({
      sourceRow: 1,
      externalId: 'SKU-001',
      outcome: 'valid',
      values: {
        title: 'Mesa de roble',
        description: 'Mesa de comedor para seis personas.',
        link: 'https://tienda.example/mesa',
        image_link: 'https://tienda.example/mesa.jpg',
        price: '149.90 USD',
        availability: 'in_stock',
        condition: 'new',
        brand: 'Acme',
      },
    });
  });

  it('no modifica la fila de entrada ni el identificador externo', () => {
    const row = productRow({ title: '  Mesa  ' }, { externalId: ' 000123 ' });
    const before = structuredClone(row);

    const outcome = evaluateRow(
      row,
      ruleset([
        { type: 'clean_text', attributes: ['title'] },
        { type: 'build_title', template: '{brand} {title}' },
      ]),
      USD,
    );

    expect(row).toEqual(before);
    expect(outcome.externalId).toBe(' 000123 ');
  });

  it('conserva el precio original cuando no se puede normalizar', () => {
    const outcome = evaluateRow(
      productRow({ price: '1.234,50' }),
      ruleset(),
      USD,
    );
    expect(outcome).toMatchObject({
      outcome: 'invalid',
      values: { price: '1.234,50' },
      problems: [{ attribute: 'price', code: 'PRICE_FORMAT_INVALID' }],
    });
  });

  it('lee columnas con nombres especiales como propiedades propias', () => {
    const row = productRow();
    const originalValues = Object.fromEntries([
      ...Object.entries(row.originalValues),
      ['__proto__', 'Título desde __proto__'],
    ]);
    const mapping = FULL_MAPPING.map((entry) =>
      entry.attribute === 'title' ? { ...entry, column: '__proto__' } : entry,
    );

    const outcome = evaluateRow(
      { ...row, originalValues },
      ruleset([], mapping),
      USD,
    );
    expect(outcome).toMatchObject({
      outcome: 'valid',
      values: { title: 'Título desde __proto__' },
    });
  });

  it('trata una columna ausente como vacía y no como la del prototipo', () => {
    const mapping = FULL_MAPPING.map((entry) =>
      entry.attribute === 'title' ? { ...entry, column: 'constructor' } : entry,
    );
    const outcome = evaluateRow(productRow(), ruleset([], mapping), USD);
    expect(outcome).toMatchObject({
      outcome: 'invalid',
      problems: [{ attribute: 'title', code: 'FIELD_MISSING' }],
    });
  });
});

describe('evaluateRow: reglas', () => {
  it('limpia con NFC y colapsa espacios, tabuladores y espacios no separables', () => {
    const outcome = evaluateRow(
      productRow({
        title: '  Cafe\u0301 \t con\u00a0\u00a0leche\n',
        brand: ' Acme ',
      }),
      ruleset([{ type: 'clean_text', attributes: ['title'] }]),
      USD,
    );
    expect(outcome).toMatchObject({
      values: { title: 'Café con leche', brand: ' Acme ' },
    });
  });

  it('no crea vacío un atributo sin mapear al limpiarlo', () => {
    const mapping = FULL_MAPPING.filter((entry) => entry.attribute !== 'brand');
    const outcome = evaluateRow(
      productRow(),
      ruleset([{ type: 'clean_text', attributes: ['brand'] }], mapping),
      USD,
    );
    expect(outcome.outcome).toBe('valid');
    expect(outcome.outcome === 'valid' && 'brand' in outcome.values).toBe(
      false,
    );
  });

  it('construye el título con atributos e id, colapsa espacios y no trunca', () => {
    const outcome = evaluateRow(
      productRow({ brand: '', condition: 'used' }),
      ruleset([
        {
          type: 'build_title',
          template: '{brand} {title} - {condition} [{id}]',
        },
      ]),
      USD,
    );
    expect(outcome).toMatchObject({
      values: { title: 'Mesa de roble - used [SKU-001]' },
    });

    const long = evaluateRow(
      productRow({ title: 'x'.repeat(150) }),
      ruleset([{ type: 'build_title', template: '{brand} {title}' }]),
      USD,
    );
    expect(long).toMatchObject({
      outcome: 'invalid',
      problems: [{ attribute: 'title', code: 'TEXT_TOO_LONG' }],
    });
  });

  it('aplica las reglas en el orden de la lista', () => {
    const excludeBuiltTitle: Rule = {
      type: 'exclude_when',
      attribute: 'title',
      operator: 'equals',
      value: 'Acme Mesa de roble',
    };
    const buildTitle: Rule = {
      type: 'build_title',
      template: '{brand} {title}',
    };

    const excludeFirst = evaluateRow(
      productRow(),
      ruleset([excludeBuiltTitle, buildTitle]),
      USD,
    );
    const buildFirst = evaluateRow(
      productRow(),
      ruleset([buildTitle, excludeBuiltTitle]),
      USD,
    );

    expect(excludeFirst.outcome).toBe('valid');
    expect(buildFirst).toMatchObject({
      outcome: 'excluded',
      excludedByRule: 2,
    });
  });

  it('una exclusión detiene las reglas siguientes y no valida la fila', () => {
    const outcome = evaluateRow(
      productRow({ price: 'no tiene precio', condition: 'used' }),
      ruleset([
        {
          type: 'exclude_when',
          attribute: 'condition',
          operator: 'equals',
          value: 'used',
        },
        { type: 'build_title', template: '{título inexistente}' },
      ]),
      USD,
    );
    expect(outcome).toEqual({
      sourceRow: 1,
      externalId: 'SKU-001',
      outcome: 'excluded',
      excludedByRule: 1,
    });
  });

  it.each([
    ['equals', 'Acme', true],
    ['equals', 'acme', false],
    ['not_equals', 'Acme', false],
    ['not_equals', 'Otra', true],
    ['contains', 'cm', true],
    ['contains', 'CM', false],
  ] as const)(
    'exclude_when %s %j sobre "Acme" excluye: %s',
    (operator, value, excluded) => {
      const outcome = evaluateRow(
        productRow(),
        ruleset([
          { type: 'exclude_when', attribute: 'brand', operator, value },
        ]),
        USD,
      );
      expect(outcome.outcome === 'excluded').toBe(excluded);
    },
  );

  it('is_empty considera vacío un valor con solo espacios', () => {
    const rule: Rule = {
      type: 'exclude_when',
      attribute: 'brand',
      operator: 'is_empty',
      value: '',
    };
    expect(
      evaluateRow(productRow({ brand: ' \t ' }), ruleset([rule]), USD).outcome,
    ).toBe('excluded');
    expect(evaluateRow(productRow(), ruleset([rule]), USD).outcome).toBe(
      'valid',
    );
  });

  it('una condición sobre id lee el identificador del snapshot', () => {
    const outcome = evaluateRow(
      productRow({}, { externalId: 'SKU-9' }),
      ruleset([
        {
          type: 'exclude_when',
          attribute: 'id',
          operator: 'equals',
          value: 'SKU-9',
        },
      ]),
      USD,
    );
    expect(outcome.outcome).toBe('excluded');
  });
});

describe('evaluateRow: perfil google_merchant v1', () => {
  it.each([
    ['title', 150],
    ['description', 5000],
    ['brand', 70],
  ])('%s admite %i caracteres y rechaza uno más', (attribute, max) => {
    expect(problemsOf({ [attribute]: 'a'.repeat(max) })).toEqual([]);
    expect(problemsOf({ [attribute]: 'a'.repeat(max + 1) })).toEqual([
      { attribute, code: 'TEXT_TOO_LONG' },
    ]);
  });

  it('el id admite 50 caracteres y rechaza 51', () => {
    expect(problemsOf({}, 'i'.repeat(50))).toEqual([]);
    expect(problemsOf({}, 'i'.repeat(51))).toEqual([
      { attribute: 'id', code: 'TEXT_TOO_LONG' },
    ]);
  });

  it('cuenta un emoji como un carácter', () => {
    expect(problemsOf({ title: '🪑'.repeat(150) })).toEqual([]);
  });

  it.each([
    '/mesa',
    'javascript:alert(1)',
    'ftp://tienda.example/mesa',
    ' https://tienda.example/mesa',
    'https://tienda.example/mesa grande',
    'tienda.example/mesa',
  ])('rechaza el enlace %j', (link) => {
    expect(problemsOf({ link })).toEqual([
      { attribute: 'link', code: 'URL_INVALID' },
    ]);
  });

  it('distingue disponibilidad desconocida de la que exige fecha', () => {
    expect(problemsOf({ availability: 'preorder' })).toEqual([
      { attribute: 'availability', code: 'AVAILABILITY_DATE_REQUIRED' },
    ]);
    expect(problemsOf({ availability: 'In Stock' })).toEqual([
      { attribute: 'availability', code: 'AVAILABILITY_INVALID' },
    ]);
    expect(problemsOf({ availability: 'out_of_stock' })).toEqual([]);
  });

  it('condition es opcional, pero si tiene valor debe ser uno admitido', () => {
    expect(problemsOf({ condition: '' })).toEqual([]);
    expect(problemsOf({ condition: 'nuevo' })).toEqual([
      { attribute: 'condition', code: 'CONDITION_INVALID' },
    ]);
  });

  it('informa los obligatorios vacíos y ordena los problemas por atributo', () => {
    expect(
      problemsOf(
        {
          brand: 'b'.repeat(71),
          price: '0',
          title: ' ',
          link: '/mesa',
        },
        'i'.repeat(51),
      ),
    ).toEqual([
      { attribute: 'id', code: 'TEXT_TOO_LONG' },
      { attribute: 'title', code: 'FIELD_MISSING' },
      { attribute: 'link', code: 'URL_INVALID' },
      { attribute: 'price', code: 'PRICE_ZERO' },
      { attribute: 'brand', code: 'TEXT_TOO_LONG' },
    ]);
  });
});
