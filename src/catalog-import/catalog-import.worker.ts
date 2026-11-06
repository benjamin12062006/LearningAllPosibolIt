import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ErrorCodes } from '../common/http/error-codes.js';
import { publicError } from '../common/http/public-error.js';
import { ArtifactStore } from '../artifacts/artifact.store.js';
import { LostClaimError } from '../jobs/lease-sql.js';
import { retryDelay, type RetryOptions } from '../jobs/retry-delay.js';
import { WorkerLoop } from '../jobs/worker-loop.js';
import { CatalogImportRepository } from './catalog-import.repository.js';
import { parseCatalogCsv } from './csv-parser.js';
import {
  CATALOG_IMPORT_OPTIONS,
  IMPORT_JOB_DEFAULTS,
  IMPORT_LIMITS,
  ImportFailure,
  type CatalogImportOptions,
  type ClaimedImport,
  type ImportRow,
} from './import.types.js';

/** Solo códigos técnicos cortos (`ECONNRESET`, `P2002`…); nunca mensajes con datos. */
const DIAGNOSTIC_CODE_PATTERN = /^[A-Z0-9_]{1,40}$/;

/**
 * Procesa la cola de importaciones de uno en uno: reclama un trabajo con lease
 * y token, lee su CSV, guarda las filas por lotes y lo cierra como completado,
 * fallido o pendiente de reintento (plan jobs&files, D4–D6). Al arrancar no
 * marca nada como interrumpido: lo que tenga el lease vencido se recupera,
 * aunque haya otra instancia trabajando.
 */
@Injectable()
export class CatalogImportWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(CatalogImportWorker.name);
  private readonly loop: WorkerLoop;
  private readonly leaseMs: number;
  private readonly retry: RetryOptions;

  constructor(
    private readonly repository: CatalogImportRepository,
    private readonly store: ArtifactStore,
    @Inject(CATALOG_IMPORT_OPTIONS)
    options: CatalogImportOptions,
  ) {
    this.leaseMs = options.leaseMs ?? IMPORT_JOB_DEFAULTS.leaseMs;
    this.retry = options.retry ?? IMPORT_JOB_DEFAULTS.retry;
    this.loop = new WorkerLoop(
      options,
      () => this.consume(),
      () => this.logger.error('IMPORT_QUEUE_UNAVAILABLE'),
    );
  }

  onApplicationBootstrap() {
    this.loop.start();
  }

  /**
   * Espera al trabajo en curso hasta `shutdownMs`. Si no termina, lo aborta: el
   * trabajo abortado vuelve a la cola sin gastar un intento (D6).
   */
  async onModuleDestroy() {
    await this.loop.stop();
  }

  wake() {
    this.loop.wake();
  }

  /** Vacía la cola. Si ya se está vaciando, devuelve esa misma ejecución. */
  runUntilIdle(): Promise<void> {
    return this.loop.runUntilIdle();
  }

  /**
   * Antes de cada reclamo recupera los leases vencidos (D6). Atiende cada
   * trabajo como mucho una vez por pasada: un reintento con una espera muy
   * corta volvería a estar listo enseguida y la pasada no terminaría. Lo recoge
   * la pasada siguiente.
   */
  private async consume() {
    const handled: string[] = [];
    while (!this.loop.isStopping()) {
      await this.repository.recoverExpiredLeases(this.retry);
      const job = await this.repository.claim(this.leaseMs, handled);
      if (!job) {
        return;
      }
      handled.push(job.id);
      this.logger.log({
        code: 'IMPORT_CLAIMED',
        jobId: job.id,
        attempt: job.attempts + 1,
      });
      await this.loop.runJob((signal) => this.processClaimedJob(job, signal));
    }
  }

  private async processClaimedJob(job: ClaimedImport, signal: AbortSignal) {
    const startedAt = Date.now();
    try {
      await this.process(job, signal);
    } catch (error) {
      await this.handleFailure(job, error, signal);
      return;
    }
    this.logger.log({
      code: 'IMPORT_SUCCEEDED',
      jobId: job.id,
      durationMs: Date.now() - startedAt,
    });
  }

  private async process(job: ClaimedImport, signal: AbortSignal) {
    let headers: string[] = [];
    const batch = new ImportBatch();

    const flush = async () => {
      signal.throwIfAborted();
      const rows = batch.take();
      if (rows.length > 0) {
        await this.repository.appendBatch(job, rows);
      }
    };

    const events = parseCatalogCsv(
      this.store.openRead(job.artifactKey, signal),
      { idColumn: job.idColumn, delimiter: job.delimiter, signal },
    );
    for await (const event of events) {
      switch (event.kind) {
        case 'headers':
          headers = event.headers;
          break;

        case 'row': {
          const rowBytes = byteSizeOf(event.row);
          if (!batch.isEmpty() && batch.wouldOverflow(rowBytes)) {
            await flush();
          }
          batch.add(event.row, rowBytes);
          if (batch.isFull()) {
            await flush();
          }
          break;
        }

        case 'complete':
          await flush();
          signal.throwIfAborted();
          await this.repository.complete(job, { ...event, headers });
          break;
      }
    }
  }

  /**
   * Un reclamo perdido no escribe nada. Un aborto por apagado devuelve el
   * trabajo a la cola sin gastar intento. Un error de los datos termina: repetir
   * no lo arregla. Cualquier otro error es temporal y se reintenta desde cero,
   * con espera creciente, hasta agotar los intentos (D4).
   */
  private async handleFailure(
    job: ClaimedImport,
    error: unknown,
    signal: AbortSignal,
  ) {
    if (error instanceof LostClaimError) {
      this.logClaimLost(job);
      return;
    }
    if (signal.aborted) {
      await this.saveOutcome(job, () => this.repository.release(job));
      return;
    }
    if (isDataFailure(error)) {
      this.logFailed(job, error.detail.code, job.attempts);
      await this.saveOutcome(job, () =>
        this.repository.fail(job, error.detail),
      );
      return;
    }
    this.logUnexpectedError(job, error);
    await this.retryOrFail(job);
  }

  private async retryOrFail(job: ClaimedImport) {
    const attempts = job.attempts + 1;
    if (attempts >= this.retry.maxAttempts) {
      const error = publicError(ErrorCodes.IMPORT_PROCESSING_FAILED);
      this.logFailed(job, error.code, attempts);
      await this.saveOutcome(job, () =>
        this.repository.fail(job, error, attempts),
      );
      return;
    }
    const delayMs = retryDelay(attempts, this.retry);
    this.logger.warn({
      code: 'IMPORT_RETRY_SCHEDULED',
      jobId: job.id,
      attempt: attempts,
      delayMs,
    });
    await this.saveOutcome(job, () =>
      this.repository.retryLater(job, attempts, delayMs),
    );
  }

  /**
   * Si no se puede guardar cómo acabó, el lease vencerá y la recuperación lo
   * retomará como un fallo temporal más.
   */
  private async saveOutcome(job: ClaimedImport, save: () => Promise<boolean>) {
    try {
      if (!(await save())) {
        this.logClaimLost(job);
      }
    } catch {
      this.logger.error({
        code: 'IMPORT_FAILURE_RECORD_PENDING',
        jobId: job.id,
      });
    }
  }

  private logUnexpectedError(job: ClaimedImport, error: unknown) {
    this.logger.error({
      code: ErrorCodes.IMPORT_PROCESSING_FAILED,
      jobId: job.id,
      attempt: job.attempts + 1,
      errorType:
        error instanceof Error ? error.constructor.name : 'UnknownError',
      ...diagnosticFields(error),
    });
  }

  /** Solo el código y los intentos: nunca filas ni nombres de archivo. */
  private logFailed(job: ClaimedImport, errorCode: string, attempts: number) {
    this.logger.warn({
      code: 'IMPORT_FAILED',
      jobId: job.id,
      errorCode,
      attempts,
    });
  }

  private logClaimLost(job: ClaimedImport) {
    this.logger.warn({ code: 'IMPORT_CLAIM_LOST', jobId: job.id });
  }
}

