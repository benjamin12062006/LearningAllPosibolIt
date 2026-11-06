import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  ArtifactStore,
  FINAL_FOLDERS,
  type FinalFolder,
} from '../artifacts/artifact.store.js';
import { retryDelay } from '../jobs/retry-delay.js';
import { WorkerLoop } from '../jobs/worker-loop.js';
import { OutboxRepository } from './outbox.repository.js';
import {
  OUTBOX_OPTIONS,
  OutboxHandlerError,
  type ArtifactsDeletePayload,
  type ClaimedOutboxEvent,
  type OutboxOptions,
} from './outbox.types.js';

/** El evento guardado no tiene la forma de su tipo: repetir no lo arregla. */
const PAYLOAD_INVALID = 'OUTBOX_PAYLOAD_INVALID';
const TYPE_UNKNOWN = 'OUTBOX_TYPE_UNKNOWN';
const ARTIFACT_DELETE_FAILED = 'ARTIFACT_DELETE_FAILED';

/** Errores que reintentar no arregla: el evento se cierra como `failed`. */
const DEFINITIVE_CODES = new Set([PAYLOAD_INVALID, TYPE_UNKNOWN]);

/**
 * Relay del outbox (plan jobs&files, D8): reclama los eventos pendientes con
 * lease y token y ejecuta el efecto de cada uno. La entrega es «al menos una
 * vez»: si cae después del efecto y antes de marcarlo, el siguiente intento lo
 * repite, así que cada manejador es idempotente (F2).
 */
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);
  private readonly loop: WorkerLoop;

  constructor(
    private readonly repository: OutboxRepository,
    private readonly store: ArtifactStore,
    @Inject(OUTBOX_OPTIONS)
    private readonly options: OutboxOptions,
  ) {
    this.loop = new WorkerLoop(
      options,
      () => this.consume(),
      () => this.logger.error({ code: 'OUTBOX_UNAVAILABLE' }),
    );
  }

  onApplicationBootstrap() {
    this.loop.start();
  }

  async onModuleDestroy() {
    await this.loop.stop();
  }

  wake() {
    this.loop.wake();
  }

  /** Entrega lo pendiente. Si ya hay una pasada en curso, devuelve esa. */
  runUntilIdle(): Promise<void> {
    return this.loop.runUntilIdle();
  }

  /**
   * Entrega lo que el llamante acaba de confirmar, antes de que responda. Si el
   * efecto falla, el evento queda pendiente y se reintenta en las pasadas
   * siguientes.
   */
  deliverNow(): Promise<void> {
    return this.loop.runFreshPass();
  }

  private async consume() {
    const handled: string[] = [];
    while (!this.loop.isStopping()) {
      await this.repository.recoverExpiredLeases(this.options.retry);
      const event = await this.repository.claim(this.options.leaseMs, handled);
      if (!event) {
        return;
      }
      handled.push(event.id);
      await this.loop.runJob((signal) => this.deliver(event, signal));
    }
  }

  private async deliver(event: ClaimedOutboxEvent, signal: AbortSignal) {
    try {
      await this.handle(event);
    } catch (error) {
      await this.recordFailure(event, error, signal);
      return;
    }
    if (!(await this.repository.complete(event))) {
      this.logger.warn({ code: 'OUTBOX_CLAIM_LOST', eventId: event.id });
    }
  }

  /** Un manejador por tipo de evento. */
  private async handle(event: ClaimedOutboxEvent) {
    switch (event.type) {
      case 'artifacts.delete':
        return this.deleteArtifacts(event.payload);
      default:
        throw new OutboxHandlerError(TYPE_UNKNOWN);
    }
  }

  /** Idempotente: un archivo que ya no existe cuenta como borrado. */
  private async deleteArtifacts(payload: unknown) {
    if (!isArtifactsDeletePayload(payload)) {
      throw new OutboxHandlerError(PAYLOAD_INVALID);
    }
    for (const key of payload.keys) {
      try {
        await this.store.removeStored(payload.folder, key);
      } catch {
        throw new OutboxHandlerError(ARTIFACT_DELETE_FAILED);
      }
    }
  }

  /**
   * Al apagar, el evento vuelve a la cola sin gastar intento. Un evento mal
   * formado termina; cualquier otro fallo se reintenta con espera creciente.
   */
  private async recordFailure(
    event: ClaimedOutboxEvent,
    error: unknown,
    signal: AbortSignal,
  ) {
    if (signal.aborted) {
      await this.repository.release(event);
      return;
    }
    const code =
      error instanceof OutboxHandlerError
        ? error.code
        : 'OUTBOX_HANDLER_FAILED';
    const attempts = event.attempts + 1;
    this.logger.warn({
      code,
      eventId: event.id,
      type: event.type,
      attempt: attempts,
    });
    if (
      DEFINITIVE_CODES.has(code) ||
      attempts >= this.options.retry.maxAttempts
    ) {
      await this.repository.fail(event, attempts, code);
      return;
    }
    await this.repository.retryLater(
      event,
      attempts,
      retryDelay(attempts, this.options.retry),
    );
  }
}

/** Lo leído de `jsonb` se comprueba antes de usarlo. */
function isArtifactsDeletePayload(
  payload: unknown,
): payload is ArtifactsDeletePayload {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('folder' in payload) ||
    !('keys' in payload)
  ) {
    return false;
  }
  return (
    isFinalFolder(payload.folder) &&
    Array.isArray(payload.keys) &&
    payload.keys.every((key) => typeof key === 'string')
  );
}

function isFinalFolder(value: unknown): value is FinalFolder {
  return FINAL_FOLDERS.some((folder) => folder === value);
}
