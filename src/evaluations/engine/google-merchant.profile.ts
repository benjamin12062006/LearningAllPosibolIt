import { normalizePrice, type PriceProblemCode } from './price.js';

/**
 * Versión del perfil de Google Merchant Center que aplica este archivo. La fecha
 * es la de consulta de la especificación (F19). Cada evaluación la guarda
 * (RNF02), así que cambiar cualquier regla de este archivo obliga a cambiarla.
 *
 * 2026-11-01: valores que no caben en un TSV (`TEXT_HAS_LINE_BREAK`,
 * `TEXT_STARTS_WITH_QUOTE`), con la fecha de consulta del formato delimitado de
 * Google (fuente F18 de reviews&exports). Las evaluaciones anteriores no se
 * pueden exportar hasta repetirlas.
 */
export const PROFILE_VERSION = 'google_merchant@2026-11-01';

/** Atributos que se pueden mapear desde una columna. `id` no: sale de `idColumn`. */
export const PRODUCT_ATTRIBUTES = [
  'title',
  'description',
  'link',
  'image_link',
  'price',
  'availability',
  'condition',
  'brand',
] as const;

export type ProductAttribute = (typeof PRODUCT_ATTRIBUTES)[number];

/** Obligatorios para Google (F19): deben estar mapeados o producirlos una regla. */
export const REQUIRED_ATTRIBUTES: readonly ProductAttribute[] = [
  'title',
  'description',
  'link',
  'image_link',
  'price',
  'availability',
];

/**
 * Atributos que `clean_text` puede limpiar. Enlaces y precio no: colapsar sus
 * espacios cambiaría el valor en lugar de limpiarlo.
 */
export const CLEANABLE_ATTRIBUTES = [
  'title',
  'description',
  'brand',
  'availability',
  'condition',
] as const;

export type CleanableAttribute = (typeof CLEANABLE_ATTRIBUTES)[number];

export type ProductValues = Partial<Record<ProductAttribute, string>>;

export type ProblemAttribute = ProductAttribute | 'id';

export type ProblemCode =
  | 'FIELD_MISSING'
  | 'TEXT_TOO_LONG'
  | 'TEXT_HAS_LINE_BREAK'
  | 'TEXT_STARTS_WITH_QUOTE'
  | 'URL_INVALID'
  | 'AVAILABILITY_INVALID'
  | 'AVAILABILITY_DATE_REQUIRED'
  | 'CONDITION_INVALID'
  | PriceProblemCode;

export type RowProblem = Readonly<{
  attribute: ProblemAttribute;
  code: ProblemCode;
}>;

/**
 * Máximo de caracteres de cada atributo de texto según la especificación (F19).
 * El informe lo usa para sugerir a cuánto acortar.
 */
export const MAX_LENGTHS = {
  id: 50,
  title: 150,
  description: 5000,
  brand: 70,
} as const;

const AVAILABILITY_VALUES: readonly string[] = ['in_stock', 'out_of_stock'];

/** Google los admite, pero exigen `availability_date`, que v1 no mapea. */
const AVAILABILITY_VALUES_NEEDING_DATE: readonly string[] = [
  'preorder',
  'backorder',
];

const CONDITION_VALUES: readonly string[] = ['new', 'refurbished', 'used'];

const WEB_PROTOCOLS: readonly string[] = ['http:', 'https:'];

const PRODUCT_ATTRIBUTE_NAMES: ReadonlySet<string> = new Set(
  PRODUCT_ATTRIBUTES,
);

export function isProductAttribute(name: string): name is ProductAttribute {
  return PRODUCT_ATTRIBUTE_NAMES.has(name);
}

/** Comprueba valores leídos de `jsonb`: solo atributos del perfil con texto. */
export function isProductValues(value: unknown): value is ProductValues {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([key, item]) => isProductAttribute(key) && typeof item === 'string',
    )
  );
}

/** Vacío o solo espacios: para Google no hay valor. */
export function isBlank(value: string | undefined) {
  return value === undefined || value.trim() === '';
}

/**
 * Tabulador o salto de línea. Google no los admite dentro de un valor de un
 * archivo delimitado y la IANA tampoco en un TSV (fuentes F18 y F21 de
 * reviews&exports). Google no enumera qué cuenta como salto de línea: además de
 * `\n` y `\r` se incluyen `\v`, `\f`, U+0085 (NEL), U+2028 y U+2029, para no
 * depender de cómo los interprete (plan de reviews y exports, D5; propuesta
 * propia).
 */
const TAB_OR_LINE_BREAK = /[\t\n\r\v\f\u0085\u2028\u2029]/u;

/** El valor partiría su línea o su columna en un archivo delimitado por tabuladores. */
export function hasTabOrLineBreak(value: string) {
  return TAB_OR_LINE_BREAK.test(value);
}

