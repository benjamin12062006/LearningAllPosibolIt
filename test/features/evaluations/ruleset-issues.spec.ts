import { describe, expect, it } from '@jest/globals';
import {
  findRulesetIssues,
  isRuleset,
  templatePlaceholders,
} from '../../../src/evaluations/engine/ruleset.js';
import { FULL_MAPPING, ruleset } from './support/engine-fixtures.js';

const WITHOUT_TITLE = FULL_MAPPING.filter(
  (mapping) => mapping.attribute !== 'title',
);

describe('findRulesetIssues', () => {
  it('no encuentra problemas en un mapeo completo con reglas válidas', () => {
    const issues = findRulesetIssues(
      ruleset([
        { type: 'clean_text', attributes: ['title', 'brand'] },
        { type: 'build_title', template: '{brand} {title} ({id})' },
        {
          type: 'exclude_when',
          attribute: 'id',
          operator: 'equals',
          value: 'SKU-9',
        },
      ]),
    );
    expect(issues).toEqual([]);
  });

  it('informa de cada atributo mapeado más de una vez', () => {
    const issues = findRulesetIssues(
      ruleset([], [...FULL_MAPPING, { attribute: 'price', column: 'precio' }]),
    );
    expect(issues).toEqual([{ code: 'MAPPING_DUPLICATE', attribute: 'price' }]);
  });

  it('lista los obligatorios que faltan, en el orden del perfil', () => {
    const issues = findRulesetIssues(
      ruleset([], [{ attribute: 'brand', column: 'brand' }]),
    );
    expect(issues.map((issue) => issue.attribute)).toEqual([
      'title',
      'description',
      'link',
      'image_link',
      'price',
      'availability',
    ]);
    expect(
      issues.every((issue) => issue.code === 'REQUIRED_ATTRIBUTE_MISSING'),
    ).toBe(true);
  });

  it('acepta un título producido por build_title aunque no esté mapeado', () => {
    const issues = findRulesetIssues(
      ruleset([{ type: 'build_title', template: '{brand}' }], WITHOUT_TITLE),
    );
    expect(issues).toEqual([]);
  });

  it('rechaza usar el título antes de la regla que lo produce', () => {
    const issues = findRulesetIssues(
      ruleset(
        [
          { type: 'clean_text', attributes: ['title'] },
          { type: 'build_title', template: '{brand}' },
        ],
        WITHOUT_TITLE,
      ),
    );
    expect(issues).toEqual([
      { code: 'REFERENCE_INVALID', attribute: 'title', rulePosition: 1 },
    ]);
  });

  it('rechaza marcadores desconocidos o vacíos y condiciones sobre atributos sin mapear', () => {
    const issues = findRulesetIssues(
      ruleset(
        [
          { type: 'build_title', template: '{title} {color} {}' },
          {
            type: 'exclude_when',
            attribute: 'brand',
            operator: 'is_empty',
            value: '',
          },
        ],
        FULL_MAPPING.filter((mapping) => mapping.attribute !== 'brand'),
      ),
    );
    expect(issues).toEqual([
      { code: 'REFERENCE_INVALID', attribute: 'color', rulePosition: 1 },
      { code: 'REFERENCE_INVALID', attribute: '', rulePosition: 1 },
      { code: 'REFERENCE_INVALID', attribute: 'brand', rulePosition: 2 },
    ]);
  });
});

describe('templatePlaceholders', () => {
  it('devuelve los nombres en orden y deja como texto las llaves sueltas', () => {
    expect(templatePlaceholders('{brand} - {title} {brand} {abierta')).toEqual([
      'brand',
      'title',
      'brand',
    ]);
  });
});

describe('isRuleset', () => {
  const valid = ruleset([
    { type: 'clean_text', attributes: ['title'] },
    { type: 'build_title', template: '{title}' },
    { type: 'exclude_when', attribute: 'id', operator: 'is_empty', value: '' },
  ]);

  it('acepta un ruleset con la forma del dominio', () => {
    expect(isRuleset(JSON.parse(JSON.stringify(valid)))).toBe(true);
  });

  it.each([
    ['nulo', null],
    ['mapeo que no es arreglo', { ...valid, mapping: {} }],
    [
      'atributo mapeado desconocido',
      { ...valid, mapping: [{ attribute: 'gtin', column: 'G' }] },
    ],
    [
      'columna no textual',
      { ...valid, mapping: [{ attribute: 'title', column: 1 }] },
    ],
    ['reglas que no son arreglo', { ...valid, rules: { 0: valid.rules[0] } }],
    ['tipo de regla desconocido', { ...valid, rules: [{ type: 'otra' }] }],
    [
      'clean_text sobre un enlace',
      { ...valid, rules: [{ type: 'clean_text', attributes: ['link'] }] },
    ],
    [
      'plantilla no textual',
      { ...valid, rules: [{ type: 'build_title', template: 1 }] },
    ],
    [
      'operador desconocido',
      {
        ...valid,
        rules: [
          { type: 'exclude_when', attribute: 'id', operator: 'gt', value: '' },
        ],
      },
    ],
    [
      'condición sin value',
      {
        ...valid,
        rules: [{ type: 'exclude_when', attribute: 'id', operator: 'equals' }],
      },
    ],
  ])('rechaza %s', (_label, value) => {
    expect(isRuleset(value)).toBe(false);
  });
});
