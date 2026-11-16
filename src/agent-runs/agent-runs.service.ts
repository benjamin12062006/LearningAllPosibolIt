import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { ProjectsService } from '../projects/projects.service.js';
import { WorksheetToolsService } from '../worksheet-tools/worksheet-tools.service.js';
import type { ProjectScope } from '../worksheets/worksheets.types.js';
import { AgentRunWorker } from './agent-run.worker.js';
import {
  AgentRunsRepository,
  toProposalView,
} from './agent-runs.repository.js';
import {
  AGENT_RUN_OPTIONS,
  FINISHED_STATUSES,
  type AgentRunOptions,
  type RunEvent,
  type AgentRunView,
  type ProposalView,
  type RunContext,
} from './agent-runs.types.js';
import type { StartAgentRunDto } from './agent-runs.dto.js';
import { AgentOperationCatalog } from './operations/agent-operation-catalog.js';

/**
 * Lo que hace la persona con el agente (E6.3a): iniciar una ejecución a partir
 * de su mensaje guardado, consultarla y confirmar o rechazar lo que preparó.
 */
@Injectable()
export class AgentRunsService {
  constructor(
    private readonly repository: AgentRunsRepository,
    private readonly projects: ProjectsService,
    private readonly tools: WorksheetToolsService,
    private readonly catalog: AgentOperationCatalog,
    private readonly worker: AgentRunWorker,
    @Inject(AGENT_RUN_OPTIONS)
    private readonly options: AgentRunOptions,
  ) {}

  /**
   * Pone en cola la ejecución de un mensaje (202). Pide `ai.use`: el mismo
   * permiso que escribir en la conversación. Sin agente configurado, 503.
   */
  async start(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    conversationId: string,
    input: StartAgentRunDto,
  ): Promise<AgentRunView> {
    const { actorId } = await this.projects.requireAccess(
      identity,
      scope.projectId,
      'ai.use',
    );
    const trigger = await this.repository.findTrigger(
      scope,
      actorId,
      conversationId,
      input.messageId,
    );
    if (!this.worker.enabled) {
      throw apiError(ErrorCodes.AGENT_UNAVAILABLE);
    }
    const context: RunContext = {
      workbookId: trigger.workbookId,
      worksheetId: trigger.worksheetId,
      revisionId: input.context?.revisionId ?? null,
      selectionId: await this.checkedSelection(
        identity,
        scope,
        trigger.worksheetId,
        input.context?.selectionId,
      ),
    };
    const runId = await this.repository.enqueue(
      scope,
      actorId,
      trigger,
      context,
      this.options.quota,
      this.options.clock(),
    );
    this.worker.wake();
    return this.repository.findForActor(scope, actorId, runId);
  }

  async find(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    runId: string,
  ): Promise<AgentRunView> {
    const { actorId } = await this.projects.requireAccess(
      identity,
      scope.projectId,
      'organization.read',
    );
    return this.repository.findForActor(scope, actorId, runId);
  }

  /**
   * Confirma lo que preparó el agente (plan 05, «Confirmación humana»). Se
   * ejecuta el plan guardado, nunca lo que dijo el modelo, con la identidad de
   * la persona y los servicios de siempre. Repetir la confirmación devuelve el
   * mismo resultado; el hash tiene que ser el de la propuesta que vio.
   */
  async confirm(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    runId: string,
    proposalId: string,
    proposalHash: string,
  ): Promise<ProposalView> {
    const { actorId } = await this.projects.requireAccess(
      identity,
      scope.projectId,
      'ai.use',
    );
    const proposal = await this.repository.findActorProposal(
      scope,
      actorId,
      runId,
      proposalId,
    );
    if (proposal.hash !== proposalHash) {
      throw apiError(ErrorCodes.AGENT_PROPOSAL_STALE);
    }
    if (proposal.status === 'confirmed') {
      return toProposalView(proposal);
    }
    if (proposal.status === 'rejected') {
      throw apiError(ErrorCodes.AGENT_PROPOSAL_DECIDED);
    }
    if (proposal.status === 'confirming') {
      throw apiError(ErrorCodes.AGENT_PROPOSAL_IN_PROGRESS);
    }
    // Una ejecución cancelada o vencida no publica lo que preparó (plan 05, D6).
    const run = await this.repository.findForActor(scope, actorId, runId);
    if (run.status !== 'succeeded') {
      throw apiError(ErrorCodes.AGENT_PROPOSAL_EXPIRED);
    }
    const operation = this.catalog.find(proposal.operation);
    if (operation?.level !== 'write') {
      throw apiError(ErrorCodes.AGENT_OPERATION_NOT_FOUND);
    }
    const now = this.options.clock();
    if (!(await this.repository.beginConfirm(proposal.id, proposalHash, now))) {
      // Caducó entre la lectura y el cambio de estado, o la tomó otra petición.
      const current = await this.repository.findActorProposal(
        scope,
        actorId,
        runId,
        proposalId,
      );
      throw apiError(
        current.status === 'ready'
          ? ErrorCodes.AGENT_PROPOSAL_EXPIRED
          : ErrorCodes.AGENT_PROPOSAL_IN_PROGRESS,
      );
    }
    try {
      const result = await operation.confirm(
        { identity, actorId, scope, context: run.context },
        proposal.plan,
        proposal.id,
      );
      await this.repository.completeConfirm(
        proposal.id,
        result,
        this.options.clock(),
      );
    } catch (error) {
      await this.repository.abortConfirm(proposal.id);
      throw error;
    }
    return toProposalView(
      await this.repository.findActorProposal(
        scope,
        actorId,
        runId,
        proposalId,
      ),
    );
  }

