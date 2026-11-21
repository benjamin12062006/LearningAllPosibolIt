import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import {
  localizeStoredError,
  type PublicError,
} from '../common/http/public-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { lockOrganization } from '../organizations/organization-lock.js';
import type { ProjectScope } from '../worksheets/worksheets.types.js';
import {
  AGENT_RUN_LIMITS,
  FINISHED_STATUSES,
  type AgentOutcome,
  type AgentRunQuota,
  type AgentRunStatus,
  type AgentRunView,
  type ProposalView,
  type RunContext,
  type RunEvent,
  type RunEventType,
  type RunningRun,
} from './agent-runs.types.js';

/** El mensaje que dispara una ejecución, en la conversación privada de su autor. */
export type RunTrigger = Readonly<{
  conversationId: string;
  workbookId: string | null;
  worksheetId: string | null;
  messageId: string;
}>;

/**
 * Lo que hizo la ejecución que respondió un mensaje (plan 10, D1): sus llamadas,
 * con los IDs que tocaron, y la propuesta con su estado y lo que creó.
 */
export type RunActivity = Readonly<{
  calls: readonly Readonly<{
    operation: string;
    status: string;
    target: unknown;
  }>[];
  proposal: Readonly<{
    operation: string;
    status: string;
    result: unknown;
    error: unknown;
  }> | null;
}>;

/** Un mensaje anterior; los del asistente llevan la actividad de su ejecución. */
export type HistoryMessage = Readonly<{
  role: 'user' | 'assistant';
  content: string;
  activity?: RunActivity;
}>;

/** Lo que el worker manda al agente además de la operación. */
export type RunPrompt = Readonly<{
  message: string;
  history: readonly HistoryMessage[];
  /** Mensajes anteriores que no caben: el agente sabe que existen. */
  omittedMessages: number;
}>;

/** Una propuesta lista para guardar (plan 05, D6). */
export type NewProposal = Readonly<{
  operation: string;
  plan: Record<string, unknown>;
  target: Record<string, unknown> | null;
  summary: string;
  hash: string;
}>;

/** La propuesta con lo que necesita su confirmación; `error` como se guardó. */
export type StoredProposal = Omit<ProposalView, 'error'> &
  Readonly<{
    runId: string | null;
    plan: Record<string, unknown>;
    error: unknown;
  }>;

type HistoryRow = Readonly<{
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sequence: number;
}>;

type ActivityCallRow = Readonly<{
  messageId: string;
  operation: string;
  status: string;
  target: unknown;
}>;

type ActivityProposalRow = Readonly<{
  messageId: string;
  operation: string;
  status: string;
  result: unknown;
  error: unknown;
}>;

type RunRow = Readonly<{
  id: string;
  conversationId: string;
  userMessageId: string;
  status: AgentRunStatus;
  outcome: AgentOutcome | null;
  context: RunContext;
  answerMessageId: string | null;
  answer: string | null;
  error: unknown;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}>;

const RUN_COLUMNS = Prisma.sql`
  r.id,
  r.conversation_id AS "conversationId",
  r.user_message_id AS "userMessageId",
  r.status,
  r.outcome,
  r.context,
  r.answer_message_id AS "answerMessageId",
  a.content AS answer,
  r.error,
  r.created_at AS "createdAt",
  r.started_at AS "startedAt",
  r.finished_at AS "finishedAt"`;

export const PROPOSAL_COLUMNS = Prisma.sql`
  p.id,
  p.run_id AS "runId",
  p.operation,
  p.plan,
  p.target,
  p.summary,
  p.hash,
  p.status,
  p.result,
  p.error,
  p.expires_at AS "expiresAt",
  p.created_at AS "createdAt",
  p.decided_at AS "decidedAt"`;

/**
 * Persistencia de las ejecuciones del agente (E6.3a). La tabla es la cola
 * durable: una ejecución pasa de `queued` a `running` al reclamarla y de ahí a
 * un estado final, siempre con el reclamo vigente (plan 05, D2).
 */
