import { describe, expect, it } from '@jest/globals';
import {
  evaluateRow,
  type RowOutcome,
} from '../../../src/evaluations/engine/evaluate-row.js';
import { EvaluationSummary } from '../../../src/evaluations/engine/evaluation-summary.js';
import type { Ruleset } from '../../../src/evaluations/engine/ruleset.js';
import {
  USD,
  productRow,
  ruleset,
  seededRandom,
} from './support/engine-fixtures.js';

const EXCLUDE_USED: Ruleset = ruleset([
  { type: 'clean_text', attributes: ['title', 'condition'] },
  {
    type: 'exclude_when',
    attribute: 'condition',
    operator: 'equals',
    value: 'used',
  },
]);

/** Catálogo variado y repetible: válidos, inválidos y usados (excluidos). */
function mixedCatalog(seed: number, size: number) {
  const random = seededRandom(seed);
  const pick = <T>(options: readonly T[]) =>
    options[Math.floor(random() * options.length)];

  return Array.from({ length: size }, (_, index) =>
    productRow(
      {
        title: pick(['Mesa', '  Silla  ', '', 'Cafe\u0301']),
        price: pick(['10', '1,50', '0', '99.9 USD', '5 EUR']),
        condition: pick(['new', 'used', ' used ', 'refurbished']),
      },
      { sourceRow: index + 1, externalId: `SKU-${index + 1}` },
    ),
  );
}

function summarize(rows: ReturnType<typeof mixedCatalog>, rules: Ruleset) {
  const summary = new EvaluationSummary();
  const outcomes: RowOutcome[] = [];
  for (const row of rows) {
    const outcome = evaluateRow(row, rules, USD);
    outcomes.push(outcome);
    summary.add(outcome);
  }
  return { outcomes, ...summary.finish() };
}

describe('EvaluationSummary', () => {
  it.each([1, 7, 2026])(
    'cumple válidos + inválidos + excluidos = total con la semilla %i',
    (seed) => {
      const rows = mixedCatalog(seed, 500);
      const { outcomes, counts } = summarize(rows, EXCLUDE_USED);

      const countOf = (kind: RowOutcome['outcome']) =>
        outcomes.filter((outcome) => outcome.outcome === kind).length;

      expect(counts).toEqual({
        total: 500,
        valid: countOf('valid'),
        invalid: countOf('invalid'),
        excluded: countOf('excluded'),
      });
      expect(counts.valid + counts.invalid + counts.excluded).toBe(
        counts.total,
      );
      expect(counts.valid * counts.invalid * counts.excluded).toBeGreaterThan(
        0,
      );
    },
  );

  it('da el mismo resultado y la misma suma con las mismas entradas', () => {
    const first = summarize(mixedCatalog(42, 300), EXCLUDE_USED);
    const second = summarize(mixedCatalog(42, 300), EXCLUDE_USED);

    expect(second.outcomes).toEqual(first.outcomes);
    expect(second.counts).toEqual(first.counts);
    expect(second.checksum).toBe(first.checksum);
    expect(first.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('cambia la suma si cambian las reglas o los datos', () => {
    const base = summarize(mixedCatalog(42, 300), EXCLUDE_USED).checksum;

    expect(summarize(mixedCatalog(42, 300), ruleset()).checksum).not.toBe(base);
    expect(summarize(mixedCatalog(43, 300), EXCLUDE_USED).checksum).not.toBe(
      base,
    );
  });

  it('rechaza filas desordenadas, repetidas o después de cerrar', () => {
    const outcomeAt = (sourceRow: number) =>
      evaluateRow(productRow({}, { sourceRow }), ruleset(), USD);

    const summary = new EvaluationSummary();
    summary.add(outcomeAt(2));
    expect(() => summary.add(outcomeAt(1))).toThrow();
    expect(() => summary.add(outcomeAt(2))).toThrow();

    summary.add(outcomeAt(3));
    summary.finish();
    expect(() => summary.add(outcomeAt(4))).toThrow();
  });
});
