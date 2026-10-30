import { ErrorCodes } from '../common/http/error-codes.js';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ArtifactStore } from './artifact.store.js';
import { publicError } from '../common/http/public-error.js';
import { CatalogImportRepository } from './catalog-import.repository.js';
import { parseCatalogCsv } from './csv-parser.js';
import {
  CATALOG_IMPORT_OPTIONS,
  IMPORT_LIMITS,
  ImportFailure,
  type CatalogImportOptions,
  type ClaimedImport,
  type ImportRow,
} from './import.types.js';

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

  async onApplicationBootstrap() {
    await this.repository.interruptRunning();
    if (this.options.autoStart) {
      this.timer = setInterval(() => this.wake(), this.options.pollMs);
      this.timer.unref();
      this.wake();
    }
  }

  wake() {
    if (this.options.autoStart)
      void this.runUntilIdle().catch(() =>
        this.logger.error('IMPORT_QUEUE_UNAVAILABLE'),
      );
  }

  runUntilIdle(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    this.running ??= this.consume().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async consume() {
    while (!this.stopping) {
      const job = await this.repository.claim();
      if (!job) return;
      this.active = new AbortController();
      if (this.stopping) this.active.abort();
      try {
        await this.process(job, this.active.signal);
      } catch (error) {
        if (!(error instanceof ImportFailure)) {
          const code: unknown =
            typeof error === 'object' && error !== null && 'code' in error
              ? error.code
              : undefined;
          this.logger.error({
            code: ErrorCodes.IMPORT_PROCESSING_FAILED,
            jobId: job.id,
            errorType:
              error instanceof Error ? error.constructor.name : 'UnknownError',
            ...(typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code)
              ? { diagnosticCode: code }
              : {}),
          });
        }
        const detail = this.active.signal.aborted
          ? publicError(ErrorCodes.IMPORT_INTERRUPTED)
          : error instanceof ImportFailure
            ? error.detail
            : publicError(ErrorCodes.IMPORT_PROCESSING_FAILED);
        try {
          await this.repository.fail(job, detail);
        } catch {
          this.logger.error({
            code: 'IMPORT_FAILURE_RECORD_PENDING',
            jobId: job.id,
          });
        }
      } finally {
        this.active = undefined;
      }
    }
  }

  private async process(job: ClaimedImport, signal: AbortSignal) {
    let headers: string[] = [];
    let batch: ImportRow[] = [];
    let batchBytes = 0;
    const flush = async () => {
      signal.throwIfAborted();
      if (batch.length) await this.repository.appendBatch(job, batch);
      batch = [];
      batchBytes = 0;
    };
    for await (const event of parseCatalogCsv(
      this.store.openRead(job.artifactKey, signal),
      { idColumn: job.idColumn, delimiter: job.delimiter, signal },
    )) {
      if (event.kind === 'headers') headers = event.headers;
      if (event.kind === 'row') {
        const bytes = Buffer.byteLength(
          JSON.stringify(event.row.originalValues),
        );
        if (
          batch.length &&
          (batch.length >= IMPORT_LIMITS.batchRows ||
            batchBytes + bytes > IMPORT_LIMITS.batchBytes)
        )
          await flush();
        batch.push(event.row);
        batchBytes += bytes;
        if (
          batchBytes >= IMPORT_LIMITS.batchBytes ||
          batch.length >= IMPORT_LIMITS.batchRows
        )
          await flush();
      }
      if (event.kind === 'complete') {
        await flush();
        signal.throwIfAborted();
        await this.repository.complete(job, { ...event, headers });
      }
    }
  }

  async onModuleDestroy() {
    this.stopping = true;
    clearInterval(this.timer);
    if (!this.running) return;
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
}
