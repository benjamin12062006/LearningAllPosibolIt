import type { FinalFolder } from '../artifacts/artifact.store.js';
import type { RetryOptions } from '../jobs/retry-delay.js';

/** Tipos de evento que acepta la tabla (su `CHECK` tiene la misma lista). */
export const OUTBOX_EVENT_TYPES = ['artifacts.delete'] as const;
export type OutboxEventType = (typeof OUTBOX_EVENT_TYPES)[number];

/** Archivos que hay que borrar porque su dueño ya confirmó el borrado (D9). */
export type ArtifactsDeletePayload = Readonly<{
  folder: FinalFolder;
  keys: readonly string[];
}>;

/** Un evento reclamado por el relay, con su token. */
export type ClaimedOutboxEvent = Readonly<{
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
  token: string;
}>;

export const OUTBOX_OPTIONS = Symbol('OUTBOX_OPTIONS');

export type OutboxOptions = {
  autoStart: boolean;
  pollMs: number;
  shutdownMs: number;
  leaseMs: number;
  retry: RetryOptions;
};

/**
 * Borrar un archivo tarda milisegundos: un minuto de lease sobra. Si el disco
 * falla, se reintenta con esperas de 10 s a 10 min hasta cinco veces; después el
 * evento queda `failed` para revisarlo (C6: un fallo definitivo se conserva).
 */
export const OUTBOX_DEFAULTS: OutboxOptions = Object.freeze({
  autoStart: true,
  pollMs: 5_000,
  shutdownMs: 5_000,
  leaseMs: 60_000,
  retry: Object.freeze({
    baseDelayMs: 10_000,
    maxDelayMs: 600_000,
    maxAttempts: 5,
  }),
});

/** El manejador no pudo hacer su efecto; el relay decide si reintenta. */
export class OutboxHandlerError extends Error {
  constructor(readonly code: string) {
    super(`El manejador del evento falló: ${code}`);
    this.name = 'OutboxHandlerError';
  }
}
