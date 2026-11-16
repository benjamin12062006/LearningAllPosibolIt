import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { JsonScalar } from '../common/json.scalar.js';
import { PageInfoType } from '../common/page-info.type.js';

@ObjectType('AttributeMapping')
export class AttributeMappingType {
  @Field() attribute!: string;
  @Field() column!: string;
}

/** Una revisión guardada: no cambia; corregir reglas crea la siguiente. */
@ObjectType('Ruleset')
export class RulesetType {
  @Field(() => ID) id!: string;
  @Field(() => Int) revision!: number;
  @Field(() => [AttributeMappingType]) mapping!: AttributeMappingType[];
  /** Cada regla como en REST: `{ type, … }`. */
  @Field(() => [JsonScalar]) rules!: unknown[];
  @Field() createdAt!: string;
}

@ObjectType('RulesetPage')
export class RulesetPageType {
  @Field(() => [RulesetType]) items!: RulesetType[];
  @Field(() => PageInfoType) page!: PageInfoType;
}
