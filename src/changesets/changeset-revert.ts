import type { CellLiteral } from '../worksheets/cell-values.js';
import type { Operation, RowValues } from './changeset-operations.js';

/** Cómo cambió una fila en la revisión que se quiere deshacer. */
export type RowChange = Readonly<{
  rowId: string;
  sortKey: string;
  /** Valores antes de la revisión; `null` si la fila no existía. */
  before: Readonly<Record<string, unknown>> | null;
  /** Valores después; `null` si la revisión la borró. */
  after: Readonly<Record<string, unknown>> | null;
}>;

/**
 * Operaciones que devuelven esas filas a como estaban antes de la revisión,
 * calculadas contra la revisión actual (D10, G6). Solo se tocan las celdas que
 * cambió esa revisión: una edición posterior de otra celda se conserva.
 */
export function inverseOperations(
  changes: readonly RowChange[],
  headRows: RowValues,
): Operation[] {
  const operations: Operation[] = [];
  for (const change of changes) {
    const head = headRows.get(change.rowId);
    operations.push(...inverseOf(change, head));
  }
  return operations;
}

function inverseOf(
  change: RowChange,
  head: Readonly<Record<string, unknown>> | undefined,
): Operation[] {
  const { before, after, rowId } = change;

  // La revisión la insertó: deshacer es borrarla, si sigue viva.
  if (!before) {
    return head ? [{ type: 'delete_row', rowId }] : [];
  }
  // La revisión la borró y sigue borrada: deshacer es volver a insertarla.
  if (!after && !head) {
    return [
      {
        type: 'insert_row',
        rowId,
        sortKey: change.sortKey,
        values: literalsOf(before),
      },
    ];
  }
  if (!head) {
    return [];
  }

  const touched = after ? changedColumns(before, after) : Object.keys(before);
  return touched
    .filter(
      (columnId) => (head[columnId] ?? null) !== (before[columnId] ?? null),
    )
    .map((columnId) => ({
      type: 'set_cell',
      rowId,
      columnId,
      value: literalOrNull(before[columnId]),
    }));
}

function changedColumns(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter(
    (key) => (before[key] ?? null) !== (after[key] ?? null),
  );
}

function literalsOf(values: Readonly<Record<string, unknown>>) {
  const literals: Record<string, CellLiteral> = {};
  for (const [columnId, value] of Object.entries(values)) {
    const literal = literalOrNull(value);
    if (literal !== null) {
      literals[columnId] = literal;
    }
  }
  return literals;
}

function literalOrNull(value: unknown): CellLiteral | null {
  return typeof value === 'string' || typeof value === 'boolean' ? value : null;
}
