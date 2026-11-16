import { Type } from 'class-transformer';
import { ASSISTANT_SECTIONS } from './agent-runs.types.js';
import type { AssistantSection } from './agent-runs.types.js';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const SHA256_HEX = /^[a-f0-9]{64}$/;

/** Lo que la persona fija del contexto: revisión y selección de H6. */
export class RunContextDto {
  @IsOptional()
  @IsIn(['en', 'es'])
  language?: 'en' | 'es';

  @IsOptional()
  @IsIn(ASSISTANT_SECTIONS)
  section?: AssistantSection;

  @IsOptional()
  @IsUUID()
  workbookId?: string;

  @IsOptional()
  @IsUUID()
  worksheetId?: string;

  @IsOptional()
  @IsUUID()
  catalogSnapshotId?: string;

  @IsOptional()
  @IsUUID()
  evaluationId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  rulesetRevision?: number;

  @IsOptional()
  @IsUUID()
  revisionId?: string;

  @IsOptional()
  @IsUUID()
  selectionId?: string;
}

/** `POST …/conversations/:id/runs`: el mensaje ya guardado que se envía. */
export class StartAgentRunDto {
  @IsUUID()
  messageId!: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RunContextDto)
  context?: RunContextDto;
}

/** Confirmar o rechazar: el hash de la propuesta que la persona vio. */
export class ProposalDecisionDto {
  @Matches(SHA256_HEX)
  proposalHash!: string;
}

/**
 * Una llamada del agente a la pasarela (A11). `callId` es opcional: el agente
 * de hoy no lo manda y Nest pone uno.
 */
export class GatewayCallDto {
  @IsOptional()
  @IsUUID()
  callId?: string;

  @IsIn(['execute', 'prepare'])
  mode!: 'execute' | 'prepare';

  @IsObject()
  arguments!: Record<string, unknown>;
}

/** `GET …/ai-runs/:runId/events?after=12`: los hitos posteriores a ese número. */
export class RunEventsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  after?: number;
}
