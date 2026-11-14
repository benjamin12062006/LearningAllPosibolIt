import { randomUUID } from 'node:crypto';
import type { PlannedColumn } from './column-plan.js';
import type { FormulaExpression } from './formula.js';
import { normalizeName } from './worksheet-columns.js';
import type { WorksheetColumn } from './worksheets.types.js';

/** Las columnas de la copia y qué ID nuevo le toca a cada columna de origen. */
export type ColumnCopy = Readonly<{
  columns: readonly PlannedColumn[];
  newIdOf: ReadonlyMap<string, string>;
}>;

/**
 * Copia las columnas de una hoja con IDs nuevos (plan 02 de cierre, P8). Las
 * fórmulas guardan sus columnas por ID, así que se reescriben para que apunten
 * a las columnas de la copia y no a las del origen. Las opciones de selección
 * conservan su ID: solo tienen sentido dentro de su columna y las celdas las
 * guardan por ese ID.
 */
export function copyColumns(source: readonly WorksheetColumn[]): ColumnCopy {
  const newIdOf = new Map(source.map((column) => [column.id, randomUUID()]));
  const columns = source.map((column) => ({
    columnId: copiedId(newIdOf, column.id),
    name: column.name,
    nameNormalized: normalizeName(column.name),
    type: column.type,
    position: column.position,
    required: column.required,
    ...(column.options ? { options: column.options } : {}),
    ...(column.formula
      ? {
          formula: {
            ...column.formula,
            expression: remapColumns(column.formula.expression, newIdOf),
          },
        }
      : {}),
  }));
  return { columns, newIdOf };
}

function remapColumns(
  expression: FormulaExpression,
  newIdOf: ReadonlyMap<string, string>,
): FormulaExpression {
  if ('op' in expression) {
    const [left, right] = expression.args;
    return {
      op: expression.op,
      args: [remapColumns(left, newIdOf), remapColumns(right, newIdOf)],
    };
  }
  if ('column' in expression) {
    return { column: copiedId(newIdOf, expression.column) };
  }
  return expression;
}

/** Una fórmula solo puede citar columnas de su propia hoja: si falta una, la hoja está dañada. */
function copiedId(newIdOf: ReadonlyMap<string, string>, columnId: string) {
  const copied = newIdOf.get(columnId);
  if (copied === undefined) {
    throw new Error(
      `La fórmula cita una columna que la hoja no tiene: ${columnId}.`,
    );
  }
  return copied;
}
