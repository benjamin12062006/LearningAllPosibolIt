import {
  ArgsType,
  Field,
  ID,
  InputType,
  Int,
  ObjectType,
} from '@nestjs/graphql';
import { Allow } from 'class-validator';
import {
  CreateEvaluationDto,
  EvaluationRowsQueryDto,
} from '../../evaluations/evaluations.dto.js';
import type {
  ProblemAttribute,
  ProblemCode,
} from '../../evaluations/engine/google-merchant.profile.js';
import type { RowOutcomeKind } from '../../evaluations/evaluations.types.js';
import { ApiErrorType } from '../common/api-error.type.js';
import { JsonScalar } from '../common/json.scalar.js';
import { PageInfoType } from '../common/page-info.type.js';
import { PaginationArgs } from '../common/pagination.args.js';
import { RulesetInput } from '../rulesets/rule-input.js';

@ObjectType('LocalizedText')
export class LocalizedTextType {
  @Field() es!: string;
  @Field() en!: string;
}

@ObjectType('EvaluationCounts')
export class EvaluationCountsType {
  @Field(() => Int) total!: number;
  @Field(() => Int) valid!: number;
  @Field(() => Int) invalid!: number;
  @Field(() => Int) excluded!: number;
}

/** Un problema de un producto, con su texto es/en. */
@ObjectType('Problem')
export class ProblemType {
  @Field() attribute!: string;
  @Field() code!: string;
  @Field(() => LocalizedTextType) problem!: LocalizedTextType;
  @Field(() => LocalizedTextType) suggestion!: LocalizedTextType;
}

/** Un problema en un atributo y cuántos productos lo tienen. */
@ObjectType('ProblemGroup')
export class ProblemGroupType extends ProblemType {
  @Field(() => Int) productCount!: number;
}

@ObjectType('ExclusionGroup')
export class ExclusionGroupType {
  @Field(() => Int) rulePosition!: number;
  /** La regla tal como estaba en la revisión con la que se evaluó. */
  @Field(() => JsonScalar, { nullable: true }) rule!: unknown;
  @Field(() => Int) productCount!: number;
}

/** «Requiere atención»: qué hay que arreglar antes de publicar. */
@ObjectType('EvaluationAttention')
export class EvaluationAttentionType {
  @Field(() => Int) affectedProducts!: number;
  @Field(() => [ProblemGroupType]) problemGroups!: ProblemGroupType[];
  @Field(() => Int) excludedProducts!: number;
  @Field(() => [ExclusionGroupType]) exclusionGroups!: ExclusionGroupType[];
}

@ObjectType('Evaluation')
export class EvaluationType {
  @Field(() => ID) id!: string;
  @Field(() => ID) snapshotId!: string;
  @Field(() => Int) rulesetRevision!: number;
  @Field() engineVersion!: string;
  @Field() profileVersion!: string;
  @Field() status!: string;
  @Field(() => EvaluationCountsType, { nullable: true })
  counts!: EvaluationCountsType | null;
  @Field(() => String, { nullable: true }) resultChecksum!: string | null;
  @Field() createdAt!: string;
  @Field(() => String, { nullable: true }) startedAt!: string | null;
  @Field(() => String, { nullable: true }) finishedAt!: string | null;
  @Field(() => ApiErrorType, { nullable: true }) error!: ApiErrorType | null;
}

@ObjectType('EvaluationPage')
export class EvaluationPageType {
  @Field(() => [EvaluationType]) items!: EvaluationType[];
  @Field(() => PageInfoType) page!: PageInfoType;
}

/** Una fila evaluada, como en `GET …/evaluations/:id/rows`. */
@ObjectType('EvaluationRow')
export class EvaluationRowType {
  @Field(() => Int) sourceRow!: number;
  @Field() externalId!: string;
  @Field() outcome!: string;
  /** Los valores ya transformados por las reglas: `{ title, price, … }`. */
  @Field(() => JsonScalar, { nullable: true }) values!: unknown;
  @Field(() => [ProblemType]) problems!: ProblemType[];
  @Field(() => Int, { nullable: true }) excludedByRule!: number | null;
}

@ObjectType('EvaluationRowPage')
export class EvaluationRowPageType {
  @Field(() => [EvaluationRowType]) items!: EvaluationRowType[];
  @Field(() => PageInfoType) page!: PageInfoType;
}

