import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import type { AuthenticatedIdentity } from '../../auth/authenticated-request.js';
import { CurrentIdentity } from '../../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../../auth/descope-session.guard.js';
import { validateAs } from '../../common/http/validation-options.js';
import { uuidParamPipe } from '../../common/http/validation-errors.js';
import { CreateRulesetDto } from '../../rulesets/rulesets.dto.js';
import { RulesetsService } from '../../rulesets/rulesets.service.js';
import { RulesetInput, toRulesetBody } from './rule-input.js';
import { RulesetType } from './rulesets.graphql.js';

/** Reglas por GraphQL (C7.2): las mismas rutas que `…/rulesets`. */
@Resolver(() => RulesetType)
@UseGuards(DescopeSessionGuard)
export class RulesetsResolver {
  constructor(private readonly rulesets: RulesetsService) {}

  @Query(() => RulesetType, { name: 'ruleset' })
  findRevision(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Args('projectId', { type: () => ID }, uuidParamPipe('projectId'))
    projectId: string,
    @Args('revision', { type: () => Int }) revision: number,
  ) {
    return this.rulesets.findRevision(identity, projectId, revision);
  }

  /** Guarda la revisión siguiente, como `POST …/rulesets`. */
  @Mutation(() => RulesetType, { name: 'createRuleset' })
  async create(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Args('projectId', { type: () => ID }, uuidParamPipe('projectId'))
    projectId: string,
    @Args('input', { type: () => RulesetInput }) input: RulesetInput,
  ) {
    const body = await validateAs(CreateRulesetDto, toRulesetBody(input));
    return this.rulesets.create(identity, projectId, body);
  }
}
