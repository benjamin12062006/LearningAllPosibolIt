import { randomUUID } from 'node:crypto';
import { ErrorCodes, type ErrorCode } from '../common/http/error-codes.js';
import { referencedColumns } from '../worksheets/column-plan.js';
import {
  WORKSHEET_LIMITS,
  normalizeName,
  type SelectionOption,
} from '../worksheets/worksheet-columns.js';
import type { WorksheetColumn } from '../worksheets/worksheets.types.js';

/**
 * Cambios de esquema dentro de un borrador (E4.7, D12). Una columna se añade,
 * se renombra o se borra por su ID; los valores de las filas no se reescriben:
 * una columna borrada deja de leerse y su ID no se reutiliza.
 *
 * Cambiar el tipo de una columna queda fuera: [12] exige previsualizar cada
 * valor incompatible antes de convertir, y eso es un incremento propio.
 */

/** Tipos que se pueden añadir desde un borrador: los que guardan valor. */
export const ADDABLE_COLUMN_TYPES = [
  'text',
  'integer',
  'decimal',
  'date',
  'boolean',
  'selection',
] as const;

export type AddableColumnType = (typeof ADDABLE_COLUMN_TYPES)[number];

/** Una columna nueva es siempre opcional: no deja filas existentes en falta. */
export type AddColumn = Readonly<{
  type: 'add_column';
  columnId: string;
  name: string;
  columnType: AddableColumnType;
  options?: readonly SelectionOption[];
}>;

export type RenameColumn = Readonly<{
  type: 'rename_column';
  columnId: string;
  name: string;
}>;

export type DeleteColumn = Readonly<{
  type: 'delete_column';
  columnId: string;
}>;

export type SchemaOperation = AddColumn | RenameColumn | DeleteColumn;

export const SCHEMA_OPERATION_TYPES: readonly string[] = [
  'add_column',
  'rename_column',
  'delete_column',
];

export type SchemaIssue = Readonly<{ field: string; code: ErrorCode }>;

export type SchemaPlan = Readonly<{
  operations: readonly SchemaOperation[];
  /** El esquema que resulta: contra él se validan las operaciones de filas. */
  columns: readonly WorksheetColumn[];
  issues: readonly SchemaIssue[];
}>;

/** La operación pide un cambio de esquema, aunque esté mal formada. */
export function isSchemaRequest(item: unknown): boolean {
  return (
    isRecord(item) &&
    typeof item.type === 'string' &&
    SCHEMA_OPERATION_TYPES.includes(item.type)
  );
}

/**
 * Normaliza los cambios de esquema de la petición (las posiciones `index`
 * son las de la lista completa) y calcula el esquema resultante. Nunca lanza.
 */
export function planSchema(
  input: readonly Readonly<{ item: unknown; index: number }>[],
  baseColumns: readonly WorksheetColumn[],
): SchemaPlan {
  const planner = new SchemaPlanner(baseColumns);
  for (const { item, index } of input) {
    planner.add(item, `operations.${index}`);
  }
  return planner.finish();
}

/**
 * El esquema después de aplicar operaciones ya normalizadas: las columnas de
 * la base que quedan, en su orden, y detrás las nuevas. Posiciones 0..n-1.
 */
export function resultingColumns(
  baseColumns: readonly WorksheetColumn[],
  operations: readonly SchemaOperation[],
): WorksheetColumn[] {
  const deleted = new Set<string>();
  const renamed = new Map<string, string>();
  const added: WorksheetColumn[] = [];
  for (const operation of operations) {
    if (operation.type === 'delete_column') {
      deleted.add(operation.columnId);
    } else if (operation.type === 'rename_column') {
      renamed.set(operation.columnId, operation.name);
    } else {
      added.push(addedColumn(operation));
    }
  }

  const kept = [...baseColumns]
    .sort((a, b) => a.position - b.position)
    .filter((column) => !deleted.has(column.id))
    .map((column) => ({
      ...column,
      name: renamed.get(column.id) ?? column.name,
    }));
  return [...kept, ...added].map((column, position) => ({
    ...column,
    position,
  }));
}

export function isSchemaOperation(
  operation: Readonly<{ type: string }>,
): operation is SchemaOperation {
  return SCHEMA_OPERATION_TYPES.includes(operation.type);
}

