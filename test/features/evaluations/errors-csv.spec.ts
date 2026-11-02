import { describe, expect, it } from '@jest/globals';
import type { ProblemCode } from '../../../src/evaluations/engine/google-merchant.profile.js';
import {
  buildErrorsCsv,
  csvCell,
} from '../../../src/evaluations/errors-csv.js';
import { describeProblem } from '../../../src/evaluations/problem-messages.js';

const ALL_PROBLEM_CODES: ProblemCode[] = [
  'FIELD_MISSING',
  'TEXT_TOO_LONG',
  'TEXT_HAS_LINE_BREAK',
  'TEXT_STARTS_WITH_QUOTE',
  'URL_INVALID',
  'AVAILABILITY_INVALID',
  'AVAILABILITY_DATE_REQUIRED',
  'CONDITION_INVALID',
  'PRICE_FORMAT_INVALID',
  'PRICE_CURRENCY_MISMATCH',
  'PRICE_ZERO',
];

describe('csvCell', () => {
  it('pone toda celda entre comillas y duplica las comillas internas', () => {
    expect(csvCell('Mesa')).toBe('"Mesa"');
    expect(csvCell('Mesa "grande", roble')).toBe('"Mesa ""grande"", roble"');
    expect(csvCell('línea\r\nsegunda')).toBe('"línea\r\nsegunda"');
    expect(csvCell('')).toBe('""');
  });

  it.each([
    '=1+2',
    '+1',
    '-123',
    '@SUM(A1)',
    '\t=1',
    '\r=1',
    '\n=1',
    '＝1+2',
    '＋1',
    '－1',
    '＠x',
  ])('antepone un tabulador a %j para que no se lea como fórmula', (value) => {
    expect(csvCell(value)).toBe(`"\t${value.replaceAll('"', '""')}"`);
  });

  it('el ejemplo de OWASP queda como texto entre comillas', () => {
    expect(csvCell('=1+2";=1+2')).toBe('"\t=1+2"";=1+2"');
  });

  it('no toca valores que empiezan por otro carácter', () => {
    expect(csvCell('SKU-1=2')).toBe('"SKU-1=2"');
    expect(csvCell(' =1')).toBe('" =1"');
  });
});

describe('buildErrorsCsv', () => {
  const rows = [
    {
      sourceRow: 2,
      externalId: '-SKU-2',
      problems: [
        { attribute: 'price' as const, code: 'PRICE_FORMAT_INVALID' as const },
        { attribute: 'brand' as const, code: 'TEXT_TOO_LONG' as const },
      ],
    },
    {
      sourceRow: 5,
      externalId: 'SKU "5"',
      problems: [{ attribute: 'link' as const, code: 'URL_INVALID' as const }],
    },
  ];

  it('empieza con BOM, separa con CRLF y escribe una línea por problema', () => {
    const csv = buildErrorsCsv(rows, 'es');
    expect(
      csv.startsWith(
        '\uFEFF"fila","producto","campo","problema","corrección sugerida"\r\n',
      ),
    ).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);

    const lines = csv.slice(1).split('\r\n');
    expect(lines).toHaveLength(5);
    expect(lines[1]).toBe(
      '"2","\t-SKU-2","price","El precio no tiene un formato admitido.","Escribe el precio con punto decimal y sin separador de miles ni símbolo, por ejemplo 1234.50."',
    );
    expect(lines[2]).toContain('"Acórtalo a 70 caracteres como máximo."');
    expect(lines[3]).toMatch(/^"5","SKU ""5""","link",/);
    expect(lines[4]).toBe('');
  });

  it('usa cabeceras y textos en inglés con lang en', () => {
    const csv = buildErrorsCsv(rows, 'en');
    expect(csv).toContain('"row","product","field","problem","suggested fix"');
    expect(csv).toContain('"Shorten it to at most 70 characters."');
  });

  it('sin filas inválidas deja solo la cabecera', () => {
    expect(buildErrorsCsv([], 'es').slice(1).split('\r\n')).toEqual([
      '"fila","producto","campo","problema","corrección sugerida"',
      '',
    ]);
  });
});

describe('describeProblem', () => {
  it.each(ALL_PROBLEM_CODES)(
    '%s tiene problema y sugerencia en es y en',
    (code) => {
      const described = describeProblem({ attribute: 'title', code });
      for (const text of [described.problem, described.suggestion]) {
        expect(text.es.trim()).not.toBe('');
        expect(text.en.trim()).not.toBe('');
      }
    },
  );

  it.each([
    ['id', 50],
    ['title', 150],
    ['description', 5000],
    ['brand', 70],
  ] as const)('sugiere el máximo de %s (%i)', (attribute, max) => {
    expect(
      describeProblem({ attribute, code: 'TEXT_TOO_LONG' }).suggestion.es,
    ).toContain(String(max));
  });

  it('para un salto de línea sugiere clean_text, salvo en el id, que ninguna regla cambia', () => {
    for (const attribute of ['title', 'description', 'brand'] as const) {
      const { suggestion } = describeProblem({
        attribute,
        code: 'TEXT_HAS_LINE_BREAK',
      });
      expect(suggestion.es).toContain('clean_text');
      expect(suggestion.en).toContain('clean_text');
    }

    const { suggestion } = describeProblem({
      attribute: 'id',
      code: 'TEXT_HAS_LINE_BREAK',
    });
    expect(suggestion.es).not.toContain('clean_text');
    expect(suggestion.es).toContain('identificador');
    expect(suggestion.en).toContain('identifier');
  });
});
