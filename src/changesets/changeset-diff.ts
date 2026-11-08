import { createHash } from 'node:crypto';
import {
  mentionedRowIds,
  type CellValue,
  type Operation,
  type RowOperation,
  type RowValues,
} from './changeset-operations.js';
import type { SchemaOperation } from './changeset-schema.js';

/**
 * Resultado de comparar una operación con la base (B), la revisión actual (H)
 * y la propuesta (P), según la tabla de [13] (D4, C21):
 *
 * - `change`: H = B y P es distinto; se aplica sin conflicto.
 * - `noop`: P = B; no se propone cambio.
 * - `satisfied`: H ya es P; no hace falta escribir.
 * - `conflict`: H y P son distintos de B y entre sí, o hay un choque de filas
 *   o de esquema.
 */
export type DiffStatus = 'change' | 'noop' | 'satisfied' | 'conflict';

/** Por qué una operación choca con lo que hay ahora. */
export type ConflictReason =
  | 'row_deleted'
  | 'row_edited'
  | 'row_exists'
  | 'column_deleted'
  | 'schema_changed';

/** `rowId` es `null` en los cambios de esquema; `columnId`, en los de fila entera. */
export type DiffEntry = Readonly<{
  index: number;
  type: Operation['type'];
  rowId: string | null;
  columnId: string | null;
  base: unknown;
  head: unknown;
  proposed: unknown;
  status: DiffStatus;
  reason: ConflictReason | null;
}>;

/**
 * Cómo cambió el esquema entre la base y la revisión actual. Sin cambios, el
 * valor por defecto.
 */
export type SchemaDrift = Readonly<{
  /** Otra revisión publicó un esquema nuevo desde la base. */
  changed: boolean;
  /** Columnas de la base que ya no existen en la revisión actual. */
  removedColumnIds: ReadonlySet<string>;
}>;

export const NO_SCHEMA_DRIFT: SchemaDrift = {
  changed: false,
  removedColumnIds: new Set(),
};

/**
 * Compara cada operación con la base y la revisión actual. Las filas que no
 * están en `headRows` no existen ahora (o están borradas).
 */
export function compareOperations(
  operations: readonly Operation[],
  baseRows: RowValues,
  headRows: RowValues,
  drift: SchemaDrift = NO_SCHEMA_DRIFT,
): DiffEntry[] {
  return operations.map((operation, index) => {
    if (!('rowId' in operation)) {
      return compareSchema(index, operation, drift);
    }
    const base = baseRows.get(operation.rowId);
    const head = headRows.get(operation.rowId);
    const usesRemovedColumn = touchedColumns(operation).some((columnId) =>
      drift.removedColumnIds.has(columnId),
    );
    if (usesRemovedColumn) {
      return columnDeleted(index, operation, base, head);
    }
    switch (operation.type) {
      case 'set_cell':
        return compareCell(index, operation, base, head);
      case 'insert_row':
        return compareInsert(index, operation, head);
      case 'delete_row':
        return compareDelete(index, operation, base, head);
    }
  });
}

export function countByStatus(entries: readonly DiffEntry[]) {
  const counts: Record<DiffStatus, number> = {
    change: 0,
    noop: 0,
    satisfied: 0,
    conflict: 0,
  };
  for (const entry of entries) {
    counts[entry.status] += 1;
  }
  return counts;
}

/**
 * Las filas tal como quedarían al aplicar sobre `rows`: editadas, insertadas o
 * fuera si se borran. Solo incluye las filas que tocan las operaciones.
 */
export function resultingRows(
  operations: readonly Operation[],
  rows: RowValues,
): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  const deleted = new Set<string>();

  for (const operation of operations) {
    if (!('rowId' in operation)) {
      continue;
    }
    if (operation.type === 'delete_row') {
      deleted.add(operation.rowId);
      result.delete(operation.rowId);
      continue;
    }
    if (operation.type === 'insert_row') {
      result.set(operation.rowId, { ...operation.values });
      continue;
    }
    const current = result.get(operation.rowId) ?? {
      ...rows.get(operation.rowId),
    };
    if (operation.value === null) {
      delete current[operation.columnId];
    } else {
      current[operation.columnId] = operation.value;
    }
    if (!deleted.has(operation.rowId)) {
      result.set(operation.rowId, current);
    }
  }
  return result;
}

