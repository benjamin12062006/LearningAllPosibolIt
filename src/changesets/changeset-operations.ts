import { ErrorCodes, type ErrorCode } from '../common/http/error-codes.js';
import {
  isCanonicalValue,
  type CellLiteral,
} from '../worksheets/cell-values.js';
import type { WorksheetColumn } from '../worksheets/worksheets.types.js';

/** Como mucho 1.000 operaciones por borrador ([12], «patch hasta 1.000 operaciones»). */
export const MAX_OPERATIONS = 1000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SORT_KEY_PATTERN = /^.{1,64}$/;

/** `null` vacía la celda; cualquier otro valor tiene la forma canónica de su columna. */
export type CellValue = CellLiteral | null;

export type SetCell = Readonly<{
  type: 'set_cell';
  rowId: string;
  columnId: string;
  value: CellValue;
}>;

export type InsertRow = Readonly<{
  type: 'insert_row';
  rowId: string;
  sortKey: string;
  values: Readonly<Record<string, CellLiteral>>;
}>;

export type DeleteRow = Readonly<{ type: 'delete_row'; rowId: string }>;

/** Operación ya normalizada: la que se guarda, se compara y se aplica (D2). */
export type Operation = SetCell | InsertRow | DeleteRow;

/** Valores de las filas vivas que tocan las operaciones, por `rowId`. */
export type RowValues = ReadonlyMap<string, Readonly<Record<string, unknown>>>;

export type OperationIssue = Readonly<{ field: string; code: ErrorCode }>;

export type NormalizedOperations =
  | Readonly<{ ok: true; operations: readonly Operation[] }>
  | Readonly<{ ok: false; issues: readonly OperationIssue[] }>;

export type NormalizeContext = Readonly<{
  columns: readonly WorksheetColumn[];
  /** Filas vivas en la revisión base, solo las que mencionan las operaciones. */
  baseRows: RowValues;
  /** Clave de orden para una inserción que no la trae. */
  defaultSortKey: (index: number) => string;
}>;

/**
 * IDs de fila que aparecen en la petición, aunque esté mal formada: el
 * servicio los usa para cargar solo esas filas de la base.
 */
export function mentionedRowIds(input: readonly unknown[]): string[] {
  const ids = new Set<string>();
  for (const item of input) {
    if (isRecord(item) && typeof item.rowId === 'string') {
      ids.add(item.rowId);
    }
  }
  return [...ids];
}

/**
 * Valida y normaliza las operaciones (D2): una escritura por celda, las de una
 * fila insertada se funden en su inserción y borrar una fila insertada anula
 * la inserción. Nunca lanza: devuelve las operaciones o los problemas con su
 * campo (`operations.3.value`).
 */
export function normalizeOperations(
  input: readonly unknown[],
  context: NormalizeContext,
): NormalizedOperations {
  const normalizer = new OperationNormalizer(context);
  input.forEach((item, index) => normalizer.add(item, index));
  if (normalizer.issues.length > 0) {
    return { ok: false, issues: normalizer.issues };
  }
  return { ok: true, operations: normalizer.result() };
}

type RowPlan =
  | { kind: 'edit'; sets: Map<string, CellValue> }
  | { kind: 'insert'; sortKey: string; values: Map<string, CellLiteral> }
  | { kind: 'delete' }
  | { kind: 'cancelled' };

/**
 * Lo que el borrador hace con cada fila, en el orden en que aparecen. Un objeto
 * pequeño porque cada operación depende de lo que hicieron las anteriores.
 */
class OperationNormalizer {
  readonly issues: OperationIssue[] = [];
  private readonly rows = new Map<string, RowPlan>();
  private readonly columnsById: ReadonlyMap<string, WorksheetColumn>;

  constructor(private readonly context: NormalizeContext) {
    this.columnsById = new Map(
      context.columns.map((column) => [column.id, column]),
    );
  }

  add(item: unknown, index: number) {
    const path = `operations.${index}`;
    if (isSetCellShape(item)) {
      this.setCell(item, path);
      return;
    }
    if (isInsertRowShape(item)) {
      this.insertRow(item, path, index);
      return;
    }
    if (isDeleteRowShape(item)) {
      this.deleteRow(item.rowId, path);
      return;
    }
    this.report(path, ErrorCodes.OPERATION_INVALID);
  }

  /** Filas en orden de aparición; dentro, las celdas en el orden de las columnas. */
  result(): Operation[] {
    const operations: Operation[] = [];
    for (const [rowId, plan] of this.rows) {
      if (plan.kind === 'insert') {
        operations.push({
          type: 'insert_row',
          rowId,
          sortKey: plan.sortKey,
          values: Object.fromEntries(this.inColumnOrder(plan.values)),
        });
      } else if (plan.kind === 'delete') {
        operations.push({ type: 'delete_row', rowId });
      } else if (plan.kind === 'edit') {
        for (const [columnId, value] of this.inColumnOrder(plan.sets)) {
          operations.push({ type: 'set_cell', rowId, columnId, value });
        }
      }
    }
    return operations;
  }

