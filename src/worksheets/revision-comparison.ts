import type { ColumnType } from './worksheet-columns.js';
import type { WorksheetColumn } from './worksheets.types.js';

/*
 * Comparar dos revisiones de una misma hoja (plan 09 del asistente, etapa 1).
 * No es la revisión de un borrador: aquí no hay operaciones, solo el estado de
 * cada fila en una revisión y en la otra.
 */

/** Una fila que cambió entre las dos revisiones: `null` si no vivía en esa. */
export type RowAtBothRevisions = Readonly<{
  rowId: string;
  before: Readonly<Record<string, unknown>> | null;
  after: Readonly<Record<string, unknown>> | null;
}>;

export type RowChange = 'added' | 'removed' | 'edited';

export type RowDifference = Readonly<{
  rowId: string;
  change: RowChange;
  /** En una edición, las columnas comunes cuyo valor cambió. */
  changedColumnIds: readonly string[];
  /** Solo las celdas que importan: las cambiadas o, en altas y bajas, la fila. */
  before: Readonly<Record<string, unknown>> | null;
  after: Readonly<Record<string, unknown>> | null;
}>;

type ColumnSummary = Readonly<{ id: string; name: string; type: ColumnType }>;

/** Qué cambió de una columna que existe en las dos revisiones. */
export type ColumnChange = Readonly<{
  id: string;
  fields: readonly ('name' | 'type' | 'required' | 'options' | 'formula')[];
  before: ColumnSummary;
  after: ColumnSummary;
}>;

export type SchemaDifference = Readonly<{
  added: readonly ColumnSummary[];
  removed: readonly ColumnSummary[];
  changed: readonly ColumnChange[];
}>;

/** Las columnas se emparejan por ID: renombrar o mover una no la hace otra. */
export function compareSchemas(
  from: readonly WorksheetColumn[],
  to: readonly WorksheetColumn[],
): SchemaDifference {
  const fromById = new Map(from.map((column) => [column.id, column]));
  const toById = new Map(to.map((column) => [column.id, column]));

  const added = to.filter((column) => !fromById.has(column.id));
  const removed = from.filter((column) => !toById.has(column.id));
  const changed: ColumnChange[] = [];
  for (const after of to) {
    const before = fromById.get(after.id);
    if (!before) {
      continue;
    }
    const fields = changedFieldsOf(before, after);
    if (fields.length > 0) {
      changed.push({
        id: after.id,
        fields,
        before: summaryOf(before),
        after: summaryOf(after),
      });
    }
  }

  return {
    added: added.map(summaryOf),
    removed: removed.map(summaryOf),
    changed,
  };
}

/**
 * Las columnas cuyas celdas se pueden comparar: guardadas en las dos
 * revisiones. Una calculada no guarda celdas, y una columna nueva o quitada ya
 * figura en el esquema: contarla otra vez en cada fila lo taparía todo.
 */
export function comparableColumnIds(
  from: readonly WorksheetColumn[],
  to: readonly WorksheetColumn[],
): string[] {
  const storedInFrom = new Set(from.filter(isStored).map(({ id }) => id));
  return to
    .filter((column) => isStored(column) && storedInFrom.has(column.id))
    .map(({ id }) => id);
}

/**
 * Clasifica cada fila. Una fila que cambió y volvió a su valor no es una
 * diferencia entre estas dos revisiones, así que no aparece.
 */
export function compareRows(
  rows: readonly RowAtBothRevisions[],
  columnIds: readonly string[],
): RowDifference[] {
  const differences: RowDifference[] = [];
  for (const row of rows) {
    const difference = differenceOf(row, columnIds);
    if (difference) {
      differences.push(difference);
    }
  }
  return differences;
}

export function countByChange(differences: readonly RowDifference[]) {
  const counts: Record<RowChange, number> = { added: 0, removed: 0, edited: 0 };
  for (const { change } of differences) {
    counts[change] += 1;
  }
  return counts;
}

function differenceOf(
  { rowId, before, after }: RowAtBothRevisions,
  columnIds: readonly string[],
): RowDifference | null {
  if (!before && after) {
    return { rowId, change: 'added', changedColumnIds: [], before, after };
  }
  if (before && !after) {
    return { rowId, change: 'removed', changedColumnIds: [], before, after };
  }
  if (!before || !after) {
    return null;
  }

  const changedColumnIds = columnIds.filter(
    (columnId) =>
      !isSameCell(cellOf(before, columnId), cellOf(after, columnId)),
  );
  if (changedColumnIds.length === 0) {
    return null;
  }
  return {
    rowId,
    change: 'edited',
    changedColumnIds,
    before: pick(before, changedColumnIds),
    after: pick(after, changedColumnIds),
  };
}

/** Una celda sin clave guardada está vacía, igual que una con `null`. */
function cellOf(row: Readonly<Record<string, unknown>>, columnId: string) {
  return row[columnId] ?? null;
}

function isSameCell(a: unknown, b: unknown) {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function pick(
  row: Readonly<Record<string, unknown>>,
  columnIds: readonly string[],
) {
  return Object.fromEntries(
    columnIds.map((columnId) => [columnId, cellOf(row, columnId)]),
  );
}

function isStored(column: WorksheetColumn) {
  return column.formula === undefined;
}

function changedFieldsOf(before: WorksheetColumn, after: WorksheetColumn) {
  const fields: ColumnChange['fields'][number][] = [];
  if (before.name !== after.name) fields.push('name');
  if (before.type !== after.type) fields.push('type');
  if (before.required !== after.required) fields.push('required');
  if (!isSameCell(before.options ?? null, after.options ?? null)) {
    fields.push('options');
  }
  if (!isSameCell(before.formula ?? null, after.formula ?? null)) {
    fields.push('formula');
  }
  return fields;
}

function summaryOf({ id, name, type }: WorksheetColumn): ColumnSummary {
  return { id, name, type };
}