function addedColumn(operation: AddColumn): WorksheetColumn {
  return {
    id: operation.columnId,
    name: operation.name,
    type: operation.columnType,
    position: 0,
    required: false,
    ...(operation.options ? { options: operation.options } : {}),
  };
}

type ColumnPlan =
  | { kind: 'add'; operation: AddColumn; path: string }
  | { kind: 'rename'; name: string; path: string }
  | { kind: 'delete'; path: string }
  | { kind: 'cancelled' };

/**
 * Lo que el borrador hace con cada columna, en orden de aparición. Igual que
 * con las filas: añadir y después renombrar se funde en la alta, y borrar una
 * columna añadida en el mismo borrador la anula.
 */
class SchemaPlanner {
  private readonly issues: SchemaIssue[] = [];
  private readonly plans = new Map<string, ColumnPlan>();
  private readonly baseById: ReadonlyMap<string, WorksheetColumn>;

  constructor(private readonly baseColumns: readonly WorksheetColumn[]) {
    this.baseById = new Map(baseColumns.map((column) => [column.id, column]));
  }

  add(item: unknown, path: string) {
    if (isAddColumnShape(item)) {
      this.addColumn(item, path);
      return;
    }
    if (isRenameColumnShape(item)) {
      this.renameColumn(item.columnId, item.name.trim(), path);
      return;
    }
    if (isDeleteColumnShape(item)) {
      this.deleteColumn(item.columnId, path);
      return;
    }
    this.report(path, ErrorCodes.OPERATION_INVALID);
  }

  finish(): SchemaPlan {
    const operations = this.operations();
    const columns = resultingColumns(this.baseColumns, operations);
    this.checkResult(columns);
    return { operations, columns, issues: this.issues };
  }

  private addColumn(item: AddColumnShape, path: string) {
    if (this.baseById.has(item.columnId) || this.plans.has(item.columnId)) {
      this.report(`${path}.columnId`, ErrorCodes.OPERATION_COLUMN_EXISTS);
      return;
    }
    const options = this.planOptions(item, path);
    if (options === null) {
      return;
    }
    this.plans.set(item.columnId, {
      kind: 'add',
      path,
      operation: {
        type: 'add_column',
        columnId: item.columnId,
        name: item.name.trim(),
        columnType: item.columnType,
        ...(options ? { options } : {}),
      },
    });
  }

  private renameColumn(columnId: string, name: string, path: string) {
    const plan = this.plans.get(columnId);
    if (plan?.kind === 'add') {
      this.plans.set(columnId, {
        ...plan,
        operation: { ...plan.operation, name },
      });
      return;
    }
    if (plan?.kind === 'delete' || plan?.kind === 'cancelled') {
      this.report(path, ErrorCodes.OPERATION_INVALID);
      return;
    }
    if (!this.baseById.has(columnId)) {
      this.report(`${path}.columnId`, ErrorCodes.OPERATION_COLUMN_UNKNOWN);
      return;
    }
    this.plans.set(columnId, { kind: 'rename', name, path });
  }

  private deleteColumn(columnId: string, path: string) {
    const plan = this.plans.get(columnId);
    if (plan?.kind === 'add') {
      this.plans.set(columnId, { kind: 'cancelled' });
      return;
    }
    if (plan?.kind === 'delete' || plan?.kind === 'cancelled') {
      this.report(path, ErrorCodes.OPERATION_INVALID);
      return;
    }
    if (!this.baseById.has(columnId)) {
      this.report(`${path}.columnId`, ErrorCodes.OPERATION_COLUMN_UNKNOWN);
      return;
    }
    this.plans.set(columnId, { kind: 'delete', path });
  }

  /**
   * Opciones de una selección: de 1 a 100 etiquetas distintas. Un ID que ya
   * trae (porque el cliente reenvía lo guardado) se conserva; si no, se crea.
   * `undefined` cuando la columna no es de selección; `null` si son inválidas.
   */
  private planOptions(item: AddColumnShape, path: string) {
    if (item.columnType !== 'selection') {
      if (item.options !== undefined) {
        this.report(`${path}.options`, ErrorCodes.COLUMN_OPTIONS_INVALID);
        return null;
      }
      return undefined;
    }
    const options = item.options ?? [];
    const labels = new Set(options.map(({ label }) => normalizeName(label)));
    const isValidList =
      options.length >= 1 &&
      options.length <= WORKSHEET_LIMITS.optionsPerColumn &&
      labels.size === options.length;
    if (!isValidList) {
      this.report(`${path}.options`, ErrorCodes.COLUMN_OPTIONS_INVALID);
      return null;
    }
    return options.map(({ id, label }) => ({
      id: id ?? randomUUID(),
      label,
    }));
  }

