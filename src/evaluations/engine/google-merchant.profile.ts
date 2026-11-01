import { normalizePrice, type PriceProblemCode } from './price.js';

/**
 * Versión del perfil de Google Merchant Center que aplica este archivo. La fecha
 * es la de consulta de la especificación (F19). Cada evaluación la guarda
 * (RNF02), así que cambiar cualquier regla de este archivo obliga a cambiarla.
 */
export const PROFILE_VERSION = 'google_merchant@2026-10-31';

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

/** Vacío o solo espacios: para Google no hay valor. */
export function isBlank(value: string | undefined) {
  return value === undefined || value.trim() === '';
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
  if (isTooLong(externalId, MAX_LENGTHS.id)) {
    problems.push({ attribute: 'id', code: 'TEXT_TOO_LONG' });
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
      return isTooLong(value, MAX_LENGTHS[attribute]) ? 'TEXT_TOO_LONG' : null;
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
