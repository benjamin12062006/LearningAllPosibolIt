import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { lockOrganization } from '../organizations/organization-lock.js';
import {
  assertProjectPermission,
  isProjectMember,
  joinProjectAccess,
  PROJECT_ACCESS_COLUMNS,
  type ProjectMemberAccess,
} from '../projects/project-access.js';
import type { ProjectScope } from '../worksheets/worksheets.types.js';

export type Conversation = Readonly<
  ProjectScope & {
    id: string;
    workbookId: string;
    worksheetId: string | null;
    createdBy: string;
    title: string;
    visibility: 'private';
    status: 'active';
    createdAt: string;
    updatedAt: string;
  }
>;

export type ConversationMessage = Readonly<{
  id: string;
  conversationId: string;
  authorId: string | null;
  clientMessageId: string | null;
  role: 'user' | 'assistant';
  content: string;
  sequence: number;
  createdAt: string;
}>;

type ConversationTarget = Readonly<{
  kind: 'workbook' | 'worksheet';
  id: string;
}>;
type ListFilters = Readonly<{ workbookId?: string; worksheetId?: string }>;
type ListWindow = ListFilters &
  Readonly<{
    limit: number;
    after?: Readonly<{ createdAt: string; id: string }>;
  }>;
type MessageInput = Readonly<{ clientMessageId: string; content: string }>;

const CONVERSATION_FIELDS = Prisma.sql`
  id, organization_id AS "organizationId", project_id AS "projectId",
  workbook_id AS "workbookId", worksheet_id AS "worksheetId",
  created_by AS "createdBy", title, visibility, status,
  created_at AS "createdAt", updated_at AS "updatedAt"
`;

const MESSAGE_FIELDS = Prisma.sql`
  id, conversation_id AS "conversationId", author_id AS "authorId",
  client_message_id AS "clientMessageId", role, content, sequence,
  created_at AS "createdAt"
`;

