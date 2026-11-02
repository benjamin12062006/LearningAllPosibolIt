import type { ImportRow } from '../../catalog-import/import.types.js';
import {
  findProductProblems,
  isBlank,
  isProductAttribute,
  withNormalizedPrice,
  type CleanableAttribute,
  type ProductValues,
  type RowProblem,
} from './google-merchant.profile.js';
import {
  TEMPLATE_PLACEHOLDER,
  type AttributeMapping,
  type ExcludeWhenRule,
  type Rule,
  type Ruleset,
} from './ruleset.js';

/**
 * Versión del algoritmo de evaluación. Cada evaluación la guarda (RNF02), así
 * que cualquier cambio de comportamiento de este archivo obliga a subirla.
 *
 * 2: `clean_text` y `build_title` también colapsan U+0085 (ver `WHITESPACE_RUN`).
 */
export const ENGINE_VERSION = '2';

/** Moneda del proyecto congelada en el snapshot: la de la importación, no la actual. */
export type EvaluationContext = Readonly<{ currency: string }>;

type RowIdentity = Readonly<{ sourceRow: number; externalId: string }>;

/**
 * Resultado de una fila: exactamente uno de los tres, para que se cumpla
 * `válidos + inválidos + excluidos = total` (F2, inv. 3). Una fila excluida no
 * se valida. `excludedByRule` es la posición de la regla, empezando en 1.
 */
export type RowOutcome =
  | (RowIdentity & Readonly<{ outcome: 'valid'; values: ProductValues }>)
  | (RowIdentity &
      Readonly<{
        outcome: 'invalid';
        values: ProductValues;
        problems: readonly RowProblem[];
      }>)
  | (RowIdentity & Readonly<{ outcome: 'excluded'; excludedByRule: number }>);

type RulesResult =
  | Readonly<{ kind: 'kept'; values: ProductValues }>
  | Readonly<{ kind: 'excluded'; rulePosition: number }>;

/**
 * Espacios, tabuladores, saltos de línea y espacios Unicode como el no separable.
 * `\s` no incluye U+0085 (NEL), que el perfil trata como salto de línea
 * (`hasTabOrLineBreak`); se añade para que `clean_text` corrija todo lo que el
 * perfil marca como `TEXT_HAS_LINE_BREAK`.
 */
const WHITESPACE_RUN = /[\s\u0085]+/gu;

/**
 * Evalúa una fila del catálogo sin efectos: no lee la hora, la base ni el disco y
 * no modifica `row`, así que la misma entrada da siempre el mismo resultado
 * (RC7). Pasos: tomar los atributos mapeados, aplicar las reglas en orden y
 * validar el producto contra el perfil.
 */
export function evaluateRow(
  row: ImportRow,
  ruleset: Ruleset,
  context: EvaluationContext,
): RowOutcome {
  const identity = { sourceRow: row.sourceRow, externalId: row.externalId };
  const mapped = readMappedAttributes(row.originalValues, ruleset.mapping);

  const result = applyRules(mapped, row.externalId, ruleset.rules);
  if (result.kind === 'excluded') {
    return {
      ...identity,
      outcome: 'excluded',
      excludedByRule: result.rulePosition,
    };
  }

  const problems = findProductProblems(
    row.externalId,
    result.values,
    context.currency,
  );
  const values = withNormalizedPrice(result.values, context.currency);
  if (problems.length > 0) {
    return { ...identity, outcome: 'invalid', values, problems };
  }
  return { ...identity, outcome: 'valid', values };
}

function readMappedAttributes(
  originalValues: Readonly<Record<string, string>>,
  mapping: readonly AttributeMapping[],
): ProductValues {
  const values: ProductValues = {};
  for (const { attribute, column } of mapping) {
    // Las columnas se comprueban contra las cabeceras al aceptar la evaluación.
    // `hasOwn` evita leer del prototipo con nombres como `__proto__`.
    values[attribute] = Object.hasOwn(originalValues, column)
      ? originalValues[column]
      : '';
  }
  return values;
}

/** Recorrido fijo; cada regla recibe los valores que dejó la anterior (RC8). */
function applyRules(
  values: ProductValues,
  externalId: string,
  rules: readonly Rule[],
): RulesResult {
  let current = values;
  for (const [index, rule] of rules.entries()) {
    switch (rule.type) {
      case 'clean_text':
        current = cleanAttributes(current, rule.attributes);
        break;
      case 'build_title':
        current = {
          ...current,
          title: buildTitle(rule.template, current, externalId),
        };
        break;
      case 'exclude_when':
        if (matchesCondition(rule, current, externalId)) {
          return { kind: 'excluded', rulePosition: index + 1 };
        }
        break;
      default:
        return unknownRule(rule);
    }
  }
  return { kind: 'kept', values: current };
}

/**
 * Solo limpia los atributos que tienen valor: limpiar uno sin mapear no debe
 * crearlo vacío.
 */
function cleanAttributes(
  values: ProductValues,
  attributes: readonly CleanableAttribute[],
): ProductValues {
  const cleaned = { ...values };
  for (const attribute of attributes) {
    const value = cleaned[attribute];
    if (value !== undefined) {
      cleaned[attribute] = cleanText(value);
    }
  }
  return cleaned;
}

/**
 * NFC une un carácter y su acento combinado en uno solo (F26). NFKC no se usa:
 * cambiaría caracteres de compatibilidad, como `ﬁ` por `fi`.
 */
function cleanText(value: string) {
  return collapseWhitespace(value.normalize('NFC'));
}

/** No recorta a 150 caracteres: un título largo se informa al validar (D4). */
function buildTitle(
  template: string,
  values: ProductValues,
  externalId: string,
) {
  const title = template.replace(TEMPLATE_PLACEHOLDER, (_placeholder, name) =>
    readAttribute(name, values, externalId),
  );
  return collapseWhitespace(title);
}

/** Comparación exacta y sensible a mayúsculas; no depende del idioma del sistema. */
function matchesCondition(
  rule: ExcludeWhenRule,
  values: ProductValues,
  externalId: string,
) {
  const value = readAttribute(rule.attribute, values, externalId);
  switch (rule.operator) {
    case 'equals':
      return value === rule.value;
    case 'not_equals':
      return value !== rule.value;
    case 'contains':
      return value.includes(rule.value);
    case 'is_empty':
      return isBlank(value);
  }
}

/** `id` se lee siempre del snapshot; un nombre desconocido o sin valor da `''`. */
function readAttribute(
  name: string,
  values: ProductValues,
  externalId: string,
): string {
  if (name === 'id') {
    return externalId;
  }
  if (isProductAttribute(name)) {
    return values[name] ?? '';
  }
  return '';
}

function collapseWhitespace(value: string) {
  return value.replace(WHITESPACE_RUN, ' ').trim();
}

/**
 * Si se añade un tipo a `Rule` sin tratarlo en `applyRules`, TypeScript falla
 * aquí al compilar. Añadirlo también obliga a subir `ENGINE_VERSION`.
 */
function unknownRule(rule: never): never {
  throw new Error(`Tipo de regla no soportado: ${JSON.stringify(rule)}`);
}
