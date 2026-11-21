import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { CatalogImportService } from '../catalog-import/catalog-import.service.js';
import { apiError, rejectionOf } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import type { PublicError } from '../common/http/public-error.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { EvaluationsService } from '../evaluations/evaluations.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { RulesetsService } from '../rulesets/rulesets.service.js';
import { WorksheetToolsService } from '../worksheet-tools/worksheet-tools.service.js';
import { WorksheetRowsRepository } from '../worksheets/worksheet-rows.repository.js';
import { WorksheetsRepository } from '../worksheets/worksheets.repository.js';
import type { ProjectScope } from '../worksheets/worksheets.types.js';
import { AgentRunWorker } from './agent-run.worker.js';
import {
  AgentRunsRepository,
  type RunTrigger,
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
import type { RunContextDto, StartAgentRunDto } from './agent-runs.dto.js';
import { confirmationIdOf } from './auto-confirm.js';
import { ProposalDecisions } from './proposal-decisions.js';

/**
 * Lo que responde confirmar desde el chat (plan 10, D7): la propuesta y la
 * ejecución que continúa la tarea, o por qué no pudo continuar.
 */
export type ConfirmedProposal = Readonly<{
  proposal: ProposalView;
  continuation: AgentRunView | null;
  continuationError: PublicError | null;
}>;

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
    private readonly worksheets: WorksheetsRepository,
    private readonly worksheetRows: WorksheetRowsRepository,
    private readonly catalog: CatalogImportService,
    private readonly evaluations: EvaluationsService,
    private readonly rulesets: RulesetsService,
    private readonly decisions: ProposalDecisions,
    private readonly conversations: ConversationsService,
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
    const context = await this.resolveContext(
      identity,
      scope,
      actorId,
      trigger,
      input.context,
    );
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

  async latest(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    conversationId: string,
  ) {
    const { actorId } = await this.projects.requireAccess(
      identity,
      scope.projectId,
      'organization.read',
    );
    return this.repository.latestForConversation(
      scope,
      actorId,
      conversationId,
    );
  }

  /**
   * Confirma lo que preparó el agente y deja que siga solo (plan 10, D7): la
   * persona queda como autora del mensaje «Confirmé: …» y una ejecución nueva
   * continúa la tarea. Si el efecto falla con un error conocido, la propuesta
   * queda `failed` y la continuación recibe el motivo. Una ejecución cancelada
   * o vencida no publica lo que preparó (plan 05, D6).
   */
  async confirm(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    runId: string,
    proposalId: string,
    proposalHash: string,
  ): Promise<ConfirmedProposal> {
    const { actorId } = await this.projects.requireAccess(
      identity,
      scope.projectId,
      'ai.use',
    );
    const load = () =>
      this.repository.findActorProposal(scope, actorId, runId, proposalId);
    await load();
    const run = await this.repository.findForActor(scope, actorId, runId);
    const proposal = await this.decisions.confirm(
      { identity, actorId, scope, context: run.context },
      load,
      proposalHash,
      (proposal) => {
        if (run.status !== 'succeeded') {
          throw apiError(ErrorCodes.AGENT_PROPOSAL_EXPIRED);
        }
        return this.repository.beginConfirm(
          proposal.id,
          proposal.hash,
          this.options.clock(),
        );
      },
      'record',
    );
    return {
      proposal,
      ...(await this.continueAfter(identity, scope, actorId, run, proposal)),
    };
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
    return this.decisions.reject(
      () =>
        this.repository.findActorProposal(scope, actorId, runId, proposalId),
      proposalHash,
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

  /**
   * Guarda el mensaje de la persona sobre su decisión y pone en cola la
   * ejecución que sigue. Es idempotente: el mensaje tiene un ID estable por
   * propuesta y la ejecución, una por mensaje. Si la cuota, otra ejecución
   * activa o una hoja archivada lo impiden, la confirmación vale igual.
   */
  private async continueAfter(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    actorId: string,
    run: AgentRunView,
    proposal: ProposalView,
  ): Promise<Omit<ConfirmedProposal, 'proposal'>> {
    if (!this.worker.enabled) {
      return { continuation: null, continuationError: null };
    }
    try {
      const message = await this.conversations.appendMessage(
        identity,
        scope,
        run.conversationId,
        {
          clientMessageId: confirmationIdOf(proposal.id, 'continuation'),
          content: continuationText(proposal, run.context.language),
        },
      );
      const trigger = await this.repository.findTrigger(
        scope,
        actorId,
        run.conversationId,
        message.id,
      );
      const runId = await this.repository.enqueue(
        scope,
        actorId,
        trigger,
        run.context,
        this.options.quota,
        this.options.clock(),
      );
      this.worker.wake();
      const continuation = await this.repository.findForActor(
        scope,
        actorId,
        runId,
      );
      return { continuation, continuationError: null };
    } catch (error) {
      // Cuota, otra ejecución activa u hoja archivada: la confirmación vale igual.
      const rejection = rejectionOf(error);
      if (!rejection) {
        throw error;
      }
      return { continuation: null, continuationError: rejection };
    }
  }

  private async resolveContext(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    actorId: string,
    trigger: RunTrigger,
    input?: RunContextDto,
  ): Promise<RunContext> {
    // Los clientes anteriores siguen usando el recurso original de su conversación.
    const followsWorkspace = Boolean(
      input?.section || input?.worksheetId || input?.workbookId,
    );
    const worksheetId =
      input?.worksheetId ?? (followsWorkspace ? null : trigger.worksheetId);
    let workbookId =
      input?.workbookId ?? (followsWorkspace ? null : trigger.workbookId);
    const revisionId = input?.revisionId ?? null;
    if (worksheetId && followsWorkspace) {
      const worksheet = await this.worksheets.findWorksheet(
        actorId,
        scope,
        worksheetId,
      );
      if (!worksheet || (workbookId && workbookId !== worksheet.workbookId)) {
        throw apiError(ErrorCodes.WORKSHEET_NOT_FOUND);
      }
      workbookId = worksheet.workbookId;
    } else if (workbookId && followsWorkspace) {
      if (!(await this.worksheets.workbookExists(actorId, scope, workbookId))) {
        throw apiError(ErrorCodes.WORKBOOK_NOT_FOUND);
      }
    }
    if (
      followsWorkspace &&
      revisionId &&
      (!worksheetId ||
        !(await this.worksheetRows.findRevision(
          actorId,
          scope,
          worksheetId,
          revisionId,
        )))
    ) {
      throw apiError(ErrorCodes.WORKSHEET_REVISION_NOT_FOUND);
    }
    const selectionId = await this.checkedSelection(
      identity,
      scope,
      worksheetId,
      input?.selectionId,
    );
    if (input?.catalogSnapshotId)
      await this.catalog.findSnapshot(
        identity,
        scope.projectId,
        input.catalogSnapshotId,
      );
    if (input?.evaluationId)
      await this.evaluations.findSummary(
        identity,
        scope.projectId,
        input.evaluationId,
      );
    if (input?.rulesetRevision)
      await this.rulesets.findRevision(
        identity,
        scope.projectId,
        input.rulesetRevision,
      );
    return {
      ...(input?.language ? { language: input.language } : {}),
      ...(input?.section ? { section: input.section } : {}),
      ...(input?.catalogSnapshotId
        ? { catalogSnapshotId: input.catalogSnapshotId }
        : {}),
      ...(input?.evaluationId ? { evaluationId: input.evaluationId } : {}),
      ...(input?.rulesetRevision
        ? { rulesetRevision: input.rulesetRevision }
        : {}),
      workbookId,
      worksheetId,
      revisionId,
      selectionId,
    };
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

/**
 * El mensaje que la persona deja al decidir: lo ve en el chat y es lo que lee
 * el agente al continuar. El resultado con sus IDs le llega en la actividad.
 */
function continuationText(proposal: ProposalView, language?: 'en' | 'es') {
  const english = language === 'en';
  if (proposal.status === 'failed' && proposal.error) {
    const { code, message } = proposal.error;
    return english
      ? `It could not be applied: ${proposal.summary} Reason (${code}): ${message.en}`
      : `No se pudo aplicar: ${proposal.summary} Motivo (${code}): ${message.es}`;
  }
  return english
    ? `I confirmed: ${proposal.summary}`
    : `Confirmé: ${proposal.summary}`;
}
