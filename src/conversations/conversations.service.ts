import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { createHash } from 'node:crypto';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { PAGINATION } from '../common/http/pagination.js';
import { UsersService } from '../users/users.service.js';
import type { ProjectScope } from '../worksheets/worksheets.types.js';
import {
  MAX_CONVERSATION_CURSOR_LENGTH,
  type AppendConversationMessageDto,
  type ConversationListQueryDto,
  type ConversationMessagesQueryDto,
  type CreateConversationDto,
} from './conversations.dto.js';
import { ConversationsRepository } from './conversations.repository.js';

const CURSOR_FORMAT = /^[A-Za-z0-9_-]+$/;
const MAX_MESSAGE_SEQUENCE = 2_147_483_647;

@Injectable()
export class ConversationsService {
  constructor(
    private readonly users: UsersService,
    private readonly repository: ConversationsRepository,
  ) {}

  async createForProject(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    input: CreateConversationDto,
  ) {
    const actor = await this.users.findCurrent(identity);
    return this.repository.create(actor.id, scope, null, input.title);
  }

  async createForWorkbook(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    workbookId: string,
    input: CreateConversationDto,
  ) {
    const actor = await this.users.findCurrent(identity);
    return this.repository.create(
      actor.id,
      scope,
      { kind: 'workbook', id: workbookId },
      input.title,
    );
  }

  async createForWorksheet(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    worksheetId: string,
    input: CreateConversationDto,
  ) {
    const actor = await this.users.findCurrent(identity);
    return this.repository.create(
      actor.id,
      scope,
      { kind: 'worksheet', id: worksheetId },
      input.title,
    );
  }

  async findByProject(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    query: ConversationListQueryDto,
  ) {
    const actor = await this.users.findCurrent(identity);
    const filter = {
      workbookId: query.workbookId ?? undefined,
      worksheetId: query.worksheetId ?? undefined,
    };
    const context = cursorContext(actor.id, scope, [
      'conversations',
      filter.workbookId ?? null,
      filter.worksheetId ?? null,
    ]);
    const after = readConversationPosition(query.cursor, context);
    if (query.cursor != null && !after) {
      // Una posición inválida no debe cambiar la respuesta de un ámbito ajeno.
      await this.repository.assertListScope(actor.id, scope, filter);
      throw apiError(ErrorCodes.CONVERSATION_CURSOR_INVALID);
    }

    const limit = query.limit ?? PAGINATION.defaultLimit;
    const conversations = await this.repository.findByProject(actor.id, scope, {
      ...filter,
      limit: limit + 1,
      after,
    });
    return takePage(conversations, limit, (item) =>
      encodeCursor(context, { createdAt: item.createdAt, id: item.id }),
    );
  }

  async find(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    conversationId: string,
  ) {
    const actor = await this.users.findCurrent(identity);
    const conversation = await this.repository.find(
      actor.id,
      scope,
      conversationId,
    );
    if (!conversation) {
      throw apiError(ErrorCodes.CONVERSATION_NOT_FOUND);
    }
    return conversation;
  }

  async appendMessage(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    conversationId: string,
    input: AppendConversationMessageDto,
  ) {
    const actor = await this.users.findCurrent(identity);
    return this.repository.appendMessage(
      actor.id,
      scope,
      conversationId,
      input,
    );
  }

  async findMessages(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    conversationId: string,
    query: ConversationMessagesQueryDto,
  ) {
    const actor = await this.users.findCurrent(identity);
    const context = cursorContext(actor.id, scope, [
      'messages',
      conversationId,
    ]);
    const before = readMessagePosition(query.cursor, context);
    if (query.cursor != null && before === undefined) {
      await this.repository.assertMessageScope(actor.id, scope, conversationId);
      throw apiError(ErrorCodes.CONVERSATION_CURSOR_INVALID);
    }

    const limit = query.limit ?? PAGINATION.defaultLimit;
    const messages = await this.repository.findMessages(
      actor.id,
      scope,
      conversationId,
      { limit: limit + 1, before },
    );
    const page = takePage(messages, limit, ({ sequence }) =>
      encodeCursor(context, { sequence }),
    );
    // El cursor se calcula desde la entrada más antigua de la página.
    return { ...page, items: page.items.reverse() };
  }
}

function cursorContext(
  actorId: string,
  scope: ProjectScope,
  resource: readonly (string | null)[],
) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        actorId,
        scope.organizationId,
        scope.projectId,
        ...resource,
      ]),
    )
    .digest('hex');
}

function readConversationPosition(cursor: string | undefined, context: string) {
  const position = decodeCursor(cursor, context);
  const { createdAt, id } = position ?? {};
  if (typeof id !== 'string' || !isUUID(id) || !isIsoTimestamp(createdAt)) {
    return undefined;
  }
  return { createdAt, id };
}

function readMessagePosition(cursor: string | undefined, context: string) {
  const sequence = decodeCursor(cursor, context)?.sequence;
  if (
    typeof sequence !== 'number' ||
    !Number.isInteger(sequence) ||
    sequence < 1 ||
    sequence > MAX_MESSAGE_SEQUENCE
  ) {
    return undefined;
  }
  return sequence;
}

function takePage<T>(
  rows: readonly T[],
  limit: number,
  cursorFor: (item: T) => string,
) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const nextCursor =
    rows.length > limit && last !== undefined ? cursorFor(last) : null;
  return { items, nextCursor };
}

function encodeCursor(
  context: string,
  position: Record<string, string | number>,
) {
  return Buffer.from(JSON.stringify({ context, ...position })).toString(
    'base64url',
  );
}

function decodeCursor(cursor: string | undefined, context: string) {
  const validFormat =
    cursor &&
    cursor.length <= MAX_CONVERSATION_CURSOR_LENGTH &&
    CURSOR_FORMAT.test(cursor);
  if (!validFormat) return undefined;

  const bytes = Buffer.from(cursor, 'base64url');
  if (bytes.toString('base64url') !== cursor) return undefined;

  try {
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    return isRecord(value) && value.context === context ? value : undefined;
  } catch {
    return undefined;
  }
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const timestamp = new Date(value);
  return (
    Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
