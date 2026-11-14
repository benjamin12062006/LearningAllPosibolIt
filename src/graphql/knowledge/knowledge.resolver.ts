import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Resolver } from '@nestjs/graphql';
import type { AuthenticatedIdentity } from '../../auth/authenticated-request.js';
import { CurrentIdentity } from '../../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../../auth/descope-session.guard.js';
import { uuidParamPipe } from '../../common/http/validation-errors.js';
import { KnowledgeService } from '../../knowledge/knowledge.service.js';
import { KnowledgeReindexType } from './knowledge.graphql.js';

/**
 * Reindexar el conocimiento del proyecto (Manager), como
 * `POST …/knowledge/reindex`. Leer su estado es `Project.knowledge`.
 */
@Resolver()
@UseGuards(DescopeSessionGuard)
export class KnowledgeResolver {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Mutation(() => KnowledgeReindexType, { name: 'reindexKnowledge' })
  reindex(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Args('projectId', { type: () => ID }, uuidParamPipe('projectId'))
    projectId: string,
  ) {
    return this.knowledge.reindex(identity, projectId);
  }
}
