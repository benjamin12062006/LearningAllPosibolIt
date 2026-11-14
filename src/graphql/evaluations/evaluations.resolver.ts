import { UseGuards } from '@nestjs/common';
import {
  Args,
  ID,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import type { AuthenticatedIdentity } from '../../auth/authenticated-request.js';
import { CurrentIdentity } from '../../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../../auth/descope-session.guard.js';
import { uuidParamPipe } from '../../common/http/validation-errors.js';
import { EvaluationsService } from '../../evaluations/evaluations.service.js';
import type { EvaluationView } from '../../evaluations/evaluations.types.js';
import {
  EvaluationAttentionType,
  EvaluationType,
} from './evaluations.graphql.js';

/** La evaluación con el proyecto con el que se pidió, para sus campos. */
type ProjectEvaluation = EvaluationView & Readonly<{ projectId: string }>;

/**
 * Evaluaciones por GraphQL (C7, piloto): la evaluación y su «Requiere
 * atención» en una sola llamada, con los mismos servicios que REST.
 */
@Resolver(() => EvaluationType)
@UseGuards(DescopeSessionGuard)
export class EvaluationsResolver {
  constructor(private readonly evaluations: EvaluationsService) {}

  @Query(() => EvaluationType, { name: 'evaluation' })
  async findOne(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Args('projectId', { type: () => ID }, uuidParamPipe('projectId'))
    projectId: string,
    @Args('id', { type: () => ID }, uuidParamPipe('id')) id: string,
  ): Promise<ProjectEvaluation> {
    const evaluation = await this.evaluations.findSummary(
      identity,
      projectId,
      id,
    );
    return { ...evaluation, projectId };
  }

  @ResolveField(() => EvaluationAttentionType, { name: 'attention' })
  attention(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Parent() evaluation: ProjectEvaluation,
  ) {
    return this.evaluations.findAttention(
      identity,
      evaluation.projectId,
      evaluation.id,
    );
  }
}