/**
 * Con los «campos entrecomillados» de Google activados (fuente F19 de
 * reviews&exports), una comilla al principio abre un campo entrecomillado; sin
 * ellos, es un carácter más. Como no se sabe cómo está configurada la fuente del
 * cliente, un valor así no se exporta (plan de reviews y exports, D5).
 */
export function startsWithQuote(value: string) {
  return value.startsWith('"');
}

/**
 * Problemas de un producto ya transformado por las reglas, como mucho uno por
 * atributo y siempre en el mismo orden (el de `PRODUCT_ATTRIBUTES`), para que
 * dos evaluaciones iguales produzcan el mismo informe.
 */
export function findProductProblems(
  externalId: string,
  values: ProductValues,
  currency: string,
): RowProblem[] {
  const problems: RowProblem[] = [];
  const idProblem = findFreeTextProblem(externalId, MAX_LENGTHS.id);
  if (idProblem !== null) {
    problems.push({ attribute: 'id', code: idProblem });
  }

  for (const attribute of PRODUCT_ATTRIBUTES) {
    const code = findAttributeProblem(attribute, values[attribute], currency);
    if (code !== null) {
      problems.push({ attribute, code });
    }
  }
  return problems;
}

/** Los mismos valores con el precio en el formato del canal cuando es válido. */
export function withNormalizedPrice(
  values: ProductValues,
  currency: string,
): ProductValues {
  if (values.price === undefined) {
    return values;
  }
  const price = normalizePrice(values.price, currency);
  return price.ok ? { ...values, price: price.value } : values;
}

function findAttributeProblem(
  attribute: ProductAttribute,
  value: string | undefined,
  currency: string,
): ProblemCode | null {
  if (value === undefined || isBlank(value)) {
    return REQUIRED_ATTRIBUTES.includes(attribute) ? 'FIELD_MISSING' : null;
  }

  switch (attribute) {
    case 'title':
    case 'description':
    case 'brand':
      return findFreeTextProblem(value, MAX_LENGTHS[attribute]);
    case 'link':
    case 'image_link':
      return isWebUrl(value) ? null : 'URL_INVALID';
    case 'availability':
      return findAvailabilityProblem(value);
    case 'condition':
      return CONDITION_VALUES.includes(value) ? null : 'CONDITION_INVALID';
    case 'price': {
      const price = normalizePrice(value, currency);
      return price.ok ? null : price.code;
    }
  }
}

/**
 * Problema de un texto libre (`id`, `title`, `description`, `brand`). Si hay
 * varios, se informa primero lo que impide escribir el valor en el TSV (D5 de
 * reviews&exports): `clean_text` corrige el salto de línea y a la vez puede
 * acortar el texto, así que la longitud se mide después.
 */
function findFreeTextProblem(
  value: string,
  maxLength: number,
): ProblemCode | null {
  if (hasTabOrLineBreak(value)) {
    return 'TEXT_HAS_LINE_BREAK';
  }
  if (startsWithQuote(value)) {
    return 'TEXT_STARTS_WITH_QUOTE';
  }
  if (isTooLong(value, maxLength)) {
    return 'TEXT_TOO_LONG';
  }
  return null;
}

/**
 * Cuenta puntos de código Unicode, no unidades UTF-16: con `length`, un emoji
 * como 🪑 contaría como dos y un título válido se daría por largo. Google no
 * precisa la unidad (F19). `Intl.Segmenter` (grafemas) se descarta: sus reglas
 * vienen con la versión de ICU de Node y el conteo podría cambiar al actualizar
 * Node, rompiendo la reproducibilidad (RNF02). Coste: un emoji compuesto, como
 * 👨‍👩‍👧, cuenta como varios caracteres.
 */
function isTooLong(value: string, maxLength: number) {
  // oxlint-disable-next-line typescript/no-misused-spread -- ver comentario de la función.
  return [...value].length > maxLength;
}

/**
 * `URL.parse` quita los espacios de alrededor antes de analizar, pero el canal
 * recibiría el valor original; por eso se rechaza cualquier espacio.
 */
function isWebUrl(value: string) {
  if (/\s/u.test(value)) {
    return false;
  }
  const url = URL.parse(value);
  return url !== null && WEB_PROTOCOLS.includes(url.protocol);
}

function findAvailabilityProblem(value: string): ProblemCode | null {
  if (AVAILABILITY_VALUES.includes(value)) {
    return null;
  }
  if (AVAILABILITY_VALUES_NEEDING_DATE.includes(value)) {
    return 'AVAILABILITY_DATE_REQUIRED';
  }
  return 'AVAILABILITY_INVALID';
}