  /** Columnas de la base primero, en su orden; las nuevas, en el de aparición. */
  private operations(): SchemaOperation[] {
    const operations: SchemaOperation[] = [];
    for (const column of [...this.baseColumns].sort(
      (a, b) => a.position - b.position,
    )) {
      const plan = this.plans.get(column.id);
      if (plan?.kind === 'delete') {
        operations.push({ type: 'delete_column', columnId: column.id });
      } else if (plan?.kind === 'rename' && plan.name !== column.name) {
        operations.push({
          type: 'rename_column',
          columnId: column.id,
          name: plan.name,
        });
      }
    }
    for (const plan of this.plans.values()) {
      if (plan.kind === 'add') {
        operations.push(plan.operation);
      }
    }
    return operations;
  }

  /** Nombres únicos, límite de columnas y ninguna fórmula sin su entrada. */
  private checkResult(columns: readonly WorksheetColumn[]) {
    const seen = new Set<string>();
    for (const column of columns) {
      const key = normalizeName(column.name);
      if (seen.has(key)) {
        this.report(
          `${this.pathOf(column.id)}.name`,
          ErrorCodes.WORKSHEET_COLUMN_DUPLICATE,
        );
      }
      seen.add(key);
    }
    if (columns.length > WORKSHEET_LIMITS.columnsPerWorksheet) {
      this.report('operations', ErrorCodes.OPERATION_INVALID);
    }

    const remaining = new Set(columns.map(({ id }) => id));
    for (const column of columns) {
      const missing = column.formula
        ? referencedColumns(column.formula.expression).filter(
            (id) => !remaining.has(id),
          )
        : [];
      for (const columnId of missing) {
        this.report(this.pathOf(columnId), ErrorCodes.COLUMN_IN_USE);
      }
    }
  }

  /** La operación que introdujo el nombre o el borrado de una columna. */
  private pathOf(columnId: string) {
    const plan = this.plans.get(columnId);
    return plan && plan.kind !== 'cancelled' ? plan.path : 'operations';
  }

  private report(field: string, code: ErrorCode) {
    this.issues.push({ field, code });
  }
}

// ── Formas de la petición ──

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type OptionShape = Readonly<{ id?: string; label: string }>;

type AddColumnShape = Readonly<{
  type: 'add_column';
  columnId: string;
  name: string;
  columnType: AddableColumnType;
  options?: readonly OptionShape[];
}>;

function isAddColumnShape(value: unknown): value is AddColumnShape {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['type', 'columnId', 'name', 'columnType', 'options']) &&
    value.type === 'add_column' &&
    isUuid(value.columnId) &&
    isColumnName(value.name) &&
    (ADDABLE_COLUMN_TYPES as readonly unknown[]).includes(value.columnType) &&
    (value.options === undefined ||
      (Array.isArray(value.options) && value.options.every(isOptionShape)))
  );
}

function isRenameColumnShape(value: unknown): value is Readonly<{
  type: 'rename_column';
  columnId: string;
  name: string;
}> {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['type', 'columnId', 'name']) &&
    value.type === 'rename_column' &&
    isUuid(value.columnId) &&
    isColumnName(value.name)
  );
}

function isDeleteColumnShape(
  value: unknown,
): value is Readonly<{ type: 'delete_column'; columnId: string }> {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['type', 'columnId']) &&
    value.type === 'delete_column' &&
    isUuid(value.columnId)
  );
}

function isOptionShape(value: unknown): value is OptionShape {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['id', 'label']) &&
    (value.id === undefined || isUuid(value.id)) &&
    isColumnName(value.label)
  );
}

/** El mismo límite que al crear la hoja: de 1 a 120 caracteres sin los bordes. */
function isColumnName(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const length = value.trim().length;
  return length >= 1 && length <= WORKSHEET_LIMITS.nameLength;
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
