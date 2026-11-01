import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsObject,
  IsString,
  Length,
  ValidateBy,
  ValidateNested,
} from 'class-validator';
import {
  CLEANABLE_ATTRIBUTES,
  PRODUCT_ATTRIBUTES,
  type CleanableAttribute,
  type ProductAttribute,
} from '../evaluations/engine/google-merchant.profile.js';
import {
  EXCLUDE_OPERATORS,
  RULE_TYPES,
  type ConditionAttribute,
  type ExcludeOperator,
  type RuleType,
} from '../evaluations/engine/ruleset.js';

/** Límites del body (plan D2–D4). */
export const RULESET_LIMITS = {
  /** Uno por atributo del perfil: más pares solo pueden ser repetidos. */
  mappings: PRODUCT_ATTRIBUTES.length,
  /** El mismo máximo que una cabecera de la importación. */
  columnLength: 128,
  rules: 20,
  cleanAttributes: 5,
  templateLength: 300,
  conditionValueLength: 200,
} as const;

const CONDITION_ATTRIBUTES: readonly ConditionAttribute[] = [
  'id',
  ...PRODUCT_ATTRIBUTES,
];

/**
 * Body de `POST /projects/:projectId/rulesets`. La coherencia entre mapeo y
 * reglas (atributos repetidos, referencias, obligatorios) no se comprueba aquí,
 * sino en el servicio con `findRulesetIssues`.
 */
export class CreateRulesetDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(RULESET_LIMITS.mappings)
  @ValidateNested({ each: true })
  @Type(() => AttributeMappingDto)
  mapping!: AttributeMappingDto[];

  /** Puede ir vacío: una versión solo con mapeo ya permite validar el catálogo. */
  @IsArray()
  @ArrayMaxSize(RULESET_LIMITS.rules)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Transform(({ obj }) => toRuleDtos(obj.rules), { toClassOnly: true })
  rules!: RuleDto[];
}

export class AttributeMappingDto {
  @IsIn(PRODUCT_ATTRIBUTES)
  attribute!: ProductAttribute;

  @IsString()
  @Length(1, RULESET_LIMITS.columnLength)
  column!: string;
}

/**
 * Base de todas las reglas: solo valida `type`. Una regla con un tipo
 * desconocido se queda en esta clase, falla aquí y sus demás campos se
 * rechazan por no estar declarados (ficha 05, F27 y F29).
 */
export class RuleDto {
  @IsIn(RULE_TYPES)
  type!: RuleType;
}

export class CleanTextRuleDto extends RuleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(RULESET_LIMITS.cleanAttributes)
  @ArrayUnique()
  @IsIn(CLEANABLE_ATTRIBUTES, { each: true })
  attributes!: CleanableAttribute[];
}

export class BuildTitleRuleDto extends RuleDto {
  @IsString()
  @Length(1, RULESET_LIMITS.templateLength)
  template!: string;
}

export class ExcludeWhenRuleDto extends RuleDto {
  @IsIn(CONDITION_ATTRIBUTES)
  attribute!: ConditionAttribute;

  @IsIn(EXCLUDE_OPERATORS)
  operator!: ExcludeOperator;

  @IsConditionValue()
  value?: string;
}

const RULE_DTO_CLASSES = new Map<string, typeof RuleDto>([
  ['clean_text', CleanTextRuleDto],
  ['build_title', BuildTitleRuleDto],
  ['exclude_when', ExcludeWhenRuleDto],
]);

/**
 * Elige a mano la clase de cada regla según su `type`. No se usa el
 * discriminador de `@Type`: con un elemento `null` lanza un `TypeError` antes de
 * validar y la API respondería 500 (ficha 05, F27–F29). Lo que no es un objeto
 * se deja igual para que `@IsObject` lo rechace con 400.
 */
function toRuleDtos(rules: unknown): unknown {
  return Array.isArray(rules) ? rules.map(toRuleDto) : rules;
}

function toRuleDto(rule: unknown): unknown {
  if (!isPlainObject(rule)) {
    return rule;
  }
  // `Map.get` no mira el prototipo: `"__proto__"` no resuelve a ninguna clase.
  const ruleClass =
    typeof rule.type === 'string' ? RULE_DTO_CLASSES.get(rule.type) : undefined;
  return plainToInstance(ruleClass ?? RuleDto, rule);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `is_empty` no compara con nada: si llega `value`, debe ir vacío. Los demás
 * operadores lo exigen con al menos un carácter, porque `contains ''` excluiría
 * todas las filas.
 */
function IsConditionValue() {
  return ValidateBy({
    name: 'isConditionValue',
    validator: {
      validate: (value: unknown, args) =>
        isValidConditionValue(value, args?.object),
    },
  });
}

function isValidConditionValue(value: unknown, rule: unknown) {
  if (rule instanceof ExcludeWhenRuleDto && rule.operator === 'is_empty') {
    return value === undefined || value === '';
  }
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= RULESET_LIMITS.conditionValueLength
  );
}