  async reject(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    runId: string,
    proposalId: string,
    proposalHash: string,
  ): Promise<ProposalView> {
    const { actorId } = await this.projects.requireAccess(
      identity,
      scope.projectId,
      'ai.use',
    );
    const proposal = await this.repository.findActorProposal(
      scope,
      actorId,
      runId,
      proposalId,
    );
    if (proposal.hash !== proposalHash) {
      throw apiError(ErrorCodes.AGENT_PROPOSAL_STALE);
    }
    if (proposal.status === 'rejected') {
      return toProposalView(proposal);
    }
    if (
      !(await this.repository.reject(
        proposal.id,
        proposalHash,
        this.options.clock(),
      ))
    ) {
      throw apiError(ErrorCodes.AGENT_PROPOSAL_DECIDED);
    }
    return toProposalView(
      await this.repository.findActorProposal(
        scope,
        actorId,
        runId,
        proposalId,
      ),
    );
  }

  /**
   * Cancela la ejecución (E6.4, D5): su credencial deja de valer en la misma
   * transacción y, si el agente está respondiendo en este proceso, se corta la
   * llamada. Lo que llegue después no se guarda.
   */
  async cancel(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    runId: string,
  ): Promise<AgentRunView> {
    const { actorId } = await this.projects.requireAccess(
      identity,
      scope.projectId,
      'ai.use',
    );
    await this.repository.cancel(scope, actorId, runId, this.options.clock());
    this.worker.abort(runId);
    return this.repository.findForActor(scope, actorId, runId);
  }

  /**
   * Los hitos de la ejecución desde `after`, para SSE (E6.4, D4). Espera a los
   * nuevos mientras la ejecución sigue abierta; `null` es un latido sin
   * novedades. Termina cuando la ejecución acabó y no quedan hitos, o al pasar
   * `maxMs`: la web reconecta con el último `id`.
   */
  async *events(
    runId: string,
    after: number,
    limits: Readonly<{ pollMs: number; maxMs: number }>,
  ): AsyncGenerator<RunEvent | null> {
    let cursor = after;
    const deadline = Date.now() + limits.maxMs;
    while (Date.now() < deadline) {
      // El estado se lee antes que los hitos: el hito final se guarda en la
      // misma transacción que el estado, así que si ya terminó, este lote
      // trae todo lo que queda.
      const status = await this.repository.statusOf(runId);
      const batch = await this.repository.eventsAfter(runId, cursor, 100);
      for (const event of batch) {
        cursor = event.sequence;
        yield event;
      }
      if (batch.length === 100) {
        continue;
      }
      if (status && FINISHED_STATUSES.includes(status)) {
        return;
      }
      yield null;
      await new Promise((resolve) => setTimeout(resolve, limits.pollMs));
    }
  }

  /** Una selección de H6 solo vale si es de esta persona y de esta hoja. */
  private async checkedSelection(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    worksheetId: string | null,
    selectionId: string | undefined,
  ): Promise<string | null> {
    if (!selectionId) {
      return null;
    }
    if (!worksheetId) {
      throw apiError(ErrorCodes.AI_SHEET_SELECTION_NOT_FOUND);
    }
    await this.tools.requireSelection(
      identity,
      scope,
      worksheetId,
      selectionId,
    );
    return selectionId;
  }
}
