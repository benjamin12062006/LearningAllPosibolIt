import { ErrorCodes } from '../common/http/error-codes.js';

export type RefreshRetryOptions = Readonly<{
  baseDelayMs: number;
  maxDelayMs: number;
  maxAttempts: number;
}>;

/** El adaptador conserva el status del origen sin guardar su URL ni su respuesta. */
export type RefreshError = Readonly<{
  code: string;
  httpStatus?: number;
}>;

export type RefreshErrorKind = 'temporary' | 'permanent' | 'busy';
export type RefreshRecovery =
  | { status: 'queued'; delayMs: number }
  | { status: 'retry_wait'; delayMs: number }
  | { status: 'failed' };

export const DEFAULT_REFRESH_RETRY: RefreshRetryOptions = Object.freeze({
  baseDelayMs: 60_000,
  maxDelayMs: 900_000,
  maxAttempts: 3,
});

/** El proyecto está ocupado con otra importación o evaluación: esperar, no fallar. */
const BUSY_CODES = new Set<string>([
  ErrorCodes.IMPORT_ALREADY_ACTIVE,
  ErrorCodes.EVALUATION_ALREADY_ACTIVE,
]);

/**
 * Errores de datos o de configuración: repetir no los arregla (docs-diagrams/08).
 * Las constantes de `ErrorCodes` hacen que un código mal escrito no compile.
 */
const PERMANENT_CODES = new Set<string>([
  ErrorCodes.SOURCE_URL_NOT_ALLOWED,
  ErrorCodes.SOURCE_REDIRECT_NOT_ALLOWED,
  ErrorCodes.SOURCE_TOO_LARGE,
  ErrorCodes.IMPORT_FILE_TOO_LARGE,
  ErrorCodes.IMPORT_ROW_LIMIT,
  ErrorCodes.CSV_INVALID,
  ErrorCodes.CSV_INVALID_ENCODING,
  ErrorCodes.CSV_HEADERS_INVALID,
  ErrorCodes.CSV_COLUMN_MISSING,
  ErrorCodes.CSV_ID_MISSING,
  ErrorCodes.CSV_DUPLICATE_ID,
  ErrorCodes.CSV_EMPTY,
  ErrorCodes.EVALUATION_COLUMN_MISSING,
  ErrorCodes.RULESET_NOT_FOUND,
  ErrorCodes.REFRESH_SOURCE_MISSING,
  ErrorCodes.REFRESH_POLICY_MISSING,
  // La exportación automática no puede hacerse: repetir no lo cambia.
  ErrorCodes.EXPORT_EVALUATION_SUPERSEDED,
  ErrorCodes.EXPORT_EVALUATION_OUTDATED,
  ErrorCodes.EXPORT_NO_VALID_PRODUCTS,
]);

/** attempt es el número de fallos consumidos; 1 produce la espera base. */
export function nextRetryDelay(
  attempt: number,
  options: RefreshRetryOptions = DEFAULT_REFRESH_RETRY,
): number {
  assertRetryOptions(options);
  assertPositiveInteger(attempt, 'attempt');
  // Limitar el multiplicador evita Infinity incluso con un contador corrupto.
  const multiplier = Math.min(
    2 ** (attempt - 1),
    options.maxDelayMs / options.baseDelayMs,
  );
  return Math.min(options.baseDelayMs * multiplier, options.maxDelayMs);
}

export function classifyRefreshError(error: RefreshError): RefreshErrorKind {
  if (BUSY_CODES.has(error.code)) return 'busy';
  if (PERMANENT_CODES.has(error.code)) return 'permanent';
  if (error.code === 'SOURCE_HTTP_ERROR') {
    return classifySourceStatus(error.httpStatus);
  }
  return 'temporary';
}

/** Decisión pura: persistir el resultado corresponde al repositorio con lease. */
export function decideRefreshRecovery(
  error: RefreshError,
  failedAttempts: number,
  options: RefreshRetryOptions = DEFAULT_REFRESH_RETRY,
): RefreshRecovery {
  assertRetryOptions(options);
  if (!Number.isSafeInteger(failedAttempts) || failedAttempts < 0) {
    throw new RangeError('failedAttempts must be a non-negative safe integer');
  }

  const kind = classifyRefreshError(error);
  if (kind === 'busy') {
    return { status: 'queued', delayMs: options.baseDelayMs };
  }
  assertPositiveInteger(failedAttempts, 'failedAttempts');
  const attemptsExhausted = failedAttempts >= options.maxAttempts;
  if (kind === 'permanent' || attemptsExhausted) {
    return { status: 'failed' };
  }
  return {
    status: 'retry_wait',
    delayMs: nextRetryDelay(failedAttempts, options),
  };
}

function classifySourceStatus(status: number | undefined): RefreshErrorKind {
  const isClientError =
    status !== undefined &&
    Number.isInteger(status) &&
    status >= 400 &&
    status < 500;
  if (isClientError && status !== 429) return 'permanent';
  return 'temporary';
}

function assertRetryOptions(options: RefreshRetryOptions) {
  assertPositiveInteger(options.baseDelayMs, 'baseDelayMs');
  assertPositiveInteger(options.maxDelayMs, 'maxDelayMs');
  assertPositiveInteger(options.maxAttempts, 'maxAttempts');
  if (options.baseDelayMs > options.maxDelayMs) {
    throw new RangeError('baseDelayMs must not exceed maxDelayMs');
  }
}

function assertPositiveInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}
