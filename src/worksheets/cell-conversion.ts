import {
  isCanonicalValue,
  type CellLiteral,
  type ValueRules,
} from './cell-values.js';

/** El valor ya convertido o, si no tiene forma exacta en el tipo nuevo, incompatible. */
export type ConvertedValue =
  | Readonly<{ kind: 'value'; value: CellLiteral }>
  | Readonly<{ kind: 'incompatible' }>;

const INCOMPATIBLE: ConvertedValue = { kind: 'incompatible' };

/** Un decimal sin nada distinto de cero detrás del punto: `10.00` es `10`. */
const WHOLE_DECIMAL_PATTERN = /^(-?\d+)\.0+$/;

/**
 * Convierte un valor guardado al cambiar el tipo de su columna (C5, ficha 02
 * de cierre). El valor pasa a su texto visible y ese texto se lee con las
 * reglas estrictas del tipo nuevo: sin recortar espacios y sin redondear
 * ([12], «nunca trunca, redondea o borra silenciosamente»).
 */
export function convertValue(
  from: ValueRules,
  to: ValueRules,
  value: CellLiteral,
): ConvertedValue {
  const text = visibleText(from, value);
  if (text === null) {
    return INCOMPATIBLE;
  }
  const candidate = candidateOf(from, to, text);
  if (candidate === null || !isCanonicalValue(to, candidate)) {
    return INCOMPATIBLE;
  }
  return { kind: 'value', value: candidate };
}

/** El texto que se ve: el mismo que exporta E5.3. `null` si el valor no es de su tipo. */
function visibleText(column: ValueRules, value: CellLiteral): string | null {
  if (!isCanonicalValue(column, value)) {
    return null;
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (column.type === 'selection') {
    return column.options?.find(({ id }) => id === value)?.label ?? null;
  }
  return value;
}

/**
 * Texto → valor del tipo nuevo, con las reglas de E5.1 (punto decimal y
 * `true`/`false`). Un texto vacío no tiene forma en ningún otro tipo (ninguna
 * etiqueta está vacía), así que queda incompatible: vaciar una celda lo decide
 * la persona, no la conversión.
 */
function candidateOf(
  from: ValueRules,
  to: ValueRules,
  text: string,
): CellLiteral | null {
  switch (to.type) {
    case 'text':
      return text;
    case 'integer':
      return from.type === 'decimal' ? wholeNumberOf(text) : text;
    case 'boolean':
      return booleanOf(text);
    case 'selection':
      return to.options?.find(({ label }) => label === text)?.id ?? null;
    default:
      return text;
  }
}

/** `10.00` → `10`; `10.50` no es un entero y no se redondea. */
function wholeNumberOf(decimal: string): string | null {
  const whole = WHOLE_DECIMAL_PATTERN.exec(decimal);
  if (whole) {
    return whole[1];
  }
  return decimal.includes('.') ? null : decimal;
}

function booleanOf(text: string): boolean | null {
  if (text === 'true') {
    return true;
  }
  if (text === 'false') {
    return false;
  }
  return null;
}
