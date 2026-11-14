import { ArgsType, Field, ID, InputType, Int, ObjectType } from '@nestjs/graphql';
import { Allow } from 'class-validator';
import type { CellValue } from '../../changesets/changeset-operations.js';
import {
  CreateWorksheetChangeProposalDto,
  CreateWorksheetSelectionDto,
  PreviewWorksheetTransformDto,
} from '../../worksheet-tools/worksheet-tools.dto.js';
import { JsonObjectScalar } from '../common/json-object.scalar.js';
import { JsonScalar } from '../common/json.scalar.js';
import { PageInfoType } from '../common/page-info.type.js';
import { PaginationArgs } from '../common/pagination.args.js';

@ObjectType('WorksheetSelection')
export class WorksheetSelectionType {
  @Field(() => ID) selectionId!: string;
  @Field(() => ID) revisionId!: string;
  @Field(() => Int) rowCount!: number;
  @Field() expiresAt!: string;
}

@ObjectType('WorksheetTransformChange')
export class WorksheetTransformChangeType {
  @Field(() => ID) rowId!: string;
  @Field(() => ID) columnId!: string;
  @Field(() => JsonScalar, { nullable: true }) before!: CellValue;
  @Field(() => JsonScalar, { nullable: true }) after!: CellValue;
}

@ObjectType('WorksheetTransformPreview')
export class WorksheetTransformPreviewType {
  @Field(() => ID) previewId!: string;
  @Field(() => ID) revisionId!: string;
  @Field(() => ID) selectionId!: string;
  @Field() expiresAt!: string;
  @Field(() => Int) affectedRows!: number;
  @Field(() => Int) affectedCells!: number;
  @Field(() => [WorksheetTransformChangeType])
  sample!: WorksheetTransformChangeType[];
  @Field(() => Int) issueCount!: number;
  @Field() canCreateProposal!: boolean;
}

@ObjectType('WorksheetTransformPreviewPage')
export class WorksheetTransformPreviewPageType extends WorksheetTransformPreviewType {
  @Field(() => [WorksheetTransformChangeType])
  items!: WorksheetTransformChangeType[];
  @Field(() => PageInfoType) page!: PageInfoType;
}

@ObjectType('WorksheetChangeProposal')
export class WorksheetChangeProposalType {
  @Field(() => ID) id!: string;
  @Field(() => ID) worksheetId!: string;
  @Field(() => ID) baseRevisionId!: string;
  @Field(() => Int) draftVersion!: number;
  @Field() status!: string;
}

@InputType('CreateWorksheetSelectionInput')
export class CreateWorksheetSelectionInput extends CreateWorksheetSelectionDto {
  @Field(() => ID) declare revisionId: string;
  @Field(() => [ID]) declare columnIds: string[];
  @Field(() => JsonObjectScalar) declare rows: Record<string, unknown>;
}

@InputType('PreviewWorksheetTransformInput')
export class PreviewWorksheetTransformInput extends PreviewWorksheetTransformDto {
  @Field(() => ID) declare selectionId: string;
  @Field(() => [ID]) declare columnIds: string[];
  @Field(() => JsonObjectScalar) declare transform: Record<string, unknown>;
}

@InputType('CreateWorksheetChangeProposalInput')
export class CreateWorksheetChangeProposalInput extends CreateWorksheetChangeProposalDto {
  @Field(() => ID) declare previewId: string;
  @Field() declare explanation: string;

  /** El servicio valida la clave también cuando REST la recibe como cabecera. */
  @Field(() => String, { nullable: true })
  @Allow()
  idempotencyKey?: string | null;
}

/** Los IDs viajan por `IdArg`. El pipe de la página permite que coexistan. */
@ArgsType()
export class WorksheetTransformPreviewPageArgs extends PaginationArgs {
  @Allow() organizationId?: unknown;
  @Allow() projectId?: unknown;
  @Allow() worksheetId?: unknown;
  @Allow() previewId?: unknown;
}
