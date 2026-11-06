import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  ErrorCodes,
  isErrorCode,
  type ErrorCode,
} from '../common/http/error-codes.js';
import {
  ApplicationFailure,
  publicError,
} from '../common/http/public-error.js';
import {
  classifyRefreshError,
  decideRefreshRecovery,
  type RefreshError,
} from '../jobs/refresh-retry.js';
import { WorkerLoop } from '../jobs/worker-loop.js';
import { RemoteSourceFailure } from '../remote-source/remote-source.types.js';
import {
  FeedRefreshSteps,
  RefreshStepFailure,
  type StepResult,
} from './feed-refresh.steps.js';
import { FeedRefreshScheduler } from './feed-refresh.scheduler.js';
import { FeedRefreshesRepository } from './feed-refreshes.repository.js';
import {
  FEED_REFRESH_OPTIONS,
  LostClaimError,
  type ClaimedRefresh,
  type FeedRefreshOptions,
  type PlannedIds,
  type RefreshStage,
} from './feed-refreshes.types.js';

/** Un fallo ya traducido: su código público y desde dónde repetir. */
type StepError = RefreshError &
  Readonly<{ code: ErrorCode; restartAt?: RefreshStage; forget: PlannedIds }>;

/**
 * Procesa las actualizaciones de los feeds de una en una (D2–D4). A diferencia
 * de los workers de importación y evaluación, al arrancar no marca nada como
 * interrumpido: los trabajos con el lease vencido se recuperan con su token
 * invalidado, aunque haya otra instancia trabajando.
 */
