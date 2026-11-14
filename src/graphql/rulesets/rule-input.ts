import { Field, InputType } from '@nestjs/graphql';
import { Allow } from 'class-validator';

/*
 * Reglas por GraphQL (plan C7, G6). Cada tipo de regla es un campo de
 * `RuleInput` con `@oneOf`: GraphQL rechaza dos o ninguno antes del resolver.
 * Los valores van como texto y no como enumerados: el resolver arma el cuerpo
 * REST y lo valida con el DTO REST (`validateAs`), así un atributo desconocido
 * da el mismo error y el mismo campo (`rules.2.attributes`) que en REST.
 */

@InputType('AttributeMappingInput')
export class AttributeMappingInput {
  @Field() attribute!: string;
  @Field() column!: string;
}

@InputType('CleanTextRuleInput')
export class CleanTextRuleInput {
  @Field(() => [String]) attributes!: string[];
}

@InputType('BuildTitleRuleInput')
export class BuildTitleRuleInput {
  @Field() template!: string;
}

@InputType('ExcludeWhenRuleInput')
export class ExcludeWhenRuleInput {
  @Field() attribute!: string;
  @Field() operator!: string;
  /** Sin valor solo con `is_empty`, como en REST. */
  @Field(() => String, { nullable: true }) value?: string | null;
}

@InputType('RuleInput', {
  isOneOf: true,
  description: 'Una regla: exactamente uno de los tres tipos.',
})
export class RuleInput {
  @Field(() => CleanTextRuleInput, { nullable: true })
  cleanText?: CleanTextRuleInput;

  @Field(() => BuildTitleRuleInput, { nullable: true })
  buildTitle?: BuildTitleRuleInput;

  @Field(() => ExcludeWhenRuleInput, { nullable: true })
  excludeWhen?: ExcludeWhenRuleInput;
}

/**
 * `@Allow()` solo deja pasar los campos por el `ValidationPipe` global; la
 * validación de verdad es la del DTO REST, en el resolver.
 */
@InputType('RulesetInput')
export class RulesetInput {
  @Field(() => [AttributeMappingInput])
  @Allow()
  mapping!: AttributeMappingInput[];

  @Field(() => [RuleInput])
  @Allow()
  rules!: RuleInput[];
}

/** El cuerpo de `POST …/rulesets` con esas reglas: `{ mapping, rules: [{ type, … }] }`. */
export function toRulesetBody(input: RulesetInput) {
  return {
    mapping: input.mapping.map(({ attribute, column }) => ({
      attribute,
      column,
    })),
    rules: input.rules.map(toRuleBody),
  };
}

function toRuleBody(rule: RuleInput) {
  if (rule.cleanText) {
    return { type: 'clean_text', attributes: rule.cleanText.attributes };
  }
  if (rule.buildTitle) {
    return { type: 'build_title', template: rule.buildTitle.template };
  }
  // `@oneOf` garantiza que llega uno de los tres.
  const { attribute, operator, value } = rule.excludeWhen!;
  return {
    type: 'exclude_when',
    attribute,
    operator,
    // En GraphQL `null` y no mandarlo son lo mismo; en REST, solo lo segundo.
    ...(value === null || value === undefined ? {} : { value }),
  };
}
