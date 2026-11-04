import { ErrorCodes, type ErrorCode } from '../common/http/error-codes.js';
import type { FeedPolicy } from '../feeds/feeds.types.js';

/** Lo que la política mira de una evaluación terminada. */
export type EvaluatedCatalog = Readonly<{
  engineVersion: string;
  profileVersion: string;
  valid: number;
  invalid: number;
  excluded: number;
}>;

/**
 * El primer incumplimiento de la política aprobada (D11), o `null` si la
 * evaluación se puede publicar sin revisión. Mismo patrón que
 * `findExportBlocker`: el orden de las comprobaciones es el de la tabla del plan.
 *
 * `publishedRowCount` son los productos de la versión publicada ahora, o `null`
 * si todavía no hay ninguna: entonces no hay caída que medir.
 */
export function checkRefreshPolicy(
  policy: FeedPolicy,
  evaluation: EvaluatedCatalog,
  publishedRowCount: number | null,
): ErrorCode | null {
  if (!sameVersions(policy, evaluation)) {
    return ErrorCodes.REFRESH_POLICY_VERSIONS_CHANGED;
  }
  if (evaluation.valid === 0) {
    return ErrorCodes.REFRESH_POLICY_NO_VALID_PRODUCTS;
  }
  if (evaluation.invalid > policy.maxInvalid) {
    return ErrorCodes.REFRESH_POLICY_TOO_MANY_INVALID;
  }
  if (evaluation.excluded > policy.maxExcluded) {
    return ErrorCodes.REFRESH_POLICY_TOO_MANY_EXCLUDED;
  }
  if (droppedTooMuch(policy, evaluation.valid, publishedRowCount)) {
    return ErrorCodes.REFRESH_POLICY_PRODUCT_DROP;
  }
  return null;
}

/** Motor y perfil iguales a los aprobados: si cambian, hay que reaprobar. */
function sameVersions(policy: FeedPolicy, evaluation: EvaluatedCatalog) {
  return (
    policy.engineVersion === evaluation.engineVersion &&
    policy.profileVersion === evaluation.profileVersion
  );
}

/**
 * Válidos por debajo de `publicados × (1 − caída / 100)`. Se compara en
 * enteros (`válidos × 100 < publicados × (100 − caída)`) para que un 10 % de 30
 * no dependa de redondeos de coma flotante.
 */
function droppedTooMuch(
  policy: FeedPolicy,
  valid: number,
  publishedRowCount: number | null,
) {
  if (publishedRowCount === null) {
    return false;
  }
  return valid * 100 < publishedRowCount * (100 - policy.maxDropPercent);
}