  private setCell(item: SetCellShape, path: string) {
    if (!this.isWritableValue(item.columnId, item.value, path)) {
      return;
    }
    const plan = this.rows.get(item.rowId);
    if (plan?.kind === 'insert') {
      setOrClear(plan.values, item.columnId, item.value);
      return;
    }
    if (plan?.kind === 'delete' || plan?.kind === 'cancelled') {
      this.report(path, ErrorCodes.OPERATION_INVALID);
      return;
    }
    if (!this.context.baseRows.has(item.rowId)) {
      this.report(`${path}.rowId`, ErrorCodes.OPERATION_ROW_UNKNOWN);
      return;
    }
    const sets =
      plan?.kind === 'edit' ? plan.sets : new Map<string, CellValue>();
    sets.set(item.columnId, item.value);
    this.rows.set(item.rowId, { kind: 'edit', sets });
  }

  private insertRow(item: InsertRowShape, path: string, index: number) {
    if (this.context.baseRows.has(item.rowId) || this.rows.has(item.rowId)) {
      this.report(`${path}.rowId`, ErrorCodes.OPERATION_ROW_EXISTS);
      return;
    }
    const values = new Map<string, CellLiteral>();
    for (const [columnId, value] of Object.entries(item.values ?? {})) {
      if (this.isWritableValue(columnId, value, `${path}.values.${columnId}`)) {
        setOrClear(values, columnId, value);
      }
    }
    this.rows.set(item.rowId, {
      kind: 'insert',
      sortKey: item.sortKey ?? this.context.defaultSortKey(index),
      values,
    });
  }

  /** Borrar una fila insertada en este mismo borrador deja como si no existiera. */
  private deleteRow(rowId: string, path: string) {
    const plan = this.rows.get(rowId);
    if (plan?.kind === 'insert') {
      this.rows.set(rowId, { kind: 'cancelled' });
      return;
    }
    if (!this.context.baseRows.has(rowId)) {
      this.report(`${path}.rowId`, ErrorCodes.OPERATION_ROW_UNKNOWN);
      return;
    }
    this.rows.set(rowId, { kind: 'delete' });
  }

  /** La columna existe, no es calculada (su valor sale del motor) y el valor encaja. */
  private isWritableValue(
    columnId: string,
    value: unknown,
    path: string,
  ): value is CellValue {
    const column = this.columnsById.get(columnId);
    if (!column) {
      this.report(path, ErrorCodes.OPERATION_COLUMN_UNKNOWN);
      return false;
    }
    const isValid =
      column.type !== 'calculated' &&
      (value === null || isCanonicalValue(column, value));
    if (!isValid) {
      this.report(path, ErrorCodes.OPERATION_VALUE_INVALID);
    }
    return isValid;
  }

  private inColumnOrder<T>(cells: ReadonlyMap<string, T>): [string, T][] {
    const positionOf = (columnId: string) =>
      this.columnsById.get(columnId)?.position ?? Number.MAX_SAFE_INTEGER;
    return [...cells].sort(([a], [b]) => positionOf(a) - positionOf(b));
  }

  private report(field: string, code: ErrorCode) {
    this.issues.push({ field, code });
  }
}

/** En una inserción, `null` quita la celda: una clave ausente ya es vacía. */
function setOrClear<T>(
  cells: Map<string, T>,
  columnId: string,
  value: T | null,
) {
  if (value === null) {
    cells.delete(columnId);
  } else {
    cells.set(columnId, value);
  }
}

type SetCellShape = Readonly<{
  type: 'set_cell';
  rowId: string;
  columnId: string;
  value: unknown;
}>;

type InsertRowShape = Readonly<{
  type: 'insert_row';
  rowId: string;
  sortKey?: string;
  values?: Readonly<Record<string, unknown>>;
}>;

function isSetCellShape(value: unknown): value is SetCellShape {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['type', 'rowId', 'columnId', 'value']) &&
    value.type === 'set_cell' &&
    isUuid(value.rowId) &&
    isUuid(value.columnId) &&
    'value' in value
  );
}

function isInsertRowShape(value: unknown): value is InsertRowShape {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['type', 'rowId', 'sortKey', 'values']) &&
    value.type === 'insert_row' &&
    isUuid(value.rowId) &&
    (value.sortKey === undefined ||
      (typeof value.sortKey === 'string' &&
        SORT_KEY_PATTERN.test(value.sortKey))) &&
    (value.values === undefined || isRecord(value.values))
  );
}

function isDeleteRowShape(
  value: unknown,
): value is Readonly<{ type: 'delete_row'; rowId: string }> {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['type', 'rowId']) &&
    value.type === 'delete_row' &&
    isUuid(value.rowId)
  );
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}