/** Los filtros de `…/rows`: por resultado, por problema o por regla. */
@ArgsType()
export class EvaluationRowsArgs extends EvaluationRowsQueryDto {
  @Field(() => Int, { nullable: true }) declare limit?: number;
  @Field(() => Int, { nullable: true }) declare offset?: number;
  @Field(() => String, { nullable: true }) declare outcome?: RowOutcomeKind;
  @Field(() => String, { nullable: true })
  declare attribute?: ProblemAttribute;
  @Field(() => String, { nullable: true }) declare code?: ProblemCode;
  @Field(() => Int, { nullable: true }) declare rule?: number;
}

@InputType('RequestEvaluationInput')
export class RequestEvaluationInput extends CreateEvaluationDto {
  @Field(() => ID) declare snapshotId: string;
  @Field(() => Int) declare rulesetRevision: number;
}

/** Las reglas que se quieren probar y sobre qué catálogo. */
@InputType('RulesPreviewInput')
export class RulesPreviewInput extends RulesetInput {
  @Field(() => ID)
  @Allow()
  snapshotId!: string;

  /** Sin ella, se compara con la última revisión guardada. */
  @Field(() => Int, { nullable: true })
  @Allow()
  baseRevision?: number | null;
}

/**
 * La página de `rulesPreview`. `@Args()` sin nombre recibe todos los
 * argumentos: `projectId` e `input` llegan con su propio `@Args` y aquí solo se
 * dejan pasar (sin `@Field`: no se declaran dos veces).
 */
@ArgsType()
export class RulesPreviewPageArgs extends PaginationArgs {
  @Allow() projectId?: unknown;
  @Allow() input?: unknown;
}

@ObjectType('RulesPreviewCounts')
export class RulesPreviewCountsType {
  @Field(() => EvaluationCountsType) current!: EvaluationCountsType;
  @Field(() => EvaluationCountsType) proposed!: EvaluationCountsType;
}

@ObjectType('RulesPreviewProblems')
export class RulesPreviewProblemsType {
  @Field(() => [ProblemGroupType]) appeared!: ProblemGroupType[];
  @Field(() => [ProblemGroupType]) resolved!: ProblemGroupType[];
  @Field(() => [ProblemGroupType]) persisting!: ProblemGroupType[];
}

@ObjectType('OutcomeChange')
export class OutcomeChangeType {
  @Field() from!: string;
  @Field() to!: string;
  @Field(() => Int) productCount!: number;
}

@ObjectType('ChangedAttribute')
export class ChangedAttributeType {
  @Field() attribute!: string;
  @Field(() => Int) productCount!: number;
}

@ObjectType('PreviewedOutcome')
export class PreviewedOutcomeType {
  @Field() outcome!: string;
  @Field(() => [ProblemType]) problems!: ProblemType[];
  @Field(() => Int, { nullable: true }) excludedByRule!: number | null;
}

@ObjectType('ValueChange')
export class ValueChangeType {
  @Field() attribute!: string;
  @Field(() => String, { nullable: true }) before!: string | null;
  @Field(() => String, { nullable: true }) after!: string | null;
}

@ObjectType('ProductPreview')
export class ProductPreviewType {
  @Field(() => Int) sourceRow!: number;
  @Field() externalId!: string;
  @Field(() => PreviewedOutcomeType) current!: PreviewedOutcomeType;
  @Field(() => PreviewedOutcomeType) proposed!: PreviewedOutcomeType;
  @Field(() => [ValueChangeType]) values!: ValueChangeType[];
}

/** Qué cambiaría en un catálogo con unas reglas sin guardar. */
@ObjectType('RulesPreview')
export class RulesPreviewType {
  @Field(() => ID) snapshotId!: string;
  @Field(() => Int) baseRevision!: number;
  @Field(() => RulesPreviewCountsType) counts!: RulesPreviewCountsType;
  @Field(() => RulesPreviewProblemsType) problems!: RulesPreviewProblemsType;
  @Field(() => [OutcomeChangeType]) outcomeChanges!: OutcomeChangeType[];
  @Field(() => [ChangedAttributeType]) changedValues!: ChangedAttributeType[];
  @Field(() => Int) changedProducts!: number;
  @Field(() => [ProductPreviewType]) products!: ProductPreviewType[];
  @Field(() => PageInfoType) page!: PageInfoType;
}
