import type { RowProblem } from './engine/google-merchant.profile.js';
import { describeProblem, type Language } from './problem-messages.js';

/** Excel solo abre bien un CSV en UTF-8 con doble clic si lleva BOM (F36). */
const UTF8_BOM = '\uFEFF';

/** RFC 4180: cada registro termina en CRLF (F32). */
const LINE_END = '\r\n';

/**
 * Primer carácter con el que una hoja de cálculo puede empezar una fórmula:
 * `=`, `+`, `-`, `@`, tabulador, CR, LF y las variantes de ancho completo
 * `＝`, `＋`, `－`, `＠` (F31; la lista de ancho completo es interpretación propia).
 */
const FORMULA_START = /^[=+\-@\t\r\n\uFF1D\uFF0B\uFF0D\uFF20]/u;

const HEADERS: Record<Language, readonly string[]> = {
  es: ['fila', 'producto', 'campo', 'problema', 'corrección sugerida'],
  en: ['row', 'product', 'field', 'problem', 'suggested fix'],
};

export type InvalidRow = Readonly<{
  sourceRow: number;
  externalId: string;
  problems: readonly RowProblem[];
}>;

/**
 * `errores.csv` (F5): una línea por problema, con la fila, el producto, el campo,
 * el problema y la corrección sugerida en el idioma pedido. Las filas deben
 * llegar en orden de `sourceRow`.
 */
export function buildErrorsCsv(
  rows: Iterable<InvalidRow>,
  language: Language,
): string {
  const lines = [csvLine(HEADERS[language])];
  for (const row of rows) {
    for (const problem of row.problems) {
      const described = describeProblem(problem);
      lines.push(
        csvLine([
          String(row.sourceRow),
          row.externalId,
          problem.attribute,
          described.problem[language],
          described.suggestion[language],
        ]),
      );
    }
  }
  return `${UTF8_BOM}${lines.join(LINE_END)}${LINE_END}`;
}

function csvLine(cells: readonly string[]) {
  return cells.map(csvCell).join(',');
}

/**
 * Todas las celdas van entre comillas y con las comillas internas duplicadas
 * (F32). Si una celda podría leerse como fórmula, se le antepone un tabulador
 * dentro de las comillas: es la mitigación de OWASP que resiste guardar y
 * reabrir en Excel (F31). Coste aceptado: el valor visible lleva ese tabulador.
 */
export function csvCell(value: string) {
  const safe = FORMULA_START.test(value) ? `\t${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
