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
import { CatalogImportRepository } from './catalog-import.repository.js';
import { parseCatalogCsv } from './csv-parser.js';
import {
  CATALOG_IMPORT_OPTIONS,
  IMPORT_LIMITS,
  ImportFailure,
  type CatalogImportOptions,
  type ClaimedImport,
  type ImportError,
  type ImportRow,
} from './import.types.js';

/** Solo códigos técnicos cortos (`ECONNRESET`, `P2002`…); nunca mensajes con datos. */
const DIAGNOSTIC_CODE_PATTERN = /^[A-Z0-9_]{1,40}$/;

/**
 * Procesa la cola de importaciones de uno en uno: reclama un trabajo, lee su
 * CSV, guarda las filas por lotes y lo cierra como completado o fallido.
 */
@Injectable()
export class CatalogImportWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(CatalogImportWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private active?: AbortController;
  private stopping = false;

  constructor(
    private readonly repository: CatalogImportRepository,
    private readonly store: ArtifactStore,
    @Inject(CATALOG_IMPORT_OPTIONS)
    private readonly options: CatalogImportOptions,
  ) {}

  /** Los trabajos que quedaron `running` en un arranque anterior ya no pueden seguir. */
  async onApplicationBootstrap() {
    await this.repository.interruptRunning();
    if (this.options.autoStart) {
      this.timer = setInterval(() => this.wake(), this.options.pollMs);
      this.timer.unref();
      this.wake();
    }
  }

  /**
   * Espera al trabajo en curso hasta `shutdownMs`. Si no termina, lo aborta y
   * lo marca como interrumpido para que no quede `running` para siempre.
   */
  async onModuleDestroy() {
    this.stopping = true;
    clearInterval(this.timer);
    if (!this.running) {
      return;
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.running,
        new Promise<void>((resolve) => {
          timeout = setTimeout(() => {
            this.active?.abort();
            resolve();
          }, this.options.shutdownMs);
        }),
      ]);
      if (this.active?.signal.aborted) {
        await this.repository.interruptRunning();
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  wake() {
    if (this.options.autoStart) {
      void this.runUntilIdle().catch(() =>
        this.logger.error('IMPORT_QUEUE_UNAVAILABLE'),
      );
    }
  }

  /** Vacía la cola. Si ya se está vaciando, devuelve esa misma ejecución. */
  runUntilIdle(): Promise<void> {
    if (this.stopping) {
      return Promise.resolve();
    }
    this.running ??= this.consume().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async consume() {
    while (!this.stopping) {
      const job = await this.repository.claim();
      if (!job) {
        return;
      }
      await this.processClaimedJob(job);
    }
  }

  private async processClaimedJob(job: ClaimedImport) {
    this.active = new AbortController();
    if (this.stopping) {
      this.active.abort();
    }

    try {
      await this.process(job, this.active.signal);
    } catch (error) {
      await this.recordFailure(job, error, this.active.signal.aborted);
    } finally {
      this.active = undefined;
    }
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

  private async recordFailure(
    job: ClaimedImport,
    error: unknown,
    aborted: boolean,
  ) {
    if (!(error instanceof ImportFailure)) {
      this.logUnexpectedError(job, error);
    }
    await this.saveFailure(job, failureDetail(error, aborted));
  }

  private logUnexpectedError(job: ClaimedImport, error: unknown) {
    this.logger.error({
      code: ErrorCodes.IMPORT_PROCESSING_FAILED,
      jobId: job.id,
      errorType:
        error instanceof Error ? error.constructor.name : 'UnknownError',
      ...diagnosticFields(error),
    });
  }

  /** Si no se puede guardar el fallo, `interruptRunning` lo cerrará al reiniciar. */
  private async saveFailure(job: ClaimedImport, detail: ImportError) {
    try {
      await this.repository.fail(job, detail);
    } catch {
      this.logger.error({
        code: 'IMPORT_FAILURE_RECORD_PENDING',
        jobId: job.id,
      });
    }
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

function failureDetail(error: unknown, aborted: boolean): ImportError {
  if (aborted) {
    return publicError(ErrorCodes.IMPORT_INTERRUPTED);
  }
  if (error instanceof ImportFailure) {
    return error.detail;
  }
  return publicError(ErrorCodes.IMPORT_PROCESSING_FAILED);
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
