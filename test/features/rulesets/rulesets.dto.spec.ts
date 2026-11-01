import { describe, expect, it } from '@jest/globals';
import { ValidationPipe } from '@nestjs/common';
import { validationIssues } from '../../../src/common/http/validation-errors.js';
import {
  BuildTitleRuleDto,
  CleanTextRuleDto,
  CreateRulesetDto,
  ExcludeWhenRuleDto,
} from '../../../src/rulesets/rulesets.dto.js';
import { bodyWithRules, rulesetBody } from './support/ruleset-fixtures.js';

class Rejected {
  constructor(readonly issues: string[]) {}
}

/**
 * Las mismas opciones que `configure-http.ts`. El pipe hace `plainToInstance` y
 * después `validate`, como enseña RC3; sin la transformación, las reglas no
 * llegarían a su subclase.
 */
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  validationError: { target: false, value: false },
  exceptionFactory: (errors) =>
    new Rejected(
      validationIssues(errors).map((issue) => `${issue.field}:${issue.code}`),
    ),
});

async function validate(body: unknown) {
  try {
    const dto: CreateRulesetDto = await pipe.transform(body, {
      type: 'body',
      metatype: CreateRulesetDto,
    });
    return { dto, issues: [] };
  } catch (error) {
    if (error instanceof Rejected) {
      return { dto: undefined, issues: error.issues };
    }
    throw error;
  }
}

