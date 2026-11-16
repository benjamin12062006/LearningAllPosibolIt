import { UseGuards } from '@nestjs/common';
import {
  Args,
  ID,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import type { AuthenticatedIdentity } from '../../auth/authenticated-request.js';
import { CurrentIdentity } from '../../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../../auth/descope-session.guard.js';
import { validateAs } from '../../common/http/validation-options.js';
import { uuidParamPipe } from '../../common/http/validation-errors.js';
import { PreviewRulesDto } from '../../evaluations/evaluations.dto.js';
import { EvaluationsService } from '../../evaluations/evaluations.service.js';
import type { EvaluationView } from '../../evaluations/evaluations.types.js';
import { toRulesetBody } from '../rulesets/rule-input.js';
import {
  EvaluationAttentionType,
  EvaluationRowPageType,
  EvaluationRowsArgs,
  EvaluationType,
  RequestEvaluationInput,
  RulesPreviewInput,
  RulesPreviewPageArgs,
  RulesPreviewType,
} from './evaluations.graphql.js';

/** La evaluación con el proyecto con el que se pidió, para sus campos. */
export type ProjectEvaluation = EvaluationView &
  Readonly<{ projectId: string }>;

/**
 * Evaluaciones por GraphQL (C7): la evaluación con su «Requiere atención» y
 * sus filas, pedir una nueva y probar reglas, con los mismos servicios que REST.
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

  /**
   * Pone una evaluación en cola, como `POST …/evaluations` (202), y la
   * devuelve en cola: su estado se sigue con `evaluation`.
   */
  @Mutation(() => EvaluationType, { name: 'requestEvaluation' })
  async request(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Args('projectId', { type: () => ID }, uuidParamPipe('projectId'))
    projectId: string,
    @Args('input', { type: () => RequestEvaluationInput })
    input: RequestEvaluationInput,
  ): Promise<ProjectEvaluation> {
    const { evaluationId } = await this.evaluations.accept(
      identity,
      projectId,
      input,
    );
    return this.findOne(identity, projectId, evaluationId);
  }

  /** Una consulta y no una mutación: no guarda nada (ficha 05). */
  @Query(() => RulesPreviewType, { name: 'rulesPreview' })
  async previewRules(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Args('projectId', { type: () => ID }, uuidParamPipe('projectId'))
    projectId: string,
    @Args('input', { type: () => RulesPreviewInput }) input: RulesPreviewInput,
    @Args() page: RulesPreviewPageArgs,
  ) {
    const body = await validateAs(PreviewRulesDto, {
      ...toRulesetBody(input),
      snapshotId: input.snapshotId,
      ...(input.baseRevision == null
        ? {}
        : { baseRevision: input.baseRevision }),
    });
    return this.evaluations.previewRules(identity, projectId, body, page);
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

  /** La misma lectura que `GET …/evaluations/:id/rows`. */
  @ResolveField(() => EvaluationRowPageType, { name: 'rows' })
  rows(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Parent() evaluation: ProjectEvaluation,
    @Args() query: EvaluationRowsArgs,
  ) {
    return this.evaluations.findRows(
      identity,
      evaluation.projectId,
      evaluation.id,
      query,
    );
  }
}
