import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ErrorCodes } from '../common/http/error-codes.js';
import { publicError } from '../common/http/public-error.js';
import { LostClaimError } from '../jobs/lease-sql.js';
import { retryDelay, type RetryOptions } from '../jobs/retry-delay.js';
import { WorkerLoop } from '../jobs/worker-loop.js';
import { evaluateRow, type EvaluationContext } from './engine/evaluate-row.js';
import { EvaluationSummary } from './engine/evaluation-summary.js';
import { isRuleset, type Ruleset } from './engine/ruleset.js';
import { EvaluationsRepository } from './evaluations.repository.js';
import {
  CURRENCY_PATTERN,
  EVALUATION_JOB_DEFAULTS,
  EVALUATION_LIMITS,
  EVALUATION_OPTIONS,
  EvaluationFailure,
  type ClaimedEvaluation,
  type EvaluationOptions,
} from './evaluations.types.js';

/** Solo códigos técnicos cortos (`ECONNRESET`, `P2002`…); nunca mensajes con datos. */
const DIAGNOSTIC_CODE_PATTERN = /^[A-Z0-9_]{1,40}$/;

/**
 * Procesa la cola de evaluaciones de una en una: reclama una, recorre las filas
 * del snapshot por lotes con el motor y la cierra como completada o fallida.
 * El ciclo de vida es el común de los workers (`WorkerLoop`, plan jobs&files D2).
 */
@Injectable()
export class EvaluationWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(EvaluationWorker.name);
  private readonly loop: WorkerLoop;
  private readonly leaseMs: number;
  private readonly retry: RetryOptions;

  constructor(
    private readonly repository: EvaluationsRepository,
    @Inject(EVALUATION_OPTIONS)
    options: EvaluationOptions,
  ) {
    this.leaseMs = options.leaseMs ?? EVALUATION_JOB_DEFAULTS.leaseMs;
    this.retry = options.retry ?? EVALUATION_JOB_DEFAULTS.retry;
    this.loop = new WorkerLoop(
      options,
      () => this.consume(),
      () => this.logger.error('EVALUATION_QUEUE_UNAVAILABLE'),
    );
  }

  onApplicationBootstrap() {
    this.loop.start();
  }

  /**
   * Espera a la evaluación en curso hasta `shutdownMs`. Si no termina, la aborta:
   * la evaluación abortada vuelve a la cola sin gastar un intento (D6).
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
   * Antes de cada reclamo recupera los leases vencidos (D6) y atiende cada
   * evaluación como mucho una vez por pasada, como la importación.
   */
  private async consume() {
    const handled: string[] = [];
    while (!this.loop.isStopping()) {
      await this.repository.recoverExpiredLeases(this.retry);
      const evaluation = await this.repository.claim(this.leaseMs, handled);
      if (!evaluation) {
        return;
      }
      handled.push(evaluation.id);
      this.logger.log({
        code: 'EVALUATION_CLAIMED',
        evaluationId: evaluation.id,
        attempt: evaluation.attempts + 1,
      });
      await this.loop.runJob((signal) =>
        this.processClaimed(evaluation, signal),
      );
    }
  }

  private async processClaimed(
    evaluation: ClaimedEvaluation,
    signal: AbortSignal,
  ) {
    const startedAt = Date.now();
    try {
      await this.process(evaluation, signal);
    } catch (error) {
      await this.handleFailure(evaluation, error, signal);
      return;
    }
    this.logger.log({
      code: 'EVALUATION_SUCCEEDED',
      evaluationId: evaluation.id,
      durationMs: Date.now() - startedAt,
    });
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
      await this.repository.appendRows(evaluation, outcomes);
      lastSourceRow = rows[rows.length - 1].sourceRow;
    }

    signal.throwIfAborted();
    await this.repository.complete(evaluation, summary.finish());
  }

  /**
   * Un reclamo perdido no escribe nada. Un aborto por apagado devuelve la
   * evaluación a la cola sin gastar intento. Un fallo de la evaluación misma
   * (integridad, reglas o moneda guardadas inválidas) termina. Cualquier otro
   * error es temporal y se reintenta desde cero hasta agotar los intentos (D7).
   */
  private async handleFailure(
    evaluation: ClaimedEvaluation,
    error: unknown,
    signal: AbortSignal,
  ) {
    if (error instanceof LostClaimError) {
      this.logClaimLost(evaluation);
      return;
    }
    if (signal.aborted) {
      await this.saveOutcome(evaluation, () =>
        this.repository.release(evaluation),
      );
      return;
    }
    if (isDefinitiveFailure(error)) {
      this.logFailed(evaluation, error.detail.code, evaluation.attempts);
      await this.saveOutcome(evaluation, () =>
        this.repository.fail(evaluation, error.detail),
      );
      return;
    }
    this.logUnexpectedError(evaluation, error);
    await this.retryOrFail(evaluation);
  }

  private async retryOrFail(evaluation: ClaimedEvaluation) {
    const attempts = evaluation.attempts + 1;
    if (attempts >= this.retry.maxAttempts) {
      const error = publicError(ErrorCodes.EVALUATION_PROCESSING_FAILED);
      this.logFailed(evaluation, error.code, attempts);
      await this.saveOutcome(evaluation, () =>
        this.repository.fail(evaluation, error, attempts),
      );
      return;
    }
    const delayMs = retryDelay(attempts, this.retry);
    this.logger.warn({
      code: 'EVALUATION_RETRY_SCHEDULED',
      evaluationId: evaluation.id,
      attempt: attempts,
      delayMs,
    });
    await this.saveOutcome(evaluation, () =>
      this.repository.retryLater(evaluation, attempts, delayMs),
    );
  }

  /**
   * Si no se puede guardar cómo acabó, el lease vencerá y la recuperación la
   * retomará como un fallo temporal más.
   */
  private async saveOutcome(
    evaluation: ClaimedEvaluation,
    save: () => Promise<boolean>,
  ) {
    try {
      if (!(await save())) {
        this.logClaimLost(evaluation);
      }
    } catch {
      this.logger.error({
        code: 'EVALUATION_FAILURE_RECORD_PENDING',
        evaluationId: evaluation.id,
      });
    }
  }

  private logUnexpectedError(evaluation: ClaimedEvaluation, error: unknown) {
    this.logger.error({
      code: ErrorCodes.EVALUATION_PROCESSING_FAILED,
      evaluationId: evaluation.id,
      attempt: evaluation.attempts + 1,
      errorType:
        error instanceof Error ? error.constructor.name : 'UnknownError',
      ...diagnosticFields(error),
    });
  }

  /** Solo el código y los intentos: nunca filas del catálogo. */
  private logFailed(
    evaluation: ClaimedEvaluation,
    errorCode: string,
    attempts: number,
  ) {
    this.logger.warn({
      code: 'EVALUATION_FAILED',
      evaluationId: evaluation.id,
      errorCode,
      attempts,
    });
  }

  private logClaimLost(evaluation: ClaimedEvaluation) {
    this.logger.warn({
      code: 'EVALUATION_CLAIM_LOST',
      evaluationId: evaluation.id,
    });
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

/**
 * Un fallo de la evaluación misma: repetir no lo arregla. `EVALUATION_INTERRUPTED`
 * no lo es: solo dice que se cortó la lectura.
 */
function isDefinitiveFailure(error: unknown): error is EvaluationFailure {
  return (
    error instanceof EvaluationFailure &&
    error.detail.code !== ErrorCodes.EVALUATION_INTERRUPTED
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
