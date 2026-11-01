import {
  CLEANABLE_ATTRIBUTES,
  PRODUCT_ATTRIBUTES,
  REQUIRED_ATTRIBUTES,
  type CleanableAttribute,
  type ProductAttribute,
} from './google-merchant.profile.js';

export const RULE_TYPES = [
  'clean_text',
  'build_title',
  'exclude_when',
] as const;

export type RuleType = (typeof RULE_TYPES)[number];

export const EXCLUDE_OPERATORS = [
  'equals',
  'not_equals',
  'contains',
  'is_empty',
] as const;

export type ExcludeOperator = (typeof EXCLUDE_OPERATORS)[number];

/** Una condición puede leer `id`, pero ninguna regla lo escribe (F2, inv. 2). */
export type ConditionAttribute = ProductAttribute | 'id';

export type AttributeMapping = Readonly<{
  attribute: ProductAttribute;
  column: string;
}>;

export type CleanTextRule = Readonly<{
  type: 'clean_text';
  attributes: readonly CleanableAttribute[];
}>;

export type BuildTitleRule = Readonly<{
  type: 'build_title';
  template: string;
}>;

/** Con `is_empty` no se usa `value`; el DTO lo exige vacío. */
export type ExcludeWhenRule = Readonly<{
  type: 'exclude_when';
  attribute: ConditionAttribute;
  operator: ExcludeOperator;
  value: string;
}>;

/** Unión discriminada por `type` (RC6): el motor decide qué hacer por su valor. */
export type Rule = CleanTextRule | BuildTitleRule | ExcludeWhenRule;

/** Mapeo y reglas de una revisión. Las reglas se aplican en el orden del arreglo. */
export type Ruleset = Readonly<{
  mapping: readonly AttributeMapping[];
  rules: readonly Rule[];
}>;

/** `{atributo}` dentro de una plantilla; una llave suelta se queda como texto. */
export const TEMPLATE_PLACEHOLDER = /\{([^{}]*)\}/g;

export type RulesetIssueCode =
  'MAPPING_DUPLICATE' | 'REFERENCE_INVALID' | 'REQUIRED_ATTRIBUTE_MISSING';

/** `rulePosition` empieza en 1, como `sourceRow`. */
export type RulesetIssue = Readonly<{
  code: RulesetIssueCode;
  attribute: string;
  rulePosition?: number;
}>;

/**
 * Comprueba lo que el DTO no ve mirando cada regla por separado: que el mapeo no
 * repita atributos, que cada regla solo use atributos disponibles en su posición
 * y que al final estén todos los obligatorios. Sin problemas, devuelve `[]`.
 */
export function findRulesetIssues(ruleset: Ruleset): RulesetIssue[] {
  const issues = findDuplicateMappings(ruleset.mapping);
  const available = new Set<string>([
    'id',
    ...ruleset.mapping.map((mapping) => mapping.attribute),
  ]);

  ruleset.rules.forEach((rule, index) => {
    for (const attribute of referencedAttributes(rule)) {
      if (!available.has(attribute)) {
        issues.push({
          code: 'REFERENCE_INVALID',
          attribute,
          rulePosition: index + 1,
        });
      }
    }
    // Solo cuenta para las reglas siguientes: una regla anterior no puede
    // usar un título que todavía no existe.
    if (rule.type === 'build_title') {
      available.add('title');
    }
  });

  for (const attribute of REQUIRED_ATTRIBUTES) {
    if (!available.has(attribute)) {
      issues.push({ code: 'REQUIRED_ATTRIBUTE_MISSING', attribute });
    }
  }
  return issues;
}

/** Nombres entre llaves de una plantilla, en orden y con repeticiones. */
export function templatePlaceholders(template: string): string[] {
  return Array.from(
    template.matchAll(TEMPLATE_PLACEHOLDER),
    (match) => match[1],
  );
}

function findDuplicateMappings(
  mapping: readonly AttributeMapping[],
): RulesetIssue[] {
  const seen = new Set<string>();
  const issues: RulesetIssue[] = [];
  for (const { attribute } of mapping) {
    if (seen.has(attribute)) {
      issues.push({ code: 'MAPPING_DUPLICATE', attribute });
    }
    seen.add(attribute);
  }
  return issues;
}

function referencedAttributes(rule: Rule): readonly string[] {
  switch (rule.type) {
    case 'clean_text':
      return rule.attributes;
    case 'build_title':
      return templatePlaceholders(rule.template);
    case 'exclude_when':
      return [rule.attribute];
  }
}

/**
 * Comprueba la forma de un ruleset leído de la base. Prisma no tipa los campos
 * `Json` (F25): lo guardado se mira antes de dárselo al motor.
 */
export function isRuleset(value: unknown): value is Ruleset {
  return (
    isRecord(value) &&
    Array.isArray(value.mapping) &&
    value.mapping.every(isAttributeMapping) &&
    Array.isArray(value.rules) &&
    value.rules.every(isRule)
  );
}

function isAttributeMapping(value: unknown): value is AttributeMapping {
  return (
    isRecord(value) &&
    isOneOf(PRODUCT_ATTRIBUTES, value.attribute) &&
    typeof value.column === 'string'
  );
}

function isRule(value: unknown): value is Rule {
  if (!isRecord(value)) {
    return false;
  }
  switch (value.type) {
    case 'clean_text':
      return (
        Array.isArray(value.attributes) &&
        value.attributes.every((attribute) =>
          isOneOf(CLEANABLE_ATTRIBUTES, attribute),
        )
      );
    case 'build_title':
      return typeof value.template === 'string';
    case 'exclude_when':
      return (
        (value.attribute === 'id' ||
          isOneOf(PRODUCT_ATTRIBUTES, value.attribute)) &&
        isOneOf(EXCLUDE_OPERATORS, value.operator) &&
        typeof value.value === 'string'
      );
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(
  options: readonly T[],
  value: unknown,
): value is T {
  const names: readonly string[] = options;
  return typeof value === 'string' && names.includes(value);
}
