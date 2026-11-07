import { cellText, type ExportCell } from './export-cells.js';

export type CsvDelimiter = ',' | ';';

/**
 * `escape` antepone un apóstrofo a los textos que una hoja de cálculo leería
 * como fórmula (OWASP, F8); `keep` los deja tal cual para quien lee el CSV con
 * un programa y no con una hoja de cálculo.
 */
export type CsvFormulaPolicy = 'escape' | 'keep';

export type CsvWriteOptions = Readonly<{
  delimiter: CsvDelimiter;
  formulas: CsvFormulaPolicy;
}>;

/** Excel solo reconoce un CSV como UTF-8 si empieza por la marca de orden de bytes. */
export const CSV_BOM = '\uFEFF';

/** RFC 4180: cada registro termina en CRLF. */
const RECORD_END = '\r\n';

/**
 * Primeros caracteres con los que una hoja de cálculo empieza una fórmula,
 * también sus variantes de ancho completo (OWASP, F8): `=`, `+`, `-`, `@`,
 * tabulador, retorno de carro y salto de línea.
 */
const FORMULA_START_PATTERN = /^[=+\-@\t\r\n\uFF1D\uFF0B\uFF0D\uFF20]/;

/** Un campo así necesita comillas: contiene comillas o un salto de línea. */
const NEEDS_QUOTES_PATTERN = /["\r\n]/;

/** La cabecera: los nombres son texto escrito por personas, como cualquier celda de texto. */
export function csvHeader(names: readonly string[], options: CsvWriteOptions) {
  return csvRecord(
    names.map((name) => ({ kind: 'text', text: name })),
    options,
  );
}

export function csvRecord(
  cells: readonly ExportCell[],
  options: CsvWriteOptions,
) {
  const fields = cells.map((cell) => csvField(cell, options));
  return `${fields.join(options.delimiter)}${RECORD_END}`;
}

/**
 * Solo se protegen las celdas de texto: un número, una fecha o un booleano ya
 * tienen su forma canónica (`-5` es un número, no una fórmula) y anteponerles
 * nada cambiaría su valor.
 */
function csvField(cell: ExportCell, options: CsvWriteOptions) {
  let text = cellText(cell);
  if (cell.kind === 'text' && shouldEscapeFormula(text, options)) {
    text = `'${text}`;
  }
  return quoteIfNeeded(text, options.delimiter);
}

function shouldEscapeFormula(text: string, options: CsvWriteOptions) {
  return options.formulas === 'escape' && FORMULA_START_PATTERN.test(text);
}

/** RFC 4180, reglas 6 y 7: entre comillas, y cada comilla interior se duplica. */
function quoteIfNeeded(text: string, delimiter: CsvDelimiter) {
  const needsQuotes =
    text.includes(delimiter) || NEEDS_QUOTES_PATTERN.test(text);
  if (!needsQuotes) {
    return text;
  }
  return `"${text.replaceAll('"', '""')}"`;
}