@Injectable()
export class FeedRefreshWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(FeedRefreshWorker.name);
  private readonly loop: WorkerLoop;

  constructor(
    private readonly repository: FeedRefreshesRepository,
    private readonly scheduler: FeedRefreshScheduler,
    private readonly steps: FeedRefreshSteps,
    @Inject(FEED_REFRESH_OPTIONS)
    private readonly options: FeedRefreshOptions,
  ) {
    this.loop = new WorkerLoop(
      options,
      () => this.consume(),
      () => this.logger.error({ code: 'FEED_REFRESH_QUEUE_UNAVAILABLE' }),
    );
  }

  onApplicationBootstrap() {
    this.loop.start();
  }

  /**
   * Espera al trabajo en curso hasta `shutdownMs`. Si no termina, lo aborta: el
   * paso abortado devuelve el trabajo a la cola sin gastar un intento.
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
   * Cada pasada empieza encolando las actualizaciones programadas que ya tocan
   * (D10). Después atiende cada actualización como mucho una vez: una que se deja
   * esperando con un retraso corto (o cero) volvería a estar lista al instante
   * y la pasada no terminaría nunca. La recoge la pasada siguiente.
   */
  private async consume() {
    await this.scheduler.enqueueDue(this.options.clock());
    const handled: string[] = [];
    while (!this.loop.isStopping()) {
      await this.repository.recoverExpiredLeases(this.options.retry);
      const claim = await this.repository.claim(this.options.leaseMs, handled);
      if (!claim) {
        return;
      }
      handled.push(claim.id);
      await this.processClaimed(claim);
    }
  }

  private processClaimed(claim: ClaimedRefresh) {
    return this.loop.runJob((signal) => this.runSteps(claim, signal));
  }

  private async runSteps(claim: ClaimedRefresh, signal: AbortSignal) {
    let current = claim;
    try {
      for (;;) {
        const result = await this.steps.run(current, signal);
        if (result.kind !== 'advance') {
          await this.finishStep(current, result);
          return;
        }
        current = await this.advance(result);
      }
    } catch (error) {
      await this.handleFailure(current, error, signal);
    }
  }

  private async advance(
    result: Extract<StepResult, { kind: 'advance' }>,
  ): Promise<ClaimedRefresh> {
    if (!(await this.repository.advance(result.claim, result.stage))) {
      throw new LostClaimError();
    }
    return { ...result.claim, stage: result.stage };
  }

  /**
   * Guarda cómo acabó el paso: esperar, o terminar con su resultado. Si el paso
   * ya terminó la actualización en su propia transacción (`finished`), no hay
   * nada más que guardar.
   */
  private async finishStep(
    claim: ClaimedRefresh,
    result: Exclude<StepResult, { kind: 'advance' }>,
  ) {
    if (result.kind === 'finished') {
      return;
    }
    const saved =
      result.kind === 'wait'
        ? await this.repository.requeue(claim, this.options.waitMs)
        : await this.repository.succeed(claim, result.outcome, result.reason);
    if (!saved) {
      this.logClaimLost(claim);
    }
  }

  /**
   * Un fallo se decide con D4: esperar si el proyecto está ocupado, reintentar
   * más tarde si es temporal, o terminar. Un reclamo perdido no escribe nada, y
   * un aborto por apagado devuelve el trabajo a la cola sin gastar un intento.
   */
  private async handleFailure(
    claim: ClaimedRefresh,
    error: unknown,
    signal: AbortSignal,
  ) {
    if (error instanceof LostClaimError) {
      this.logClaimLost(claim);
      return;
    }
    if (this.loop.isStopping() && signal.aborted) {
      await this.repository.requeue(claim, 0);
      return;
    }
    await this.recover(claim, toStepError(error, claim, this.logger));
  }

  private async recover(claim: ClaimedRefresh, error: StepError) {
    const busy = classifyRefreshError(error) === 'busy';
    const attempts = busy ? claim.attempts : claim.attempts + 1;
    const decision = decideRefreshRecovery(error, attempts, this.options.retry);

    let saved: boolean;
    if (decision.status === 'queued') {
      saved = await this.repository.requeue(claim, decision.delayMs);
    } else if (decision.status === 'retry_wait') {
      saved = await this.repository.retryLater(claim, {
        attempts,
        delayMs: decision.delayMs,
        error: publicError(error.code),
        stage: error.restartAt ?? claim.stage,
        forget: error.forget,
      });
    } else {
      saved = await this.repository.fail(claim, {
        attempts,
        error: publicError(error.code),
      });
      if (saved) {
        this.logFailed(claim, error.code);
      }
    }
    if (!saved) {
      this.logClaimLost(claim);
    }
  }

  /**
   * Un fallo definitivo queda en el estado del feed (D12) y, además, en el
   * registro: solo códigos e ids, nunca la URL de la fuente ni datos del
   * catálogo (RNF05).
   */
  private logFailed(claim: ClaimedRefresh, code: ErrorCode) {
    this.logger.warn({
      code: 'FEED_REFRESH_FAILED',
      errorCode: code,
      feedId: claim.feedId,
      refreshId: claim.id,
    });
  }

  private logClaimLost(claim: ClaimedRefresh) {
    this.logger.warn({ code: 'FEED_REFRESH_CLAIM_LOST', refreshId: claim.id });
  }
}

/**
 * Traduce lo que lanzó un paso a un código público. Lo desconocido es un error
 * interno (temporal, con límite) y se registra sin datos: ni URL ni catálogo.
 */
function toStepError(
  error: unknown,
  claim: ClaimedRefresh,
  logger: Logger,
): StepError {
  if (error instanceof RefreshStepFailure) {
    return {
      code: error.detail.code,
      restartAt: error.restartAt,
      forget: error.forget,
    };
  }
  if (error instanceof RemoteSourceFailure) {
    return {
      code: error.detail.code,
      httpStatus: error.upstreamStatus,
      forget: {},
    };
  }
  if (error instanceof ApplicationFailure) {
    return { code: error.detail.code, forget: {} };
  }
  const httpCode = codeOfHttpException(error);
  if (httpCode) {
    return { code: httpCode, forget: {} };
  }
  logger.error({ code: 'FEED_REFRESH_STEP_FAILED', refreshId: claim.id });
  return { code: ErrorCodes.INTERNAL_ERROR, forget: {} };
}

/** Los servicios reutilizados (importar, evaluar) responden con `apiError`. */
function codeOfHttpException(error: unknown): ErrorCode | null {
  if (!(error instanceof HttpException)) {
    return null;
  }
  const response = error.getResponse();
  if (typeof response !== 'object' || !('code' in response)) {
    return null;
  }
  return isErrorCode(response.code) ? response.code : null;
}
