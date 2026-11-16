import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { AgentRunsService } from '../../agent-runs/agent-runs.service.js';
import type { AuthenticatedIdentity } from '../../auth/authenticated-request.js';
import { CurrentIdentity } from '../../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../../auth/descope-session.guard.js';
import { IdArg } from '../common/id-args.js';
import {
  AgentProposalDecisionInput,
  AgentProposalType,
  AgentRunType,
  StartAgentRunInput,
} from './agent-runs.graphql.js';

/** El agente por GraphQL (E6.3a): los mismos casos de uso que REST. */
@Resolver(() => AgentRunType)
@UseGuards(DescopeSessionGuard)
export class AgentRunsResolver {
  constructor(private readonly runs: AgentRunsService) {}

  @Mutation(() => AgentRunType, { name: 'startAgentRun' })
  start(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('conversationId') conversationId: string,
    @Args('input', { type: () => StartAgentRunInput })
    input: StartAgentRunInput,
  ) {
    return this.runs.start(
      identity,
      { organizationId, projectId },
      conversationId,
      input,
    );
  }

  @Query(() => AgentRunType, { name: 'agentRun' })
  find(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('id') id: string,
  ) {
    return this.runs.find(identity, { organizationId, projectId }, id);
  }

  @Mutation(() => AgentProposalType, { name: 'confirmAgentProposal' })
  confirm(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('runId') runId: string,
    @IdArg('proposalId') proposalId: string,
    @Args('input', { type: () => AgentProposalDecisionInput })
    input: AgentProposalDecisionInput,
  ) {
    return this.runs.confirm(
      identity,
      { organizationId, projectId },
      runId,
      proposalId,
      input.proposalHash,
    );
  }

  @Mutation(() => AgentProposalType, { name: 'rejectAgentProposal' })
  reject(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('runId') runId: string,
    @IdArg('proposalId') proposalId: string,
    @Args('input', { type: () => AgentProposalDecisionInput })
    input: AgentProposalDecisionInput,
  ) {
    return this.runs.reject(
      identity,
      { organizationId, projectId },
      runId,
      proposalId,
      input.proposalHash,
    );
  }

  @Mutation(() => AgentRunType, { name: 'cancelAgentRun' })
  cancel(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('id') id: string,
  ) {
    return this.runs.cancel(identity, { organizationId, projectId }, id);
  }
}
