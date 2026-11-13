import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { CurrentIdentity } from '../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../auth/descope-session.guard.js';
import { uuidParamPipe } from '../common/http/validation-errors.js';
import { KnowledgeService } from './knowledge.service.js';

/** Estado del índice de conocimiento de un proyecto y reindexado (plan E6, D17). */
@Controller('projects/:projectId/knowledge')
@UseGuards(DescopeSessionGuard)
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  /** `{ enabled, sources: [{ sourceType, sourceId, syncedAt, pending }] }`. */
  @Get()
  status(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
  ) {
    return this.knowledge.status(identity, projectId);
  }

  /** 202: la pasada siguiente del reconciliador manda el proyecto entero. */
  @Post('reindex')
  @HttpCode(202)
  reindex(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
  ) {
    return this.knowledge.reindex(identity, projectId);
  }
}
