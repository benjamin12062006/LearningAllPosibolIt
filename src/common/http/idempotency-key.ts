import { apiError } from './api-error.js';
import { ErrorCodes } from './error-codes.js';

/** Lo que admite `operation_receipts.idempotency_key` (`CHECK` de la migración de E4). */
const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

/**
 * La cabecera `Idempotency-Key` sin espacios alrededor: de 1 a 255 caracteres,
 * o 400 (F47 del plan de E4). La usan `apply` (donde es obligatoria) y crear
 * proyecto (donde es opcional).
 */
export function parseIdempotencyKey(key: string | undefined): string {
  const trimmed = key?.trim() ?? '';
  if (trimmed.length === 0 || trimmed.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw apiError(ErrorCodes.IDEMPOTENCY_KEY_REQUIRED);
  }
  return trimmed;
}
