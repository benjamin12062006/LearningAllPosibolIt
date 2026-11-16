import { UseGuards } from '@nestjs/common';
import {
  Args,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import type { AuthenticatedIdentity } from '../../auth/authenticated-request.js';
import { CurrentIdentity } from '../../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../../auth/descope-session.guard.js';
import type { Conversation } from '../../conversations/conversations.repository.js';
import { ConversationsService } from '../../conversations/conversations.service.js';
import { IdArg } from '../common/id-args.js';
import {
  AppendConversationMessageInput,
  ConversationMessagePageType,
  ConversationMessageType,
  ConversationMessagesArgs,
  ConversationType,
  CreateConversationInput,
} from './conversations.graphql.js';

@Resolver(() => ConversationType)
@UseGuards(DescopeSessionGuard)
export class ConversationsResolver {
  constructor(private readonly conversations: ConversationsService) {}

  @Query(() => ConversationType, { name: 'conversation' })
  find(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('id') id: string,
  ) {
    return this.conversations.find(identity, { organizationId, projectId }, id);
  }

  @Mutation(() => ConversationType, { name: 'createProjectConversation' })
  createForProject(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @Args('input', { type: () => CreateConversationInput })
    input: CreateConversationInput,
  ) {
    return this.conversations.createForProject(
      identity,
      { organizationId, projectId },
      input,
    );
  }

  @Mutation(() => ConversationType, { name: 'createWorkbookConversation' })
  createForWorkbook(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('workbookId') workbookId: string,
    @Args('input', { type: () => CreateConversationInput })
    input: CreateConversationInput,
  ) {
    return this.conversations.createForWorkbook(
      identity,
      { organizationId, projectId },
      workbookId,
      input,
    );
  }

  @Mutation(() => ConversationType, { name: 'createWorksheetConversation' })
  createForWorksheet(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('worksheetId') worksheetId: string,
    @Args('input', { type: () => CreateConversationInput })
    input: CreateConversationInput,
  ) {
    return this.conversations.createForWorksheet(
      identity,
      { organizationId, projectId },
      worksheetId,
      input,
    );
  }

  @Mutation(() => ConversationMessageType, {
    name: 'appendConversationMessage',
  })
  appendMessage(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('conversationId') conversationId: string,
    @Args('input', { type: () => AppendConversationMessageInput })
    input: AppendConversationMessageInput,
  ) {
    return this.conversations.appendMessage(
      identity,
      { organizationId, projectId },
      conversationId,
      input,
    );
  }

  @ResolveField(() => ConversationMessagePageType, { name: 'messages' })
  findMessages(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Parent() conversation: Conversation,
    @Args() query: ConversationMessagesArgs,
  ) {
    const { organizationId, projectId, id } = conversation;
    return this.conversations.findMessages(
      identity,
      { organizationId, projectId },
      id,
      query,
    );
  }
}
