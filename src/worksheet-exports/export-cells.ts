import { isCanonicalValue } from '../worksheets/cell-values.js';
import type { WorksheetColumn } from '../worksheets/worksheets.types.js';

/**
 * Una celda lista para escribir en un archivo. El formato decide cómo se
 * escribe cada tipo; aquí solo se decide qué tipo es sin perder el valor.
 */
export type ExportCell =
  | Readonly<{ kind: 'empty' }>
  | Readonly<{ kind: 'text'; text: string }>
  /** Texto decimal canónico que un `double` guarda sin redondear. */
  | Readonly<{ kind: 'number'; text: string }>
  /** `YYYY-MM-DD` desde el 1900-03-01, la primera fecha fiable de Excel. */
  | Readonly<{ kind: 'date'; text: string }>
  | Readonly<{ kind: 'boolean'; value: boolean }>;

/**
 * IEEE 754 garantiza 15 cifras decimales: un número con más pierde dígitos al
 * guardarse como número en Excel. Se escribe como texto para no redondearlo
 * ([12], «nunca trunca, redondea o borra silenciosamente»).
 */
export const MAX_EXACT_DIGITS = 15;

/**
 * En el sistema 1900 de Excel, las series anteriores a la 61 cuentan el 29 de
 * febrero de 1900, que no existió (ficha 02 de imports&exports): una fecha
 * anterior se escribe como texto.
 */
export const FIRST_EXCEL_DATE = '1900-03-01';

const EMPTY: ExportCell = { kind: 'empty' };

/**
 * La celda de una columna a partir del valor ya evaluado (las calculadas ya
 * tienen su resultado). Un valor guardado que no tiene la forma de su columna
 * se exporta como texto: se ve tal cual en lugar de desaparecer.
 */
export function exportCell(
  column: WorksheetColumn,
  value: unknown,
): ExportCell {
  if (value === null || value === undefined) {
    return EMPTY;
  }
  if (isCalculatedResult(column, value)) {
    return numberCell(value);
  }
  if (!isCanonicalValue(column, value)) {
    return { kind: 'text', text: textOf(value) };
  }

  switch (column.type) {
    case 'integer':
    case 'decimal':
      return numberCell(String(value));
    case 'date':
      return dateCell(String(value));
    case 'boolean':
      return { kind: 'boolean', value: value === true };
    case 'selection':
      return { kind: 'text', text: selectionLabel(column, String(value)) };
    default:
      return { kind: 'text', text: String(value) };
  }
}

/** El texto que se ve de una celda, el mismo en cualquier formato. */
export function cellText(cell: ExportCell): string {
  switch (cell.kind) {
    case 'empty':
      return '';
    case 'boolean':
      return cell.value ? 'true' : 'false';
    default:
      return cell.text;
  }
}

/** El motor de cálculo devuelve el resultado como decimal en texto. */
function isCalculatedResult(
  column: WorksheetColumn,
  value: unknown,
): value is string {
  return column.type === 'calculated' && typeof value === 'string';
}

function numberCell(text: string): ExportCell {
  if (significantDigits(text) > MAX_EXACT_DIGITS) {
    return { kind: 'text', text };
  }
  return { kind: 'number', text };
}

function dateCell(text: string): ExportCell {
  // `YYYY-MM-DD` se ordena igual como texto que como fecha.
  if (text < FIRST_EXCEL_DATE) {
    return { kind: 'text', text };
  }
  return { kind: 'date', text };
}

/**
 * Cifras que tiene que guardar el número: sin signo, sin ceros a la izquierda
 * y sin ceros finales de la parte decimal (`0012.50` → `125`, tres cifras). Los
 * ceros finales de la parte entera cuentan: `1000` necesita cuatro.
 */
function significantDigits(text: string) {
  const [integerPart, fraction = ''] = text.replace('-', '').split('.');
  const digits = `${integerPart}${fraction.replace(/0+$/, '')}`;
  return digits.replace(/^0+/, '').length;
}

function selectionLabel(column: WorksheetColumn, optionId: string) {
  const option = (column.options ?? []).find(({ id }) => id === optionId);
  return option?.label ?? optionId;
}

function textOf(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}
