import {
  ArgsType,
  Field,
  ID,
  InputType,
  Int,
  ObjectType,
} from '@nestjs/graphql';
import { Allow, IsInt, Min } from 'class-validator';
import type { ChangesetStatus } from '../../changesets/changesets.types.js';
import {
  ApplyChangesetDto,
  ChangesetListQueryDto,
  ConflictResolutionDto,
  CreateChangesetDto,
  DecisionDto,
  DraftVersionDto,
  RebaseDto,
  SaveOperationsDto,
} from '../../changesets/changesets.dto.js';
import { JsonObjectScalar } from '../common/json-object.scalar.js';
import { JsonScalar } from '../common/json.scalar.js';
import { PageInfoType } from '../common/page-info.type.js';

/** Los campos de un borrador que también salen en el historial de la hoja. */
@ObjectType('ChangesetSummary')
export class ChangesetSummaryType {
  @Field(() => ID) id!: string;
  @Field(() => ID) worksheetId!: string;
  @Field(() => ID) authorId!: string;
  /** `manual`, `revert` o `import`. */
  @Field() source!: string;
  @Field() title!: string;
  @Field() status!: string;
  /** Lo que se manda para guardar, enviar o reabrir: si cambió, 412. */
  @Field(() => Int) draftVersion!: number;
  @Field(() => ID) baseRevisionId!: string;
  @Field(() => Int) baseSequence!: number;
  @Field(() => Int) baseSchemaVersion!: number;
  /** Existe desde el envío: es lo que se revisa y se aprueba. */
  @Field(() => String, { nullable: true }) contentHash!: string | null;
  @Field(() => ID, { nullable: true }) appliedRevisionId!: string | null;
  @Field() createdAt!: string;
  @Field() updatedAt!: string;
}

/** En el historial de la hoja: sin las operaciones, que pueden ser mil. */
@ObjectType('ChangesetListItem')
export class ChangesetListItemType extends ChangesetSummaryType {
  @Field(() => Int) operationCount!: number;
}

@ObjectType('Changeset')
export class ChangesetType extends ChangesetSummaryType {
  /** Cada operación como en REST: `{ type, … }`. */
  @Field(() => [JsonScalar]) operations!: unknown[];
}

@ObjectType('ChangesetPage')
export class ChangesetPageType {
  @Field(() => [ChangesetListItemType]) items!: ChangesetListItemType[];
  @Field(() => PageInfoType) page!: PageInfoType;
}

@ObjectType('ChangesetProblem')
export class ChangesetProblemType {
  @Field(() => ID) rowId!: string;
  @Field(() => ID) columnId!: string;
  @Field() code!: string;
}

/** Lo que cambiaría el borrador sobre la revisión actual, como `…/diff`. */
@ObjectType('ChangesetReview')
export class ChangesetReviewType {
  @Field(() => ID) baseRevisionId!: string;
  @Field(() => ID) headRevisionId!: string;
  @Field() contentHash!: string;
  /** Cada cambio de celda, fila o columna, como en REST. */
  @Field(() => [JsonScalar]) entries!: unknown[];
  /** Cuántos cambios hay de cada estado. */
  @Field(() => JsonScalar) counts!: unknown;
  @Field(() => Int) resultingRowCount!: number;
  @Field(() => [ChangesetProblemType]) problems!: ChangesetProblemType[];
  /** Lo que hace cada cambio de tipo de columna. */
  @Field(() => [JsonScalar]) columnConversions!: unknown[];
}

@ObjectType('ChangesetDecision')
export class ChangesetDecisionType {
  @Field(() => ID) id!: string;
  @Field(() => ID) actorId!: string;
  @Field() decision!: string;
  @Field() contentHash!: string;
  @Field(() => Int) draftVersion!: number;
  @Field(() => ID) headRevisionId!: string;
  /** `peer` o `single_member`. */
  @Field() policy!: string;
  @Field(() => String, { nullable: true }) reason!: string | null;
  @Field() createdAt!: string;
}

@ObjectType('ChangesetDecisionResult')
export class ChangesetDecisionResultType {
  @Field(() => ChangesetDecisionType) decision!: ChangesetDecisionType;
  @Field(() => ChangesetType) changeset!: ChangesetType;
}

/** La revisión nueva que dejó aplicar el borrador. */
@ObjectType('AppliedChangeset')
export class AppliedChangesetType {
  @Field(() => ID) changesetId!: string;
  @Field(() => ID) revisionId!: string;
  @Field(() => Int) sequence!: number;
}

@ArgsType()
export class ChangesetListArgs extends ChangesetListQueryDto {
  @Field(() => Int, { nullable: true }) declare limit?: number;
  @Field(() => Int, { nullable: true }) declare offset?: number;
  @Field(() => String, { nullable: true }) declare status?: ChangesetStatus;
}

@InputType('CreateChangesetInput')
export class CreateChangesetInput extends CreateChangesetDto {
  @Field() declare title: string;
}

/**
 * En REST la versión va en `If-Match`; aquí es un campo. Las operaciones son
 * árboles del dominio: las valida el mismo analizador que en REST.
 */
@InputType('SaveOperationsInput')
export class SaveOperationsInput extends SaveOperationsDto {
  @Field(() => Int)
  @IsInt()
  @Min(1)
  draftVersion!: number;

  @Field(() => [JsonObjectScalar]) declare operations: unknown[];
}

@InputType('DraftVersionInput')
export class DraftVersionInput extends DraftVersionDto {
  @Field(() => Int) declare draftVersion: number;
}

@InputType('DecisionInput')
export class DecisionInput extends DecisionDto {
  @Field(() => Int) declare draftVersion: number;
  /** `accept` o `reject`. */
  @Field() declare decision: 'accept' | 'reject';
  @Field() declare contentHash: string;
  @Field(() => ID) declare expectedHeadRevisionId: string;
  @Field(() => String, { nullable: true }) declare reason?: string;
}

/** En REST la clave de idempotencia va en `Idempotency-Key`; aquí es un campo. */
@InputType('ApplyChangesetInput')
export class ApplyChangesetInput extends ApplyChangesetDto {
  @Field() declare contentHash: string;
  @Field(() => ID) declare expectedHeadRevisionId: string;

  /** La comprueba el servicio, con el mismo error que REST si falta. */
  @Field()
  @Allow()
  idempotencyKey!: string;
}

@InputType('ConflictResolutionInput')
export class ConflictResolutionInput extends ConflictResolutionDto {
  @Field(() => ID, { nullable: true }) declare rowId: string | null;
  @Field(() => ID, { nullable: true }) declare columnId: string | null;
  /** `proposed` o `head`. */
  @Field() declare choice: 'proposed' | 'head';
}

@InputType('RebaseInput')
export class RebaseInput extends RebaseDto {
  @Field(() => Int) declare draftVersion: number;
  @Field(() => [ConflictResolutionInput], { nullable: true })
  declare resolutions?: ConflictResolutionInput[];
}