/**
 * Cuántas filas vivas gana (o pierde, si es negativo) una revisión al aplicar
 * las operaciones sobre `rows`. `rows` debe contener las filas vivas que las
 * operaciones mencionan; las demás no cambian y no cuentan.
 */
export function rowCountChange(
  operations: readonly Operation[],
  rows: RowValues,
): number {
  const after = resultingRows(operations, rows).size;
  const before = mentionedRowIds(operations).filter((rowId) =>
    rows.has(rowId),
  ).length;
  return after - before;
}

/**
 * Huella del contenido (D4): lo que se revisa y se aprueba. Las operaciones ya
 * están normalizadas, así que su orden es estable; las claves de `values` se
 * ordenan para que el texto JSON no dependa del orden de llegada.
 */
export function contentHash(
  content: Readonly<{
    worksheetId: string;
    baseRevisionId: string;
    baseSchemaVersion: number;
    operations: readonly Operation[];
  }>,
): string {
  const canonical = {
    format: 'changeset-v1',
    worksheetId: content.worksheetId,
    baseRevisionId: content.baseRevisionId,
    baseSchemaVersion: content.baseSchemaVersion,
    operations: content.operations.map(canonicalOperation),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function canonicalOperation(operation: Operation): unknown {
  if (operation.type === 'add_column') {
    const options = (operation.options ?? []).map(({ id, label }) => [
      id,
      label,
    ]);
    return [
      operation.type,
      operation.columnId,
      operation.name,
      operation.columnType,
      options,
    ];
  }
  if (operation.type === 'rename_column') {
    return [operation.type, operation.columnId, operation.name];
  }
  if (operation.type === 'delete_column') {
    return [operation.type, operation.columnId];
  }
  if (operation.type === 'change_column_type') {
    const options = (operation.options ?? []).map(({ id, label }) => [
      id,
      label,
    ]);
    return [operation.type, operation.columnId, operation.columnType, options];
  }
  if (operation.type === 'insert_row') {
    const values = Object.keys(operation.values)
      .sort()
      .map((columnId) => [columnId, operation.values[columnId]]);
    return [operation.type, operation.rowId, operation.sortKey, values];
  }
  if (operation.type === 'delete_row') {
    return [operation.type, operation.rowId];
  }
  return [operation.type, operation.rowId, operation.columnId, operation.value];
}

/**
 * Un cambio de esquema solo se aplica sobre el esquema con el que se preparó:
 * si otra revisión publicó otro, es un conflicto estructural ([13]).
 */
function compareSchema(
  index: number,
  operation: SchemaOperation,
  drift: SchemaDrift,
): DiffEntry {
  return {
    index,
    type: operation.type,
    rowId: null,
    columnId: operation.columnId,
    base: null,
    head: null,
    proposed: proposedSchema(operation),
    status: drift.changed ? 'conflict' : 'change',
    reason: drift.changed ? 'schema_changed' : null,
  };
}

/** Lo que se ve como propuesta: el nombre nuevo o el tipo nuevo; al borrar, nada. */
function proposedSchema(operation: SchemaOperation): string | null {
  switch (operation.type) {
    case 'delete_column':
      return null;
    case 'change_column_type':
      return operation.columnType;
    default:
      return operation.name;
  }
}

/**
 * Escribir en una columna que otra revisión borró: no es una celda vacía. La
 * revisión actual ya no tiene esa celda, aunque la fila conserve su valor.
 */
function columnDeleted(
  index: number,
  operation: RowOperation,
  base: Readonly<Record<string, unknown>> | undefined,
  head: Readonly<Record<string, unknown>> | undefined,
): DiffEntry {
  const isCell = operation.type === 'set_cell';
  return {
    index,
    type: operation.type,
    rowId: operation.rowId,
    columnId: isCell ? operation.columnId : null,
    base: isCell ? cellOf(base, operation.columnId) : (base ?? null),
    head: isCell ? null : (head ?? null),
    proposed: proposedOf(operation),
    status: 'conflict',
    reason: 'column_deleted',
  };
}

function touchedColumns(operation: RowOperation): string[] {
  if (operation.type === 'set_cell') {
    return [operation.columnId];
  }
  if (operation.type === 'insert_row') {
    return Object.keys(operation.values);
  }
  return [];
}

function proposedOf(operation: RowOperation): unknown {
  if (operation.type === 'set_cell') {
    return operation.value;
  }
  if (operation.type === 'insert_row') {
    return operation.values;
  }
  return null;
}

function compareCell(
  index: number,
  operation: Extract<Operation, { type: 'set_cell' }>,
  base: Readonly<Record<string, unknown>> | undefined,
  head: Readonly<Record<string, unknown>> | undefined,
): DiffEntry {
  const baseValue = cellOf(base, operation.columnId);
  const entry = {
    index,
    type: operation.type,
    rowId: operation.rowId,
    columnId: operation.columnId,
    base: baseValue,
    proposed: operation.value,
  };
  if (!head) {
    return { ...entry, head: null, status: 'conflict', reason: 'row_deleted' };
  }

  const headValue = cellOf(head, operation.columnId);
  return {
    ...entry,
    head: headValue,
    status: cellStatus(baseValue, headValue, operation.value),
    reason: null,
  };
}

/** La tabla de [13] para una celda, en el mismo orden en que la lee una persona. */
function cellStatus(
  base: CellValue,
  head: CellValue,
  proposed: CellValue,
): DiffStatus {
  if (sameValue(proposed, base)) {
    return 'noop';
  }
  if (sameValue(head, proposed)) {
    return 'satisfied';
  }
  if (sameValue(head, base)) {
    return 'change';
  }
  return 'conflict';
}

function compareInsert(
  index: number,
  operation: Extract<Operation, { type: 'insert_row' }>,
  head: Readonly<Record<string, unknown>> | undefined,
): DiffEntry {
  const entry = {
    index,
    type: operation.type,
    rowId: operation.rowId,
    columnId: null,
    base: null,
    head: head ?? null,
    proposed: operation.values,
  };
  if (!head) {
    return { ...entry, status: 'change', reason: null };
  }
  // Mismo ID insertado en otra revisión ([13], conflicto estructural).
  return sameRow(head, operation.values)
    ? { ...entry, status: 'satisfied', reason: null }
    : { ...entry, status: 'conflict', reason: 'row_exists' };
}

function compareDelete(
  index: number,
  operation: Extract<Operation, { type: 'delete_row' }>,
  base: Readonly<Record<string, unknown>> | undefined,
  head: Readonly<Record<string, unknown>> | undefined,
): DiffEntry {
  const entry = {
    index,
    type: operation.type,
    rowId: operation.rowId,
    columnId: null,
    base: base ?? null,
    head: head ?? null,
    proposed: null,
  };
  if (!head) {
    return { ...entry, status: 'satisfied', reason: null };
  }
  // Borrar frente a editar ([13]): otra persona cambió la fila desde la base.
  return base && sameRow(head, base)
    ? { ...entry, status: 'change', reason: null }
    : { ...entry, status: 'conflict', reason: 'row_edited' };
}

function cellOf(
  row: Readonly<Record<string, unknown>> | undefined,
  columnId: string,
): CellValue {
  const value = row?.[columnId];
  return typeof value === 'string' || typeof value === 'boolean' ? value : null;
}

function sameValue(a: CellValue, b: CellValue) {
  return a === b;
}

/** Dos filas son iguales si tienen las mismas celdas con valor. */
function sameRow(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => (a[key] ?? null) === (b[key] ?? null));
}
