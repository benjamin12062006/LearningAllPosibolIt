/**
 * Espera creciente con tope para los reintentos de cualquier trabajo (lease y
 * reintentos de feeds, D4; importación y evaluación en jobs&files, D4 y D7).
 * Pura: quien la usa guarda el resultado con su propio reloj de la base.
 */
export type RetryOptions = Readonly<{
  baseDelayMs: number;
  maxDelayMs: number;
  /** Fallos consumidos con los que el trabajo deja de reintentarse. */
  maxAttempts: number;
}>;

/** attempt es el número de fallos consumidos; 1 produce la espera base. */
export function retryDelay(attempt: number, options: RetryOptions): number {
  assertRetryOptions(options);
  assertPositiveInteger(attempt, 'attempt');
  // Limitar el multiplicador evita Infinity incluso con un contador corrupto.
  const multiplier = Math.min(
    2 ** (attempt - 1),
    options.maxDelayMs / options.baseDelayMs,
  );
  return Math.min(options.baseDelayMs * multiplier, options.maxDelayMs);
}

export function assertRetryOptions(options: RetryOptions) {
  assertPositiveInteger(options.baseDelayMs, 'baseDelayMs');
  assertPositiveInteger(options.maxDelayMs, 'maxDelayMs');
  assertPositiveInteger(options.maxAttempts, 'maxAttempts');
  if (options.baseDelayMs > options.maxDelayMs) {
    throw new RangeError('baseDelayMs must not exceed maxDelayMs');
  }
}

export function assertPositiveInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}
