import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { CurrentIdentity } from '../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../auth/descope-session.guard.js';
import { uuidParamPipe } from '../common/http/validation-errors.js';
import {
  AppendConversationMessageDto,
  ConversationListQueryDto,
  ConversationMessagesQueryDto,
  CreateConversationDto,
} from './conversations.dto.js';
import { ConversationsService } from './conversations.service.js';

@Controller('organizations/:organizationId/projects/:projectId')
@UseGuards(DescopeSessionGuard)
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Post('conversations')
  async createForProject(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Body() body: CreateConversationDto,
  ) {
    const conversation = await this.conversations.createForProject(
      identity,
      { organizationId, projectId },
      body,
    );
    return { conversation };
  }

  @Post('workbooks/:workbookId/conversations')
  async createForWorkbook(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('workbookId', uuidParamPipe('workbookId')) workbookId: string,
    @Body() body: CreateConversationDto,
  ) {
    const conversation = await this.conversations.createForWorkbook(
      identity,
      { organizationId, projectId },
      workbookId,
      body,
    );
    return { conversation };
  }

  @Post('worksheets/:worksheetId/conversations')
  async createForWorksheet(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('worksheetId', uuidParamPipe('worksheetId')) worksheetId: string,
    @Body() body: CreateConversationDto,
  ) {
    const conversation = await this.conversations.createForWorksheet(
      identity,
      { organizationId, projectId },
      worksheetId,
      body,
    );
    return { conversation };
  }

  @Get('conversations')
  findByProject(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Query() query: ConversationListQueryDto,
  ) {
    return this.conversations.findByProject(
      identity,
      { organizationId, projectId },
      query,
    );
  }

  @Get('conversations/:conversationId')
  async find(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('conversationId', uuidParamPipe('conversationId'))
    conversationId: string,
  ) {
    const conversation = await this.conversations.find(
      identity,
      { organizationId, projectId },
      conversationId,
    );
    return { conversation };
  }

  @Post('conversations/:conversationId/messages')
  async appendMessage(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('conversationId', uuidParamPipe('conversationId'))
    conversationId: string,
    @Body() body: AppendConversationMessageDto,
  ) {
    const message = await this.conversations.appendMessage(
      identity,
      { organizationId, projectId },
      conversationId,
      body,
    );
    return { message };
  }

  @Get('conversations/:conversationId/messages')
  findMessages(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('conversationId', uuidParamPipe('conversationId'))
    conversationId: string,
    @Query() query: ConversationMessagesQueryDto,
  ) {
    return this.conversations.findMessages(
      identity,
      { organizationId, projectId },
      conversationId,
      query,
    );
  }
}
