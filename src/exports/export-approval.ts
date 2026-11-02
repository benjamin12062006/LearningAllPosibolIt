import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { ENGINE_VERSION } from '../evaluations/engine/evaluate-row.js';
import { PROFILE_VERSION } from '../evaluations/engine/google-merchant.profile.js';
import type { EvaluationStatus } from '../evaluations/evaluations.types.js';

/**
 * Lo que el operador vio al revisar la evaluación y confirma al exportar (D2).
 * La evaluación se elige por su id; estos campos dicen qué resultado aprueba.
 */
export type ExportApproval = Readonly<{
  resultChecksum: string;
  acceptedInvalidCount: number;
  acceptedExcludedCount: number;
}>;

type ResultCounts = Readonly<{
  valid: number;
  invalid: number;
  excluded: number;
}>;

/** La evaluación tal como la necesita la exportación. */
export type EvaluationToExport = Readonly<{
  status: EvaluationStatus;
  engineVersion: string;
  profileVersion: string;
  counts: ResultCounts | null;
  resultChecksum: string | null;
  /** El proyecto tiene una evaluación posterior en cola, en curso o terminada (D3). */
  hasNewerEvaluation: boolean;
}>;

type EvaluationWithResults = EvaluationToExport &
  Readonly<{ counts: ResultCounts; resultChecksum: string }>;

export type ExportBlocker =
  | typeof ErrorCodes.EVALUATION_RESULTS_UNAVAILABLE
  | typeof ErrorCodes.EXPORT_EVALUATION_OUTDATED
  | typeof ErrorCodes.EXPORT_EVALUATION_SUPERSEDED
  | typeof ErrorCodes.EXPORT_NO_VALID_PRODUCTS
  | typeof ErrorCodes.EXPORT_APPROVAL_MISMATCH;

/**
 * El motivo por el que no se puede exportar, o `null` si se puede (D1–D3).
 *
 * El orden va de lo que impide exportar esta evaluación pase lo que pase (no
 * terminó, se juzgó con reglas antiguas, otra la reemplaza, no tiene productos
 * válidos) a lo que el cliente arregla volviendo a leerla (la aprobación no
 * coincide). Así el primer motivo es el que más le sirve al operador.
 */
export function findExportBlocker(
  evaluation: EvaluationToExport,
  approval: ExportApproval,
): ExportBlocker | null {
  if (!hasResults(evaluation)) {
    return ErrorCodes.EVALUATION_RESULTS_UNAVAILABLE;
  }
  if (!usesCurrentChecks(evaluation)) {
    return ErrorCodes.EXPORT_EVALUATION_OUTDATED;
  }
  if (evaluation.hasNewerEvaluation) {
    return ErrorCodes.EXPORT_EVALUATION_SUPERSEDED;
  }
  if (evaluation.counts.valid === 0) {
    return ErrorCodes.EXPORT_NO_VALID_PRODUCTS;
  }
  if (!matchesApproval(evaluation, approval)) {
    return ErrorCodes.EXPORT_APPROVAL_MISMATCH;
  }
  return null;
}

/**
 * Lanza el error público si no se puede exportar. `null` es una evaluación que
 * no existe o no es del proyecto del propietario.
 */
export function assertCanExport(
  evaluation: EvaluationToExport | null,
  approval: ExportApproval,
) {
  if (evaluation === null) {
    throw apiError(ErrorCodes.EVALUATION_NOT_FOUND);
  }
  const blocker = findExportBlocker(evaluation, approval);
  if (blocker !== null) {
    throw apiError(blocker);
  }
}

/**
 * La base ya exige conteos y suma en `succeeded` (CHECK de la migración de
 * evaluaciones); se comprueban también aquí para que el tipo lo refleje.
 */
function hasResults(
  evaluation: EvaluationToExport,
): evaluation is EvaluationWithResults {
  return (
    evaluation.status === 'succeeded' &&
    evaluation.counts !== null &&
    evaluation.resultChecksum !== null
  );
}

/**
 * Cada fila se juzgó con las comprobaciones que hoy garantizan un TSV que
 * Google puede leer (D3.1). Una evaluación anterior debe repetirse.
 */
function usesCurrentChecks(evaluation: EvaluationToExport) {
  return (
    evaluation.engineVersion === ENGINE_VERSION &&
    evaluation.profileVersion === PROFILE_VERSION
  );
}

/**
 * La suma identifica el resultado de cada fila (inválidas y excluidas incluidas)
 * y las filas no cambian, así que suma y conteos bastan para saber qué
 * exclusiones se aceptaron (D2). Se comparan con lo guardado, no se confía en lo
 * que envía el cliente (RC4).
 */
function matchesApproval(
  evaluation: EvaluationWithResults,
  approval: ExportApproval,
) {
  return (
    approval.resultChecksum === evaluation.resultChecksum &&
    approval.acceptedInvalidCount === evaluation.counts.invalid &&
    approval.acceptedExcludedCount === evaluation.counts.excluded
  );
}
