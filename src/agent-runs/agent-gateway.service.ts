import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import {
  AI_SERVICE_CLIENT,
  AiServiceClient,
} from '../knowledge/ai-service.client.js';
import { AgentRunsRepository } from './agent-runs.repository.js';
import {
  AGENT_RUN_LIMITS,
  AGENT_RUN_OPTIONS,
  type AgentRunOptions,
  type RunningRun,
} from './agent-runs.types.js';
import type { GatewayCallDto } from './agent-runs.dto.js';
import type {
  OperationContext,
  ReadOperation,
  WriteOperation,
} from './operations/agent-operation.js';
import { AgentOperationCatalog } from './operations/agent-operation-catalog.js';
import {
  knowledgeOperation,
  SEARCH_KNOWLEDGE,
} from './operations/knowledge-operation.js';
import { AI_AUTO_CONFIRM, confirmationIdOf } from './auto-confirm.js';
import { canonicalHash, credentialHash } from './run-credential.js';

const BEARER = /^Bearer ([A-Za-z0-9_-]{16,256})$/;

/**
 * La pasarela del agente (plan 05, D3–D7): lo único que el servicio de IA
 * puede hacer en Nest. Autentica la credencial de la ejecución, busca la
 * operación en el catálogo, valida sus argumentos como REST y llama al
 * servicio con la identidad de la persona. Las lecturas se ejecutan; las
 * escrituras dejan una propuesta para que la persona la confirme, o se
 * aplican al momento con `AI_AUTO_CONFIRM`.
 */
@Injectable()
export class AgentGatewayService {
  constructor(
    private readonly repository: AgentRunsRepository,
    private readonly catalog: AgentOperationCatalog,
    @Inject(AI_SERVICE_CLIENT)
    private readonly ai: AiServiceClient | null,
    @Inject(AGENT_RUN_OPTIONS)
    private readonly options: AgentRunOptions,
    @Inject(AI_AUTO_CONFIRM)
    private readonly autoConfirm: boolean,
  ) {}

  async call(
    runId: string,
    authorization: string | undefined,
    name: string,
    body: GatewayCallDto,
  ): Promise<unknown> {
    const run = await this.authenticate(runId, authorization);
    const operation =
      name === SEARCH_KNOWLEDGE
        ? knowledgeOperation(this.ai)
        : this.catalog.find(name);
    if (!operation) {
      throw apiError(ErrorCodes.AGENT_OPERATION_NOT_FOUND);
    }
    const expectedMode = operation.level === 'read' ? 'execute' : 'prepare';
    if (body.mode !== expectedMode) {
      throw apiError(ErrorCodes.AGENT_OPERATION_MODE_INVALID);
    }
    const input = await operation.parse(body.arguments);
    const callId = body.callId ?? randomUUID();
    const repeated = await this.repository.recordCall(
      run,
      {
        callId,
        operation: name,
        mode: body.mode,
        argumentsHash: canonicalHash(body.arguments),
      },
      this.options.clock(),
    );
    const context: OperationContext = {
      identity: run.identity,
      actorId: run.actorId,
      scope: run.scope,
      context: run.context,
    };
    const target = operation.targetOf(context, input);
    // El hito lleva qué toca la herramienta (IDs, nunca valores de celdas):
    // la web lo usa para enseñar los cambios en vivo (E6.4, D3).
    await this.repository.recordEvent(
      run.id,
      'tool.started',
      { callId, operation: name, mode: body.mode, target },
      this.options.clock(),
    );
    try {
      const result =
        operation.level === 'read'
          ? await this.execute(operation, context, input)
          : this.autoConfirm
            ? await this.applyNow(operation, run, context, input, callId)
            : await this.prepare(operation, run, context, input, repeated);
      const resultTarget =
        operation.level === 'read' && operation.resultTarget
          ? { ...target, ...operation.resultTarget(result) }
          : target;
      await this.repository.finishCall(
        run.id,
        callId,
        'succeeded',
        resultTarget,
      );
      await this.completed(run.id, callId, name, 'succeeded', resultTarget);
      return result;
    } catch (error) {
      await this.repository.finishCall(run.id, callId, 'failed', target);
      await this.completed(run.id, callId, name, 'failed', target);
      throw error;
    }
  }

  private completed(
    runId: string,
    callId: string,
    operation: string,
    status: 'succeeded' | 'failed',
    target: unknown,
  ) {
    return this.repository.recordEvent(
      runId,
      'tool.completed',
      { callId, operation, status, target },
      this.options.clock(),
    );
  }

  private async authenticate(
    runId: string,
    authorization: string | undefined,
  ): Promise<RunningRun> {
    const credential = BEARER.exec(authorization ?? '')?.[1];
    const run = credential
      ? await this.repository.authenticate(
          runId,
          credentialHash(credential),
          this.options.clock(),
        )
      : null;
    if (!run) {
      throw apiError(ErrorCodes.AGENT_CREDENTIAL_INVALID);
    }
    return run;
  }

  /** Lo que vuelve al modelo está acotado: un resultado enorme es un error. */
  private async execute(
    operation: ReadOperation,
    context: OperationContext,
    input: unknown,
  ) {
    const result = await operation.execute(context, input);
    const bytes = Buffer.byteLength(JSON.stringify(result ?? null), 'utf8');
    if (bytes > AGENT_RUN_LIMITS.readResultBytes) {
      throw apiError(ErrorCodes.AGENT_RESULT_TOO_LARGE);
    }
    return result ?? null;
  }

  /**
   * Con la confirmación automática, la escritura se aplica en la llamada con
   * el `confirm` de siempre: la persona ya no la confirma, pero sus permisos y
   * las reglas del servicio siguen valiendo. No guarda propuesta, así que una
   * ejecución puede encadenar varias escrituras; la clave idempotente sale de
   * la llamada.
   */
  private async applyNow(
    operation: WriteOperation,
    run: RunningRun,
    context: OperationContext,
    input: unknown,
    callId: string,
  ) {
    const prepared = await operation.prepare(context, input);
    const result = await operation.confirm(
      context,
      prepared.plan,
      confirmationIdOf(run.id, callId),
    );
    return { status: 'confirmed', summary: prepared.summary, result };
  }

  /**
   * Una propuesta por ejecución. Repetir la misma llamada devuelve la misma
   * propuesta; una segunda distinta, 409.
   */
  private async prepare(
    operation: WriteOperation,
    run: RunningRun,
    context: OperationContext,
    input: unknown,
    repeated: 'new' | 'repeated',
  ) {
    const existing = await this.repository.findRunProposal(run.id);
    if (existing && repeated === 'repeated') {
      return {
        proposalId: existing.id,
        summary: existing.summary,
        expiresAt: existing.expiresAt,
      };
    }
    if (existing) {
      throw apiError(ErrorCodes.AGENT_PROPOSAL_EXISTS);
    }
    const prepared = await operation.prepare(context, input);
    const proposal = await this.repository.insertRunProposal(
      run,
      {
        operation: operation.name,
        plan: prepared.plan,
        target: prepared.target,
        summary: prepared.summary.slice(0, 2000),
        hash: canonicalHash({
          operation: operation.name,
          plan: prepared.plan,
        }),
      },
      this.options.clock(),
    );
    return {
      proposalId: proposal.id,
      summary: proposal.summary,
      expiresAt: proposal.expiresAt,
    };
  }
}