@Injectable()
export class ConversationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    actorId: string,
    scope: ProjectScope,
    target: ConversationTarget,
    title: string,
  ): Promise<Conversation> {
    return this.prisma.$transaction(async (tx) => {
      await lockOrganization(tx, scope.organizationId);
      const access = await requireProjectAccess(tx, actorId, scope);
      const resource = await requireTarget(tx, scope, target);
      assertProjectPermission(access, 'ai.use');
      assertTargetActive(resource, target.kind);
      const now = new Date().toISOString();
      const [created] = await tx.$queryRaw<Conversation[]>`
        INSERT INTO estadistica_forms.ai_conversations (
          id, organization_id, project_id, workbook_id, worksheet_id,
          created_by, title, created_at, updated_at
        ) VALUES (
          ${randomUUID()}, ${scope.organizationId}, ${scope.projectId},
          ${resource.workbookId}, ${resource.worksheetId}, ${actorId},
          ${title}, ${now}, ${now}
        ) RETURNING ${CONVERSATION_FIELDS}`;
      return created;
    });
  }

  find(actorId: string, scope: ProjectScope, id: string) {
    return findConversation(this.prisma, actorId, scope, id);
  }

  async findByProject(
    actorId: string,
    scope: ProjectScope,
    window: ListWindow,
  ) {
    await this.assertListScope(actorId, scope, window);
    const { workbookId, worksheetId, after, limit } = window;
    const book = workbookId
      ? Prisma.sql`AND c.workbook_id = ${workbookId}`
      : Prisma.empty;
    const sheet = worksheetId
      ? Prisma.sql`AND c.worksheet_id = ${worksheetId}`
      : Prisma.empty;
    const cursor = after
      ? Prisma.sql`AND (c.created_at, c.id) < (${after.createdAt}, ${after.id})`
      : Prisma.empty;
    return this.prisma.$queryRaw<Conversation[]>`
      SELECT ${CONVERSATION_FIELDS}
      FROM estadistica_forms.ai_conversations c
      WHERE ${privateScope(actorId, scope)} ${book} ${sheet} ${cursor}
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ${limit}`;
  }

  async assertListScope(
    actorId: string,
    scope: ProjectScope,
    filters: ListFilters,
  ) {
    const [project] = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT p.id FROM estadistica_forms.projects p
      WHERE p.id = ${scope.projectId} AND p.organization_id = ${scope.organizationId}
        AND ${isProjectMember(actorId, Prisma.raw('p'))}`;
    if (!project) {
      throw apiError(ErrorCodes.PROJECT_NOT_FOUND);
    }
    if (filters.workbookId) {
      await requireTarget(this.prisma, scope, {
        kind: 'workbook',
        id: filters.workbookId,
      });
    }
    if (filters.worksheetId) {
      await requireTarget(this.prisma, scope, {
        kind: 'worksheet',
        id: filters.worksheetId,
      });
    }
  }

  appendMessage(
    actorId: string,
    scope: ProjectScope,
    id: string,
    input: MessageInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // El mismo bloqueo ordena cambios de membresía, archivado y escrituras de chat.
      await lockOrganization(tx, scope.organizationId);
      const conversation = await requireConversation(tx, actorId, scope, id);
      assertProjectPermission(
        await requireProjectAccess(tx, actorId, scope),
        'ai.use',
      );
      const target = targetOf(conversation);
      assertTargetActive(await requireTarget(tx, scope, target), target.kind);

      const previous = await findExistingMessage(
        tx,
        id,
        actorId,
        input.clientMessageId,
      );
      if (previous) {
        if (previous.content !== input.content) {
          throw apiError(ErrorCodes.IDEMPOTENCY_KEY_REUSED);
        }
        return previous;
      }

      const now = new Date().toISOString();
      const [created] = await tx.$queryRaw<ConversationMessage[]>`
        INSERT INTO estadistica_forms.ai_messages (
          id, conversation_id, author_id, client_message_id, role,
          content, sequence, created_at
        ) SELECT ${randomUUID()}, ${id}, ${actorId}, ${input.clientMessageId},
          'user', ${input.content}, coalesce(max(sequence), 0) + 1, ${now}
          FROM estadistica_forms.ai_messages WHERE conversation_id = ${id}
        RETURNING ${MESSAGE_FIELDS}`;
      await tx.$executeRaw`
        UPDATE estadistica_forms.ai_conversations
        SET updated_at = ${now} WHERE id = ${id}`;
      return created;
    });
  }

  async findMessages(
    actorId: string,
    scope: ProjectScope,
    id: string,
    window: Readonly<{ limit: number; before?: number }>,
  ) {
    await this.assertMessageScope(actorId, scope, id);
    const cursor =
      window.before === undefined
        ? Prisma.empty
        : Prisma.sql`AND m.sequence < ${window.before}`;
    return this.prisma.$queryRaw<ConversationMessage[]>`
      SELECT ${MESSAGE_FIELDS} FROM estadistica_forms.ai_messages m
      WHERE m.conversation_id = ${id} ${cursor}
        AND EXISTS (
          SELECT 1 FROM estadistica_forms.ai_conversations c
          WHERE c.id = m.conversation_id AND ${privateScope(actorId, scope)}
        )
      ORDER BY m.sequence DESC LIMIT ${window.limit}`;
  }

  async assertMessageScope(actorId: string, scope: ProjectScope, id: string) {
    await requireConversation(this.prisma, actorId, scope, id);
  }
}

function privateScope(actorId: string, scope: ProjectScope) {
  return Prisma.sql`
    c.organization_id = ${scope.organizationId} AND c.project_id = ${scope.projectId}
    AND c.created_by = ${actorId} AND c.visibility = 'private'
    AND ${isProjectMember(actorId, Prisma.raw('c'))}`;
}

async function requireProjectAccess(
  db: Prisma.TransactionClient,
  actorId: string,
  scope: ProjectScope,
) {
  const [access] = await db.$queryRaw<ProjectMemberAccess[]>`
    SELECT ${PROJECT_ACCESS_COLUMNS}
    FROM estadistica_forms.projects p ${joinProjectAccess(actorId)}
    WHERE p.id = ${scope.projectId} AND p.organization_id = ${scope.organizationId}`;
  if (!access) {
    throw apiError(ErrorCodes.PROJECT_NOT_FOUND);
  }
  return access;
}

async function findConversation(
  db: Prisma.TransactionClient,
  actorId: string,
  scope: ProjectScope,
  id: string,
): Promise<Conversation | null> {
  const [conversation] = await db.$queryRaw<Conversation[]>`
    SELECT ${CONVERSATION_FIELDS} FROM estadistica_forms.ai_conversations c
    WHERE c.id = ${id} AND ${privateScope(actorId, scope)}`;
  return conversation ?? null;
}

async function requireConversation(
  db: Prisma.TransactionClient,
  actorId: string,
  scope: ProjectScope,
  id: string,
) {
  const conversation = await findConversation(db, actorId, scope, id);
  if (!conversation) {
    throw apiError(ErrorCodes.CONVERSATION_NOT_FOUND);
  }
  return conversation;
}

async function findExistingMessage(
  db: Prisma.TransactionClient,
  conversationId: string,
  authorId: string,
  clientMessageId: string,
) {
  const [message] = await db.$queryRaw<ConversationMessage[]>`
    SELECT ${MESSAGE_FIELDS} FROM estadistica_forms.ai_messages
    WHERE conversation_id = ${conversationId} AND author_id = ${authorId}
      AND client_message_id = ${clientMessageId}`;
  return message;
}

type TargetRow = Readonly<{
  workbookId: string;
  worksheetId: string | null;
  archived: boolean;
}>;

async function requireTarget(
  db: Prisma.TransactionClient,
  scope: ProjectScope,
  target: ConversationTarget,
) {
  const worksheet = target.kind === 'worksheet';
  const resource = worksheet
    ? Prisma.sql`JOIN estadistica_forms.worksheets w ON w.workbook_id = b.id AND w.id = ${target.id}`
    : Prisma.empty;
  const workbookFilter = worksheet
    ? Prisma.empty
    : Prisma.sql`AND b.id = ${target.id}`;
  const worksheetId = worksheet ? Prisma.sql`w.id` : Prisma.sql`NULL`;
  const archived = worksheet
    ? Prisma.sql`b.archived_at IS NOT NULL OR w.archived_at IS NOT NULL`
    : Prisma.sql`b.archived_at IS NOT NULL`;
  const [row] = await db.$queryRaw<TargetRow[]>`
    SELECT b.id AS "workbookId", ${worksheetId} AS "worksheetId", ${archived} AS archived
    FROM estadistica_forms.workbooks b ${resource}
    WHERE b.organization_id = ${scope.organizationId}
      AND b.project_id = ${scope.projectId} ${workbookFilter}`;
  if (!row) {
    throw apiError(
      worksheet
        ? ErrorCodes.WORKSHEET_NOT_FOUND
        : ErrorCodes.WORKBOOK_NOT_FOUND,
    );
  }
  return row;
}

function targetOf(conversation: Conversation): ConversationTarget {
  if (conversation.worksheetId) {
    return { kind: 'worksheet', id: conversation.worksheetId };
  }
  return { kind: 'workbook', id: conversation.workbookId };
}

function assertTargetActive(
  resource: TargetRow,
  kind: ConversationTarget['kind'],
) {
  if (resource.archived) {
    throw apiError(
      kind === 'worksheet'
        ? ErrorCodes.WORKSHEET_ARCHIVED
        : ErrorCodes.WORKBOOK_ARCHIVED,
    );
  }
}
