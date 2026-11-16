import { Field, ID, InputType, ObjectType } from '@nestjs/graphql';
import {
  ProposalDecisionDto,
  RunContextDto,
  StartAgentRunDto,
} from '../../agent-runs/agent-runs.dto.js';
import { ApiErrorType } from '../common/api-error.type.js';
import { JsonScalar } from '../common/json.scalar.js';

@ObjectType('AgentRunContext')
export class AgentRunContextType {
  @Field(() => ID, { nullable: true }) workbookId!: string | null;
  @Field(() => ID, { nullable: true }) worksheetId!: string | null;
  @Field(() => ID, { nullable: true }) revisionId!: string | null;
  @Field(() => ID, { nullable: true }) selectionId!: string | null;
}

/** Lo que preparó el agente; solo la persona lo confirma. */
@ObjectType('AgentProposal')
export class AgentProposalType {
  @Field(() => ID) id!: string;
  @Field() operation!: string;
  @Field() summary!: string;
  @Field(() => JsonScalar, { nullable: true }) rulesetReview?: unknown;
  /** Se manda al confirmar o rechazar: prueba que se vio esta propuesta. */
  @Field() hash!: string;
  /** `ready`, `confirming`, `confirmed` o `rejected`. */
  @Field() status!: string;
  @Field(() => JsonScalar, { nullable: true }) target!: unknown;
  @Field(() => JsonScalar, { nullable: true }) result!: unknown;
  @Field() expiresAt!: string;
  @Field() createdAt!: string;
  @Field(() => String, { nullable: true }) decidedAt!: string | null;
}

@ObjectType('AgentRun')
export class AgentRunType {
  @Field(() => ID) id!: string;
  @Field(() => ID) conversationId!: string;
  @Field(() => ID) userMessageId!: string;
  /** `queued`, `running`, `succeeded`, `failed`, `expired` o `cancelled`. */
  @Field() status!: string;
  /** Solo si terminó bien: `answered`, `confirmation_required`… */
  @Field(() => String, { nullable: true }) outcome!: string | null;
  @Field(() => AgentRunContextType) context!: AgentRunContextType;
  @Field(() => ID, { nullable: true }) answerMessageId!: string | null;
  @Field(() => String, { nullable: true }) answer!: string | null;
  @Field(() => ApiErrorType, { nullable: true }) error!: ApiErrorType | null;
  @Field() createdAt!: string;
  @Field(() => String, { nullable: true }) startedAt!: string | null;
  @Field(() => String, { nullable: true }) finishedAt!: string | null;
  @Field(() => AgentProposalType, { nullable: true })
  proposal!: AgentProposalType | null;
}

@InputType('AgentRunContextInput')
export class AgentRunContextInput extends RunContextDto {
  @Field(() => ID, { nullable: true }) declare revisionId?: string;
  @Field(() => ID, { nullable: true }) declare selectionId?: string;
}

@InputType('StartAgentRunInput')
export class StartAgentRunInput extends StartAgentRunDto {
  @Field(() => ID) declare messageId: string;
  @Field(() => AgentRunContextInput, { nullable: true })
  declare context?: AgentRunContextInput;
}

@InputType('AgentProposalDecisionInput')
export class AgentProposalDecisionInput extends ProposalDecisionDto {
  @Field() declare proposalHash: string;
}