@Injectable()
export class AgentRunsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * El mensaje de la persona en su conversación privada. Una conversación
   * ajena o inexistente responde como inexistente (404) antes de mirar el
   * mensaje.
   */
  async findTrigger(
    scope: ProjectScope,
    actorId: string,
    conversationId: string,
    messageId: string,
  ): Promise<RunTrigger> {
    const conversations = await this.prisma.$queryRaw<
      Pick<RunTrigger, 'workbookId' | 'worksheetId'>[]
    >`
      SELECT c.workbook_id AS "workbookId", c.worksheet_id AS "worksheetId"
      FROM estadistica_forms.ai_conversations c
      WHERE c.id = ${conversationId}
        AND c.organization_id = ${scope.organizationId}
        AND c.project_id = ${scope.projectId}
        AND c.created_by = ${actorId}`;
    const conversation = conversations[0];
    if (!conversation) {
      throw apiError(ErrorCodes.CONVERSATION_NOT_FOUND);
    }
    const messages = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT m.id FROM estadistica_forms.ai_messages m
      WHERE m.id = ${messageId}
        AND m.conversation_id = ${conversationId}
        AND m.role = 'user'
        AND m.author_id = ${actorId}`;
    if (!messages[0]) {
      throw apiError(ErrorCodes.AGENT_MESSAGE_NOT_FOUND);
    }
    return { conversationId, messageId, ...conversation };
  }

  /**
   * Pone en cola la ejecución de un mensaje. El mismo mensaje con el mismo
   * contexto devuelve la misma ejecución; con otro contexto, 409. Otra
   * ejecución activa en la conversación, 409 (plan 05, D1).
   */
  async enqueue(
    scope: ProjectScope,
    actorId: string,
    trigger: RunTrigger,
    context: RunContext,
    quota: AgentRunQuota,
    now: Date,
  ): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      await lockOrganization(tx, scope.organizationId);
      const existing = await tx.$queryRaw<
        { id: string; context: RunContext }[]
      >`
        SELECT id, context FROM estadistica_forms.ai_runs
        WHERE conversation_id = ${trigger.conversationId}
          AND user_message_id = ${trigger.messageId}`;
      if (existing[0]) {
        if (!sameContext(existing[0].context, context)) {
          throw apiError(ErrorCodes.AGENT_RUN_CONTEXT_CHANGED);
        }
        return existing[0].id;
      }
      const active = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM estadistica_forms.ai_runs
        WHERE conversation_id = ${trigger.conversationId}
          AND status IN ('queued', 'running')`;
      if (active[0]) {
        throw apiError(ErrorCodes.AGENT_RUN_ACTIVE);
      }
      await assertWithinQuota(tx, actorId, quota, now);
      const id = randomUUID();
      const deadline = new Date(
        now.getTime() + AGENT_RUN_LIMITS.queueTimeoutMs,
      );
      await tx.$executeRaw`
        INSERT INTO estadistica_forms.ai_runs
          (id, organization_id, project_id, conversation_id, user_message_id,
           actor_id, context, status, deadline_at, created_at)
        VALUES (
          ${id}, ${scope.organizationId}, ${scope.projectId},
          ${trigger.conversationId}, ${trigger.messageId}, ${actorId},
          ${JSON.stringify(context)}::jsonb, 'queued', ${deadline.toISOString()},
          ${now.toISOString()}
        )`;
      await appendEvent(
        tx,
        id,
        'run.queued',
        {
          conversationId: trigger.conversationId,
          userMessageId: trigger.messageId,
        },
        now,
      );
      return id;
    });
  }

  /** La ejecución y su propuesta, solo para su autor (lo ajeno, 404). */
  async latestForConversation(
    scope: ProjectScope,
    actorId: string,
    conversationId: string,
  ) {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT r.id
      FROM estadistica_forms.ai_runs r
      WHERE r.conversation_id = ${conversationId}
        AND r.organization_id = ${scope.organizationId}
        AND r.project_id = ${scope.projectId}
        AND r.actor_id = ${actorId}
      ORDER BY (r.status IN ('queued', 'running')) DESC, r.created_at DESC, r.id DESC
      LIMIT 1`;
    const latest = rows[0];
    return latest ? this.findForActor(scope, actorId, latest.id) : null;
  }

  async findForActor(
    scope: ProjectScope,
    actorId: string,
    runId: string,
  ): Promise<AgentRunView> {
    const rows = await this.prisma.$queryRaw<RunRow[]>`
      SELECT ${RUN_COLUMNS}
      FROM estadistica_forms.ai_runs r
      LEFT JOIN estadistica_forms.ai_messages a ON a.id = r.answer_message_id
      WHERE r.id = ${runId}
        AND r.organization_id = ${scope.organizationId}
        AND r.project_id = ${scope.projectId}
        AND r.actor_id = ${actorId}`;
    const run = rows[0];
    if (!run) {
      throw apiError(ErrorCodes.AGENT_RUN_NOT_FOUND);
    }
    const proposals = await this.prisma.$queryRaw<StoredProposal[]>`
      SELECT ${PROPOSAL_COLUMNS} FROM estadistica_forms.ai_proposals p
      WHERE p.run_id = ${runId}`;
    return toRunView(run, proposals[0] ?? null);
  }

  /**
   * Cierra lo que ya no puede terminar: ejecuciones con el reclamo vencido y
   * colas sin atender pasado su plazo. Su credencial deja de valer.
   */
  async expireStale(now: Date): Promise<number> {
    const at = now.toISOString();
    const error = JSON.stringify({ code: ErrorCodes.AGENT_RUN_FAILED });
    return this.prisma.$transaction(async (tx) => {
      const expired = await tx.$queryRaw<{ id: string }[]>`
        UPDATE estadistica_forms.ai_runs
        SET status = 'expired', credential_hash = NULL, claim_token = NULL,
            lease_until = NULL, finished_at = ${at}, error = ${error}::jsonb
        WHERE (status = 'running' AND lease_until <= ${at})
           OR (status = 'queued' AND deadline_at <= ${at})
        RETURNING id`;
      for (const { id } of expired) {
        // Para la web, vencer es una forma de fallar: un solo evento.
        await appendEvent(
          tx,
          id,
          'run.failed',
          { status: 'expired', code: ErrorCodes.AGENT_RUN_FAILED },
          now,
        );
      }
      return expired.length;
    });
  }

  /**
   * Reclama la ejecución en cola más antigua y le da una credencial nueva.
   * Devuelve `null` si no hay ninguna.
   */
  async claimNext(
    credentialHash: string,
    now: Date,
  ): Promise<RunningRun | null> {
    const claimToken = randomUUID();
    const leaseUntil = new Date(now.getTime() + AGENT_RUN_LIMITS.leaseMs);
    const rows = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<{ id: string }[]>`
      UPDATE estadistica_forms.ai_runs
      SET status = 'running', claim_token = ${claimToken},
          credential_hash = ${credentialHash},
          lease_until = ${leaseUntil.toISOString()},
          started_at = ${now.toISOString()}
      WHERE id = (
        SELECT id FROM estadistica_forms.ai_runs
        WHERE status = 'queued' AND deadline_at > ${now.toISOString()}
        ORDER BY created_at, id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;
      if (claimed[0]) {
        await appendEvent(tx, claimed[0].id, 'run.started', {}, now);
      }
      return claimed;
    });
    const id = rows[0]?.id;
    return id ? this.findRunning(id, claimToken) : null;
  }

  /**
   * La ejecución que corresponde a una credencial: tiene que estar en curso,
   * con el reclamo sin vencer y la misma huella (plan 05, D3).
   */
  async authenticate(
    runId: string,
    presentedHash: string,
    now: Date,
  ): Promise<RunningRun | null> {
    const rows = await this.prisma.$queryRaw<{ claimToken: string }[]>`
      SELECT claim_token AS "claimToken" FROM estadistica_forms.ai_runs
      WHERE id = ${runId}
        AND status = 'running'
        AND credential_hash = ${presentedHash}
        AND lease_until > ${now.toISOString()}`;
    const claimToken = rows[0]?.claimToken;
    return claimToken ? this.findRunning(runId, claimToken) : null;
  }

  /**
   * El mensaje que disparó la ejecución y el historial anterior, acotado. Cada
   * respuesta del asistente lleva lo que hizo su ejecución: así el agente
   * recuerda los IDs que encontró y si la persona confirmó (plan 10, D1).
   */
  async promptOf(run: RunningRun, now: Date): Promise<RunPrompt> {
    const [trigger, ...newestFirst] = await this.recentMessages(run);
    const previous = newestFirst.reverse();
    const activities = await this.activitiesOf(
      previous.filter(isAssistantMessage).map((message) => message.id),
      now,
    );
    const history = boundedHistory(
      previous.map((message) => withActivity(message, activities)),
    );
    const earlier = await this.countEarlierMessages(run, trigger.sequence);
    return {
      message: trigger.content,
      history,
      omittedMessages: earlier - history.length,
    };
  }

  /** El mensaje que disparó la ejecución y los anteriores, del más nuevo al más viejo. */
  private recentMessages(run: RunningRun) {
    return this.prisma.$queryRaw<HistoryRow[]>`
      SELECT
        m.id,
        m.role,
        m.content,
        m.sequence
      FROM estadistica_forms.ai_messages m
      JOIN estadistica_forms.ai_messages t
        ON t.id = ${run.userMessageId} AND t.conversation_id = m.conversation_id
      WHERE m.conversation_id = ${run.conversationId}
        AND m.sequence <= t.sequence
      ORDER BY m.sequence DESC
      LIMIT ${AGENT_RUN_LIMITS.historyMessages + 1}`;
  }

  private async countEarlierMessages(run: RunningRun, sequence: number) {
    const rows = await this.prisma.$queryRaw<{ total: number }[]>`
      SELECT count(*)::int AS total
      FROM estadistica_forms.ai_messages
      WHERE conversation_id = ${run.conversationId}
        AND sequence < ${sequence}`;
    return rows[0]?.total ?? 0;
  }

  /**
   * La actividad de las ejecuciones que respondieron estos mensajes. Una
   * propuesta lista que ya venció se cuenta como `expired`: el agente no debe
   * esperar que la confirmen.
   */
  private async activitiesOf(
    answerMessageIds: readonly string[],
    now: Date,
  ): Promise<Map<string, RunActivity>> {
    const activities = new Map<string, RunActivity>();
    if (answerMessageIds.length === 0) {
      return activities;
    }
    const answers = Prisma.join(answerMessageIds);
    const calls = await this.prisma.$queryRaw<ActivityCallRow[]>`
      SELECT
        r.answer_message_id AS "messageId",
        c.operation,
        c.status,
        c.target
      FROM estadistica_forms.ai_runs r
      JOIN estadistica_forms.ai_run_calls c ON c.run_id = r.id
      WHERE r.answer_message_id IN (${answers})
      ORDER BY c.created_at, c.call_id`;
    const proposals = await this.prisma.$queryRaw<ActivityProposalRow[]>`
      SELECT
        r.answer_message_id AS "messageId",
        p.operation,
        CASE
          WHEN p.status = 'ready' AND p.expires_at <= ${now.toISOString()}
            THEN 'expired'
          ELSE p.status
        END AS status,
        p.result,
        p.error
      FROM estadistica_forms.ai_runs r
      JOIN estadistica_forms.ai_proposals p ON p.run_id = r.id
      WHERE r.answer_message_id IN (${answers})`;

    for (const { messageId, ...call } of calls) {
      const activity = activities.get(messageId) ?? emptyActivity();
      activities.set(messageId, {
        ...activity,
        calls: [...activity.calls, call],
      });
    }
    for (const { messageId, ...proposal } of proposals) {
      const activity = activities.get(messageId) ?? emptyActivity();
      activities.set(messageId, { ...activity, proposal });
    }
    return activities;
  }

  /**
   * Guarda la respuesta como mensaje del asistente y cierra la ejecución, en
   * una transacción y solo con el reclamo vigente (D2).
   */
  async succeed(
    run: RunningRun,
    outcome: AgentOutcome,
    answer: string,
    now: Date,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await lockOrganization(tx, run.scope.organizationId);
      if (!(await holdsClaim(tx, run, now))) {
        return false;
      }
      const messageId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO estadistica_forms.ai_messages
          (id, conversation_id, author_id, client_message_id, role, content,
           sequence, created_at)
        SELECT ${messageId}, ${run.conversationId}, NULL, NULL, 'assistant',
               ${answer}, coalesce(max(sequence), 0) + 1, ${now.toISOString()}
        FROM estadistica_forms.ai_messages
        WHERE conversation_id = ${run.conversationId}`;
      await tx.$executeRaw`
        UPDATE estadistica_forms.ai_runs
        SET status = 'succeeded', outcome = ${outcome},
            answer_message_id = ${messageId}, credential_hash = NULL,
            claim_token = NULL, lease_until = NULL,
            finished_at = ${now.toISOString()}
        WHERE id = ${run.id}`;
      await appendEvent(
        tx,
        run.id,
        'run.completed',
        { outcome, answerMessageId: messageId },
        now,
      );
      return true;
    });
  }

  /** Cierra la ejecución con un error público; la credencial deja de valer. */
  async fail(run: RunningRun, error: PublicError, now: Date): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.$executeRaw`
        UPDATE estadistica_forms.ai_runs
        SET status = 'failed',
            error = ${JSON.stringify({ code: error.code })}::jsonb,
            credential_hash = NULL, claim_token = NULL, lease_until = NULL,
            finished_at = ${now.toISOString()}
        WHERE id = ${run.id} AND status = 'running'
          AND claim_token = ${run.claimToken}`;
      if (changed > 0) {
        await appendEvent(
          tx,
          run.id,
          'run.failed',
          { status: 'failed', code: error.code },
          now,
        );
      }
      return changed > 0;
    });
  }

  /**
   * Cancela una ejecución de la persona (E6.4, D5): en cola o en curso pasa a
   * `cancelled` y su credencial deja de valer en la misma transacción. Una ya
   * cancelada se devuelve igual; una terminada de otro modo, 409.
   */
  async cancel(
    scope: ProjectScope,
    actorId: string,
    runId: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockOrganization(tx, scope.organizationId);
      const rows = await tx.$queryRaw<{ status: AgentRunStatus }[]>`
        SELECT status FROM estadistica_forms.ai_runs
        WHERE id = ${runId}
          AND organization_id = ${scope.organizationId}
          AND project_id = ${scope.projectId}
          AND actor_id = ${actorId}
        FOR UPDATE`;
      const status = rows[0]?.status;
      if (!status) {
        throw apiError(ErrorCodes.AGENT_RUN_NOT_FOUND);
      }
      if (status === 'cancelled') {
        return;
      }
      if (FINISHED_STATUSES.includes(status)) {
        throw apiError(ErrorCodes.AGENT_RUN_FINISHED);
      }
      await tx.$executeRaw`
        UPDATE estadistica_forms.ai_runs
        SET status = 'cancelled', credential_hash = NULL, claim_token = NULL,
            lease_until = NULL, finished_at = ${now.toISOString()}
        WHERE id = ${runId}`;
      await appendEvent(tx, runId, 'run.cancelled', {}, now);
    });
  }

  /** Un hito fuera de otra transacción (los de la pasarela). */
  async recordEvent(
    runId: string,
    type: RunEventType,
    payload: Record<string, unknown>,
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction((tx) =>
      appendEvent(tx, runId, type, payload, now),
    );
  }

  /** Los hitos después de una secuencia, en orden y acotados. */
  async eventsAfter(
    runId: string,
    after: number,
    limit: number,
  ): Promise<RunEvent[]> {
    return this.prisma.$queryRaw<RunEvent[]>`
      SELECT sequence, type, payload, created_at AS "createdAt"
      FROM estadistica_forms.ai_run_events
      WHERE run_id = ${runId} AND sequence > ${after}
      ORDER BY sequence
      LIMIT ${limit}`;
  }

  async statusOf(runId: string): Promise<AgentRunStatus | null> {
    const rows = await this.prisma.$queryRaw<{ status: AgentRunStatus }[]>`
      SELECT status FROM estadistica_forms.ai_runs WHERE id = ${runId}`;
    return rows[0]?.status ?? null;
  }

  /**
   * Registra una llamada de la pasarela. Repetir el mismo `callId` con los
   * mismos argumentos devuelve `repeated`; con otros, 409. Pasado el límite de
   * llamadas, 409 (D7).
   */
  async recordCall(
    run: RunningRun,
    call: Readonly<{
      callId: string;
      operation: string;
      mode: 'execute' | 'prepare';
      argumentsHash: string;
    }>,
    now: Date,
  ): Promise<'new' | 'repeated'> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM estadistica_forms.ai_runs WHERE id = ${run.id} FOR UPDATE`;
      const previous = await tx.$queryRaw<
        { operation: string; mode: string; argumentsHash: string }[]
      >`
        SELECT operation, mode, arguments_hash AS "argumentsHash"
        FROM estadistica_forms.ai_run_calls
        WHERE run_id = ${run.id} AND call_id = ${call.callId}`;
      if (previous[0]) {
        const same =
          previous[0].operation === call.operation &&
          previous[0].mode === call.mode &&
          previous[0].argumentsHash === call.argumentsHash;
        if (!same) {
          throw apiError(ErrorCodes.IDEMPOTENCY_KEY_REUSED);
        }
        return 'repeated';
      }
      const counted = await tx.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS total FROM estadistica_forms.ai_run_calls
        WHERE run_id = ${run.id}`;
      if ((counted[0]?.total ?? 0) >= AGENT_RUN_LIMITS.calls) {
        throw apiError(ErrorCodes.AGENT_RUN_CALL_LIMIT);
      }
      await tx.$executeRaw`
        INSERT INTO estadistica_forms.ai_run_calls
          (run_id, call_id, operation, mode, arguments_hash, status, created_at)
        VALUES (${run.id}, ${call.callId}, ${call.operation}, ${call.mode},
                ${call.argumentsHash}, 'succeeded', ${now.toISOString()})`;
      return 'new';
    });
  }

  /** Lo que tocó una llamada (E6.4) y si terminó bien. */
  async finishCall(
    runId: string,
    callId: string,
    status: 'succeeded' | 'failed',
    target: Record<string, unknown> | null,
  ): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE estadistica_forms.ai_run_calls
      SET status = ${status},
          target = ${target === null ? null : JSON.stringify(target)}::jsonb
      WHERE run_id = ${runId} AND call_id = ${callId}`;
  }

  /** La propuesta ya preparada por esta ejecución, si la hay. */
  async findRunProposal(runId: string): Promise<StoredProposal | null> {
    const rows = await this.prisma.$queryRaw<StoredProposal[]>`
      SELECT ${PROPOSAL_COLUMNS} FROM estadistica_forms.ai_proposals p
      WHERE p.run_id = ${runId}`;
    return rows[0] ?? null;
  }

  /** Una propuesta por ejecución: la segunda, 409 (D6). */
  async insertRunProposal(
    run: RunningRun,
    proposal: NewProposal,
    now: Date,
  ): Promise<StoredProposal> {
    const id = randomUUID();
    const expiresAt = new Date(
      now.getTime() + AGENT_RUN_LIMITS.proposalTtlMs,
    ).toISOString();
    await this.prisma.$transaction(async (tx) => {
      // La fila de la ejecución ordena dos preparaciones que llegan a la vez.
      await tx.$queryRaw`
        SELECT id FROM estadistica_forms.ai_runs WHERE id = ${run.id} FOR UPDATE`;
      const existing = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM estadistica_forms.ai_proposals WHERE run_id = ${run.id}`;
      if (existing[0]) {
        throw apiError(ErrorCodes.AGENT_PROPOSAL_EXISTS);
      }
      await tx.$executeRaw`
        INSERT INTO estadistica_forms.ai_proposals
          (id, organization_id, project_id, actor_id, run_id, operation, plan,
           target, summary, hash, status, expires_at, created_at)
        VALUES (
          ${id}, ${run.scope.organizationId}, ${run.scope.projectId},
          ${run.actorId}, ${run.id}, ${proposal.operation},
          ${JSON.stringify(proposal.plan)}::jsonb,
          ${proposal.target === null ? null : JSON.stringify(proposal.target)}::jsonb,
          ${proposal.summary}, ${proposal.hash}, 'ready', ${expiresAt},
          ${now.toISOString()}
        )`;
      await appendEvent(
        tx,
        run.id,
        'proposal.ready',
        {
          proposalId: id,
          operation: proposal.operation,
          summary: proposal.summary,
          hash: proposal.hash,
          target: proposal.target,
        },
        now,
      );
    });
    const stored = await this.findRunProposal(run.id);
    if (!stored) {
      throw apiError(ErrorCodes.INTERNAL_ERROR);
    }
    return stored;
  }

  /** La propuesta de una ejecución de la persona (lo ajeno, 404). */
  async findActorProposal(
    scope: ProjectScope,
    actorId: string,
    runId: string,
    proposalId: string,
  ): Promise<StoredProposal> {
    const rows = await this.prisma.$queryRaw<StoredProposal[]>`
      SELECT ${PROPOSAL_COLUMNS} FROM estadistica_forms.ai_proposals p
      WHERE p.id = ${proposalId}
        AND p.run_id = ${runId}
        AND p.organization_id = ${scope.organizationId}
        AND p.project_id = ${scope.projectId}
        AND p.actor_id = ${actorId}`;
    const proposal = rows[0];
    if (!proposal) {
      throw apiError(ErrorCodes.AGENT_PROPOSAL_NOT_FOUND);
    }
    return proposal;
  }

  /**
   * Pasa una propuesta de `ready` a `confirming`: solo una confirmación a la
   * vez llega a ejecutar el efecto. Devuelve si la tomó.
   */
  async beginConfirm(
    proposalId: string,
    hash: string,
    now: Date,
    db: Pick<Prisma.TransactionClient, '$executeRaw'> = this.prisma,
  ) {
    const changed = await db.$executeRaw`
      UPDATE estadistica_forms.ai_proposals
      SET status = 'confirming'
      WHERE id = ${proposalId} AND status = 'ready' AND hash = ${hash}
        AND expires_at > ${now.toISOString()}`;
    return changed > 0;
  }

  async completeConfirm(proposalId: string, result: unknown, now: Date) {
    await this.prisma.$executeRaw`
      UPDATE estadistica_forms.ai_proposals
      SET status = 'confirmed', result = ${JSON.stringify(result)}::jsonb,
          decided_at = ${now.toISOString()}
      WHERE id = ${proposalId} AND status = 'confirming'`;
  }

  /**
   * El efecto falló con un error conocido: la propuesta queda `failed` con ese
   * error y el agente lo recibe al continuar (plan 10, D7).
   */
  async failConfirm(proposalId: string, error: PublicError, now: Date) {
    await this.prisma.$executeRaw`
      UPDATE estadistica_forms.ai_proposals
      SET status = 'failed', error = ${JSON.stringify(error)}::jsonb,
          decided_at = ${now.toISOString()}
      WHERE id = ${proposalId} AND status = 'confirming'`;
  }

  /** El efecto falló: la propuesta vuelve a estar lista para reintentar. */
  async abortConfirm(proposalId: string) {
    await this.prisma.$executeRaw`
      UPDATE estadistica_forms.ai_proposals SET status = 'ready'
      WHERE id = ${proposalId} AND status = 'confirming'`;
  }

  async reject(proposalId: string, hash: string, now: Date) {
    const changed = await this.prisma.$executeRaw`
      UPDATE estadistica_forms.ai_proposals
      SET status = 'rejected', decided_at = ${now.toISOString()}
      WHERE id = ${proposalId} AND status = 'ready' AND hash = ${hash}`;
    return changed > 0;
  }

  private async findRunning(
    runId: string,
    claimToken: string,
  ): Promise<RunningRun | null> {
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        organizationId: string;
        projectId: string;
        actorId: string;
        issuer: string;
        subject: string;
        conversationId: string;
        userMessageId: string;
        context: RunContext;
      }[]
    >`
      SELECT r.id, r.organization_id AS "organizationId",
             r.project_id AS "projectId", r.actor_id AS "actorId",
             u.identity_issuer AS issuer, u.identity_subject AS subject,
             r.conversation_id AS "conversationId",
             r.user_message_id AS "userMessageId", r.context
      FROM estadistica_forms.ai_runs r
      JOIN estadistica_forms.app_users u ON u.id = r.actor_id
      WHERE r.id = ${runId} AND r.claim_token = ${claimToken}`;
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      scope: { organizationId: row.organizationId, projectId: row.projectId },
      actorId: row.actorId,
      identity: { issuer: row.issuer, subject: row.subject },
      conversationId: row.conversationId,
      userMessageId: row.userMessageId,
      context: row.context,
      claimToken,
    };
  }
}

/**
 * Añade un hito con la secuencia siguiente. Bloquea la fila de la ejecución
 * para que dos hitos a la vez no compitan por el mismo número.
 */
async function appendEvent(
  tx: Prisma.TransactionClient,
  runId: string,
  type: RunEventType,
  payload: Record<string, unknown>,
  now: Date,
): Promise<void> {
  await tx.$queryRaw`
    SELECT id FROM estadistica_forms.ai_runs WHERE id = ${runId} FOR UPDATE`;
  await tx.$executeRaw`
    INSERT INTO estadistica_forms.ai_run_events
      (run_id, sequence, type, payload, created_at)
    SELECT ${runId}, coalesce(max(sequence), 0) + 1, ${type},
           ${JSON.stringify(payload)}::jsonb, ${now.toISOString()}
    FROM estadistica_forms.ai_run_events
    WHERE run_id = ${runId}`;
}

/** Ejecuciones activas a la vez y en las últimas 24 horas, por persona (D6). */
async function assertWithinQuota(
  tx: Prisma.TransactionClient,
  actorId: string,
  quota: AgentRunQuota,
  now: Date,
): Promise<void> {
  const since = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const rows = await tx.$queryRaw<{ active: number; recent: number }[]>`
    SELECT
      count(*) FILTER (WHERE status IN ('queued', 'running'))::int AS active,
      count(*) FILTER (WHERE created_at > ${since})::int AS recent
    FROM estadistica_forms.ai_runs
    WHERE actor_id = ${actorId}`;
  const usage = rows[0] ?? { active: 0, recent: 0 };
  if (usage.active >= quota.activeRuns || usage.recent >= quota.dailyRuns) {
    throw apiError(ErrorCodes.AGENT_QUOTA_EXCEEDED);
  }
}

async function holdsClaim(
  tx: Prisma.TransactionClient,
  run: RunningRun,
  now: Date,
) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM estadistica_forms.ai_runs
    WHERE id = ${run.id} AND status = 'running'
      AND claim_token = ${run.claimToken}
      AND lease_until > ${now.toISOString()}
    FOR UPDATE`;
  return rows.length > 0;
}

/**
 * Lo más reciente primero hasta el límite de bytes, contando la actividad;
 * luego, en orden. Exportada para probar el recorte sin cientos de ejecuciones.
 */
export function boundedHistory(messages: readonly HistoryMessage[]) {
  const kept: HistoryMessage[] = [];
  let bytes = 0;
  for (const message of [...messages].reverse()) {
    bytes += sizeOf(message);
    if (bytes > AGENT_RUN_LIMITS.historyBytes) {
      break;
    }
    kept.unshift(message);
  }
  return kept;
}

function sizeOf({ content, activity }: HistoryMessage) {
  const activityBytes = activity
    ? Buffer.byteLength(JSON.stringify(activity), 'utf8')
    : 0;
  return Buffer.byteLength(content, 'utf8') + activityBytes;
}

function isAssistantMessage(message: HistoryRow) {
  return message.role === 'assistant';
}

/** El mensaje como lo ve el agente: con su actividad, si su ejecución hizo algo. */
function withActivity(
  { id, role, content }: HistoryRow,
  activities: ReadonlyMap<string, RunActivity>,
): HistoryMessage {
  const activity = activities.get(id);
  return activity ? { role, content, activity } : { role, content };
}

function emptyActivity(): RunActivity {
  return { calls: [], proposal: null };
}

function sameContext(left: RunContext, right: RunContext) {
  return (
    left.workbookId === right.workbookId &&
    left.worksheetId === right.worksheetId &&
    left.revisionId === right.revisionId &&
    left.selectionId === right.selectionId
  );
}

function toRunView(run: RunRow, proposal: StoredProposal | null): AgentRunView {
  return {
    id: run.id,
    conversationId: run.conversationId,
    userMessageId: run.userMessageId,
    status: run.status,
    outcome: run.outcome,
    context: run.context,
    answerMessageId: run.answerMessageId,
    answer: run.answer,
    error: localizeStoredError(run.error),
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    proposal: proposal ? toProposalView(proposal) : null,
  };
}

export function toProposalView(proposal: StoredProposal): ProposalView {
  return {
    id: proposal.id,
    operation: proposal.operation,
    summary: proposal.summary,
    ...(proposal.operation === 'create_ruleset'
      ? { rulesetReview: proposal.plan.ruleset }
      : {}),
    hash: proposal.hash,
    status: proposal.status,
    target: proposal.target,
    result: proposal.result,
    error: localizeStoredError(proposal.error),
    expiresAt: proposal.expiresAt,
    createdAt: proposal.createdAt,
    decidedAt: proposal.decidedAt,
  };
}
