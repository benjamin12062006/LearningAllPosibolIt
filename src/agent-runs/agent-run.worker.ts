import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ErrorCodes } from '../common/http/error-codes.js';
import { publicError } from '../common/http/public-error.js';
import { WorkerLoop } from '../jobs/worker-loop.js';
import {
  AI_SERVICE_CLIENT,
  AiServiceClient,
  AiServiceRejectedError,
} from '../knowledge/ai-service.client.js';
import { WorksheetToolsRepository } from '../worksheet-tools/worksheet-tools.repository.js';
import { AgentRunsRepository } from './agent-runs.repository.js';
import {
  AGENT_RUN_LIMITS,
  AGENT_RUN_OPTIONS,
  EMPTY_ANSWER,
  type AgentRunOptions,
  type RunningRun,
} from './agent-runs.types.js';
import { credentialHash, newRunCredential } from './run-credential.js';
import { AgentOperationCatalog } from './operations/agent-operation-catalog.js';

/** Tope de un mensaje guardado (`ai_messages_content_check`). */
const MAX_MESSAGE_LENGTH = 16_000;

/**
 * El worker de las ejecuciones del agente (plan 05, D2). En cada pasada cierra
 * lo vencido y atiende la cola: reclama una ejecución, le da una credencial
 * nueva, llama al agente fuera de cualquier transacción y guarda su respuesta
 * como mensaje del asistente. La credencial deja de valer al terminar.
 *
 * Sin servicio de IA configurado no arranca.
 */
@Injectable()
export class AgentRunWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AgentRunWorker.name);
  private readonly loop: WorkerLoop;
  /** Las llamadas al agente en curso en este proceso, para cancelarlas. */
  private readonly inFlight = new Map<string, AbortController>();

  constructor(
    private readonly repository: AgentRunsRepository,
    private readonly catalog: AgentOperationCatalog,
    private readonly sheetTools: WorksheetToolsRepository,
    @Inject(AI_SERVICE_CLIENT)
    private readonly client: AiServiceClient | null,
    @Inject(AGENT_RUN_OPTIONS)
    private readonly options: AgentRunOptions,
  ) {
    this.loop = new WorkerLoop(
      { ...options, autoStart: options.autoStart && client !== null },
      () => this.pass(),
      () => this.logger.error({ code: 'AGENT_RUN_PASS_FAILED' }),
    );
  }

  /** Si el agente está configurado: sin él, iniciar una ejecución es 503. */
  get enabled(): boolean {
    return this.client !== null;
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

  /** Corta la llamada al agente de una ejecución cancelada, si es de este proceso. */
  abort(runId: string) {
    this.inFlight.get(runId)?.abort();
  }

  /** Para las pruebas y el arranque manual: vacía la cola y vuelve. */
  runUntilIdle() {
    return this.loop.runUntilIdle();
  }

  private async pass(): Promise<void> {
    const now = this.options.clock();
    await this.repository.expireStale(now);
    await this.sheetTools.deleteExpired(now);
    while (!this.loop.isStopping()) {
      const credential = newRunCredential();
      const run = await this.repository.claimNext(
        credentialHash(credential),
        this.options.clock(),
      );
      if (!run) {
        return;
      }
      await this.loop.runJob((signal) => this.process(run, credential, signal));
    }
  }

  private async process(
    run: RunningRun,
    credential: string,
    signal: AbortSignal,
  ): Promise<void> {
    const client = this.client;
    if (!client) {
      await this.repository.fail(
        run,
        publicError(ErrorCodes.AGENT_UNAVAILABLE),
        this.options.clock(),
      );
      return;
    }
    const cancel = new AbortController();
    this.inFlight.set(run.id, cancel);
    try {
      const prompt = await this.repository.promptOf(run);
      const response = await client.runAgent(
        {
          runId: run.id,
          scope: {
            organizationId: run.scope.organizationId,
            projectIds: [run.scope.projectId],
          },
          credential,
          message: prompt.message,
          history: prompt.history,
          operations: this.catalog.describe(),
          context: { ...run.context },
        },
        randomUUID(),
        AGENT_RUN_LIMITS.requestTimeoutMs,
        AbortSignal.any([signal, cancel.signal]),
      );
      await this.repository.succeed(
        run,
        response.status,
        answerText(response.answer),
        this.options.clock(),
      );
    } catch (error) {
      // Un fallo del agente se queda en la ejecución con su código público; el
      // detalle (que podría llevar URLs) solo va al registro.
      this.logger.warn({
        code: 'AGENT_RUN_FAILED',
        runId: run.id,
        reason:
          error instanceof AiServiceRejectedError
            ? `${error.status} ${error.code ?? ''}`
            : error instanceof Error
              ? error.name
              : 'Error',
      });
      // Si la cancelaron, `fail` no cambia nada: el reclamo ya no es el vigente.
      await this.repository.fail(
        run,
        publicError(ErrorCodes.AGENT_RUN_FAILED),
        this.options.clock(),
      );
    } finally {
      this.inFlight.delete(run.id);
    }
  }
}

function answerText(answer: string) {
  const trimmed = answer.trim();
  return (trimmed.length > 0 ? trimmed : EMPTY_ANSWER).slice(
    0,
    MAX_MESSAGE_LENGTH,
  );
}