/**
 * Filas pendientes de guardar. Un lote se envía al llegar a `batchRows` filas o
 * a `batchBytes` bytes, lo que ocurra antes.
 */
class ImportBatch {
  private rows: ImportRow[] = [];
  private bytes = 0;

  isEmpty() {
    return this.rows.length === 0;
  }

  /** Añadir una fila de este tamaño pasaría el límite del lote. */
  wouldOverflow(rowBytes: number) {
    return (
      this.rows.length >= IMPORT_LIMITS.batchRows ||
      this.bytes + rowBytes > IMPORT_LIMITS.batchBytes
    );
  }

  isFull() {
    return (
      this.bytes >= IMPORT_LIMITS.batchBytes ||
      this.rows.length >= IMPORT_LIMITS.batchRows
    );
  }

  add(row: ImportRow, rowBytes: number) {
    this.rows.push(row);
    this.bytes += rowBytes;
  }

  /** Devuelve las filas y deja el lote vacío. */
  take(): ImportRow[] {
    const rows = this.rows;
    this.rows = [];
    this.bytes = 0;
    return rows;
  }
}

function byteSizeOf(row: ImportRow) {
  return Buffer.byteLength(JSON.stringify(row.originalValues));
}

/**
 * Un error de los datos (CSV inválido, límites, integridad): repetir no lo
 * arregla. `IMPORT_INTERRUPTED` no lo es: solo dice que se cortó la lectura.
 */
function isDataFailure(error: unknown): error is ImportFailure {
  return (
    error instanceof ImportFailure &&
    error.detail.code !== ErrorCodes.IMPORT_INTERRUPTED
  );
}

function diagnosticFields(error: unknown): { diagnosticCode?: string } {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return {};
  }
  const code = error.code;
  if (typeof code === 'string' && DIAGNOSTIC_CODE_PATTERN.test(code)) {
    return { diagnosticCode: code };
  }
  return {};
}
