import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ErrorCodes } from '../common/http/error-codes.js';
import { publicError, type PublicError } from '../common/http/public-error.js';
import { evaluateRow, type EvaluationContext } from './engine/evaluate-row.js';
import { EvaluationSummary } from './engine/evaluation-summary.js';
import { isRuleset, type Ruleset } from './engine/ruleset.js';
import { EvaluationsRepository } from './evaluations.repository.js';
import {
  EVALUATION_LIMITS,
  EVALUATION_OPTIONS,
  EvaluationFailure,
  type ClaimedEvaluation,
  type EvaluationOptions,
} from './evaluations.types.js';

/** Solo códigos técnicos cortos (`ECONNRESET`, `P2002`…); nunca mensajes con datos. */
const DIAGNOSTIC_CODE_PATTERN = /^[A-Z0-9_]{1,40}$/;

/** Código ISO 4217, como lo guarda la configuración del proyecto. */
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * Procesa la cola de evaluaciones de una en una: reclama una, recorre las filas
 * del snapshot por lotes con el motor y la cierra como completada o fallida.
 * Copia el ciclo de vida de `CatalogImportWorker` (plan D8): con dos
 * consumidores todavía no compensa extraer una cola común.
 */
@Injectable()
export class EvaluationWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(EvaluationWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private active?: AbortController;
  private stopping = false;

  constructor(
    private readonly repository: EvaluationsRepository,
    @Inject(EVALUATION_OPTIONS)
    private readonly options: EvaluationOptions,
  ) {}

  /** Las evaluaciones que quedaron `running` en un arranque anterior ya no pueden seguir. */
  async onApplicationBootstrap() {
    await this.repository.interruptRunning();
    if (this.options.autoStart) {
      this.timer = setInterval(() => this.wake(), this.options.pollMs);
      this.timer.unref();
      this.wake();
    }
  }

  /**
   * Espera a la evaluación en curso hasta `shutdownMs`. Si no termina, la aborta
   * y la marca como interrumpida para que no quede `running` para siempre.
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
        this.logger.error('EVALUATION_QUEUE_UNAVAILABLE'),
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
      const evaluation = await this.repository.claim();
      if (!evaluation) {
        return;
      }
      await this.processClaimed(evaluation);
    }
  }

  private async processClaimed(evaluation: ClaimedEvaluation) {
    this.active = new AbortController();
    if (this.stopping) {
      this.active.abort();
    }

    try {
      await this.process(evaluation, this.active.signal);
    } catch (error) {
      await this.recordFailure(evaluation, error, this.active.signal.aborted);
    } finally {
      this.active = undefined;
    }
  }

  /**
   * Lee las filas en orden de `source_row`, evalúa cada lote y lo guarda antes
   * de pedir el siguiente. El resumen recibe las filas en ese mismo orden,
   * del que depende la suma de comprobación.
   */
  private async process(evaluation: ClaimedEvaluation, signal: AbortSignal) {
    const ruleset = readRuleset(evaluation);
    const context = readContext(evaluation);
    const summary = new EvaluationSummary();
    let lastSourceRow = 0;

    for (;;) {
      signal.throwIfAborted();
      const rows = await this.repository.readCatalogRows(
        evaluation.snapshotId,
        lastSourceRow,
        EVALUATION_LIMITS.batchRows,
      );
      if (rows.length === 0) {
        break;
      }

      const outcomes = rows.map((row) => evaluateRow(row, ruleset, context));
      for (const outcome of outcomes) {
        summary.add(outcome);
      }
      await this.repository.appendRows(evaluation.id, outcomes);
      lastSourceRow = rows[rows.length - 1].sourceRow;
    }

    signal.throwIfAborted();
    await this.repository.complete(evaluation, summary.finish());
  }

  private async recordFailure(
    evaluation: ClaimedEvaluation,
    error: unknown,
    aborted: boolean,
  ) {
    if (!(error instanceof EvaluationFailure)) {
      this.logUnexpectedError(evaluation, error);
    }
    await this.saveFailure(evaluation, failureDetail(error, aborted));
  }

  private logUnexpectedError(evaluation: ClaimedEvaluation, error: unknown) {
    this.logger.error({
      code: ErrorCodes.EVALUATION_PROCESSING_FAILED,
      evaluationId: evaluation.id,
      errorType:
        error instanceof Error ? error.constructor.name : 'UnknownError',
      ...diagnosticFields(error),
    });
  }

  /** Si no se puede guardar el fallo, `interruptRunning` la cerrará al reiniciar. */
  private async saveFailure(
    evaluation: ClaimedEvaluation,
    detail: PublicError,
  ) {
    try {
      await this.repository.fail(evaluation.id, detail);
    } catch {
      this.logger.error({
        code: 'EVALUATION_FAILURE_RECORD_PENDING',
        evaluationId: evaluation.id,
      });
    }
  }
}

/** Lo leído de `jsonb` se comprueba antes de dárselo al motor (F25). */
function readRuleset(evaluation: ClaimedEvaluation): Ruleset {
  const ruleset = { mapping: evaluation.mapping, rules: evaluation.rules };
  if (!isRuleset(ruleset)) {
    throw new EvaluationFailure(ErrorCodes.EVALUATION_PROCESSING_FAILED);
  }
  return ruleset;
}

/** La moneda es la congelada en el snapshot, no la configuración actual del proyecto. */
function readContext(evaluation: ClaimedEvaluation): EvaluationContext {
  const { currency } = evaluation;
  if (typeof currency !== 'string' || !CURRENCY_PATTERN.test(currency)) {
    throw new EvaluationFailure(ErrorCodes.EVALUATION_PROCESSING_FAILED);
  }
  return { currency };
}

function failureDetail(error: unknown, aborted: boolean): PublicError {
  if (aborted) {
    return publicError(ErrorCodes.EVALUATION_INTERRUPTED);
  }
  if (error instanceof EvaluationFailure) {
    return error.detail;
  }
  return publicError(ErrorCodes.EVALUATION_PROCESSING_FAILED);
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