describe('CreateRulesetDto', () => {
  it('acepta un body válido y crea la subclase de cada regla conservando type', async () => {
    const { dto, issues } = await validate(rulesetBody());

    expect(issues).toEqual([]);
    expect(dto?.rules.map((rule) => rule.constructor)).toEqual([
      CleanTextRuleDto,
      BuildTitleRuleDto,
      ExcludeWhenRuleDto,
      ExcludeWhenRuleDto,
    ]);
    expect(dto?.rules.map((rule) => rule.type)).toEqual([
      'clean_text',
      'build_title',
      'exclude_when',
      'exclude_when',
    ]);
  });

  it('acepta una versión sin reglas', async () => {
    expect((await validate(bodyWithRules([]))).issues).toEqual([]);
  });

  it.each([
    ['desconocido', { type: 'foo' }],
    ['ausente', { template: 'x' }],
    ['numérico', { type: 1 }],
    ['__proto__', JSON.parse('{"type":"__proto__"}')],
    ['constructor', { type: 'constructor' }],
  ])('rechaza un type %s en rules.0.type', async (_label, rule) => {
    const { issues } = await validate(bodyWithRules([rule]));
    expect(issues).toContain('rules.0.type:FIELD_UNSUPPORTED');
  });

  it('rechaza los campos que no son de la subclase elegida', async () => {
    const { issues } = await validate(
      bodyWithRules([
        { type: 'clean_text', attributes: ['title'], template: '{title}' },
        { type: 'foo', anything: 1 },
      ]),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        'rules.0.template:FIELD_NOT_ALLOWED',
        'rules.1.anything:FIELD_NOT_ALLOWED',
      ]),
    );
  });

  it.each([
    ['null', null],
    ['una cadena', 'clean_text'],
    ['un arreglo', [{ type: 'clean_text', attributes: ['title'] }]],
  ])(
    'rechaza con issues, sin lanzar, un elemento %s en rules y en mapping',
    async (_label, element) => {
      const rules = await validate(bodyWithRules([element]));
      const mapping = await validate({ ...rulesetBody(), mapping: [element] });

      expect(rules.issues).toContain('rules:FIELD_INVALID');
      // Un arreglo anidado lo recorre `ValidateNested` y sus issues salen en
      // `mapping.0.0.*`; lo que importa es que sea un 400 y no una excepción.
      expect(mapping.issues.length).toBeGreaterThan(0);
      expect(
        mapping.issues.every((issue) => issue.startsWith('mapping.0')),
      ).toBe(true);
    },
  );

  it('rechaza rules y mapping que no son arreglos o superan su máximo', async () => {
    const tooManyRules = Array.from({ length: 21 }, () => ({
      type: 'build_title',
      template: '{title}',
    }));
    const tooManyMappings = Array.from({ length: 9 }, () => ({
      attribute: 'title',
      column: 'Nombre',
    }));

    expect((await validate(bodyWithRules({}))).issues).toContain(
      'rules:FIELD_INVALID',
    );
    expect((await validate(bodyWithRules(tooManyRules))).issues).toEqual([
      'rules:FIELD_INVALID',
    ]);
    expect(
      (await validate({ ...rulesetBody(), mapping: tooManyMappings })).issues,
    ).toEqual(['mapping:FIELD_INVALID']);
    expect((await validate({ mapping: [] })).issues).toEqual(
      expect.arrayContaining(['mapping:FIELD_INVALID', 'rules:FIELD_INVALID']),
    );
  });

  it('valida el mapeo: atributo del perfil y columna de 1 a 128 caracteres', async () => {
    const { issues } = await validate({
      ...rulesetBody(),
      mapping: [
        { attribute: 'id', column: 'SKU' },
        { attribute: 'gtin', column: 'GTIN' },
        { attribute: 'title', column: '' },
        { attribute: 'brand', column: 'c'.repeat(129) },
        { attribute: 'price', column: 'Precio', extra: true },
      ],
    });
    expect(issues).toEqual([
      'mapping.0.attribute:FIELD_UNSUPPORTED',
      'mapping.1.attribute:FIELD_UNSUPPORTED',
      'mapping.2.column:FIELD_INVALID',
      'mapping.3.column:FIELD_INVALID',
      'mapping.4.extra:FIELD_NOT_ALLOWED',
    ]);
  });

  it('valida clean_text: entre 1 y 5 atributos limpiables y sin repetir', async () => {
    const { issues } = await validate(
      bodyWithRules([
        { type: 'clean_text', attributes: ['link'] },
        { type: 'clean_text', attributes: ['title', 'title'] },
        { type: 'clean_text', attributes: [] },
      ]),
    );
    expect(issues).toEqual([
      'rules.0.attributes:FIELD_UNSUPPORTED',
      'rules.1.attributes:FIELD_INVALID',
      'rules.2.attributes:FIELD_INVALID',
    ]);
  });

  it('valida build_title: plantilla de 1 a 300 caracteres', async () => {
    const { issues } = await validate(
      bodyWithRules([
        { type: 'build_title', template: '' },
        { type: 'build_title', template: 't'.repeat(301) },
        { type: 'build_title', template: 't'.repeat(300) },
      ]),
    );
    expect(issues).toEqual([
      'rules.0.template:FIELD_INVALID',
      'rules.1.template:FIELD_INVALID',
    ]);
  });

  it('exige value salvo con is_empty, donde debe faltar o ir vacío', async () => {
    const condition = { type: 'exclude_when', attribute: 'brand' };
    const { issues } = await validate(
      bodyWithRules([
        { ...condition, operator: 'is_empty' },
        { ...condition, operator: 'is_empty', value: '' },
        { ...condition, operator: 'is_empty', value: 'Acme' },
        { ...condition, operator: 'equals' },
        { ...condition, operator: 'contains', value: '' },
        { ...condition, operator: 'not_equals', value: 'v'.repeat(201) },
        { ...condition, operator: 'equals', value: 'v'.repeat(200) },
        { ...condition, operator: 'matches', value: 'x' },
        {
          type: 'exclude_when',
          attribute: 'gtin',
          operator: 'equals',
          value: 'x',
        },
      ]),
    );
    expect(issues).toEqual([
      'rules.2.value:FIELD_INVALID',
      'rules.3.value:FIELD_INVALID',
      'rules.4.value:FIELD_INVALID',
      'rules.5.value:FIELD_INVALID',
      'rules.7.operator:FIELD_UNSUPPORTED',
      'rules.8.attribute:FIELD_UNSUPPORTED',
    ]);
  });
});
