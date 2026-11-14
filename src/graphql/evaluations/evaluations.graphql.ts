import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { JsonScalar } from '../common/json.scalar.js';

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

/** Un problema en un atributo y cuántos productos lo tienen. */
@ObjectType('ProblemGroup')
export class ProblemGroupType {
  @Field() attribute!: string;
  @Field() code!: string;
  @Field(() => Int) productCount!: number;
  @Field(() => LocalizedTextType) problem!: LocalizedTextType;
  @Field(() => LocalizedTextType) suggestion!: LocalizedTextType;
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
  @Field() status!: string;
  @Field(() => EvaluationCountsType, { nullable: true })
  counts!: EvaluationCountsType | null;
  @Field(() => String, { nullable: true }) resultChecksum!: string | null;
  @Field() createdAt!: string;
  @Field(() => String, { nullable: true }) finishedAt!: string | null;
}
