import { createHash } from 'node:crypto';
import type { RowOutcome } from './evaluate-row.js';
import { PRODUCT_ATTRIBUTES } from './google-merchant.profile.js';

export type EvaluationCounts = Readonly<{
  total: number;
  valid: number;
  invalid: number;
  excluded: number;
}>;

export type EvaluationResult = Readonly<{
  counts: EvaluationCounts;
  checksum: string;
}>;

/**
 * Acumula los resultados de una evaluación, que llegan por lotes y en orden de
 * `sourceRow`. Cuenta cada resultado y calcula una suma SHA-256 de una
 * serialización canónica: dos evaluaciones con las mismas entradas deben dar la
 * misma suma (RNF02) sin tener que comparar fila a fila.
 */
export class EvaluationSummary {
  private readonly hash = createHash('sha256');
  private valid = 0;
  private invalid = 0;
  private excluded = 0;
  private lastSourceRow = 0;
  private finished = false;

  add(outcome: RowOutcome) {
    // La suma depende del orden: si las filas llegaran desordenadas, dos
    // evaluaciones iguales darían sumas distintas.
    if (this.finished || outcome.sourceRow <= this.lastSourceRow) {
      throw new Error('Las filas deben llegar una vez, en orden de sourceRow.');
    }
    this.lastSourceRow = outcome.sourceRow;
    this.count(outcome);
    this.hash.update(canonicalLine(outcome));
  }

  /** Cierra la suma: después no admite más filas. */
  finish(): EvaluationResult {
    this.finished = true;
    return {
      counts: {
        total: this.valid + this.invalid + this.excluded,
        valid: this.valid,
        invalid: this.invalid,
        excluded: this.excluded,
      },
      checksum: this.hash.digest('hex'),
    };
  }

  private count(outcome: RowOutcome) {
    switch (outcome.outcome) {
      case 'valid':
        this.valid += 1;
        break;
      case 'invalid':
        this.invalid += 1;
        break;
      case 'excluded':
        this.excluded += 1;
        break;
    }
  }
}

/**
 * Una línea JSON por fila con un orden fijo: arreglos en lugar de objetos,
 * porque el orden de las claves de un objeto no forma parte del valor (F21).
 * Los atributos van en el orden de `PRODUCT_ATTRIBUTES`, con `null` si faltan.
 */
function canonicalLine(outcome: RowOutcome) {
  const base = [outcome.sourceRow, outcome.externalId, outcome.outcome];
  if (outcome.outcome === 'excluded') {
    return `${JSON.stringify([...base, outcome.excludedByRule])}\n`;
  }

  const values = PRODUCT_ATTRIBUTES.map(
    (attribute) => outcome.values[attribute] ?? null,
  );
  const problems =
    outcome.outcome === 'invalid'
      ? outcome.problems.map((problem) => [problem.attribute, problem.code])
      : [];
  return `${JSON.stringify([...base, values, problems])}\n`;
}
