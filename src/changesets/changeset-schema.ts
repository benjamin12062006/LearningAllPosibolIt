import { randomUUID } from 'node:crypto';
import { ErrorCodes, type ErrorCode } from '../common/http/error-codes.js';
import { referencedColumns } from '../worksheets/column-plan.js';
import {
  NUMERIC_COLUMN_TYPES,
  WORKSHEET_LIMITS,
  normalizeName,
  type SelectionOption,
} from '../worksheets/worksheet-columns.js';
import type { WorksheetColumn } from '../worksheets/worksheets.types.js';

/**
 * Cambios de esquema dentro de un borrador (E4.7, D12). Una columna se añade,
 * se renombra, se borra o cambia de tipo por su ID. Añadir, renombrar y borrar
 * no reescriben valores: una columna borrada deja de leerse y su ID no se
 * reutiliza. Cambiar el tipo (E4.8, C5 del plan de cierre) sí convierte los
 * valores, pero esa conversión no se guarda aquí: se calcula al revisar y al
 * aplicar (`changeset-conversion.ts`).
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

/** Hacia selección lleva sus opciones; hacia otro tipo, ninguna. */
export type ChangeColumnType = Readonly<{
  type: 'change_column_type';
  columnId: string;
  columnType: AddableColumnType;
  options?: readonly SelectionOption[];
}>;

export type SchemaOperation =
  AddColumn | RenameColumn | DeleteColumn | ChangeColumnType;

export const SCHEMA_OPERATION_TYPES: readonly string[] = [
  'add_column',
  'rename_column',
  'delete_column',
  'change_column_type',
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
  const retyped = new Map<string, ChangeColumnType>();
  const added: WorksheetColumn[] = [];
  for (const operation of operations) {
    if (operation.type === 'delete_column') {
      deleted.add(operation.columnId);
    } else if (operation.type === 'rename_column') {
      renamed.set(operation.columnId, operation.name);
    } else if (operation.type === 'change_column_type') {
      retyped.set(operation.columnId, operation);
    } else {
      added.push(addedColumn(operation));
    }
  }

  const kept = [...baseColumns]
    .sort((a, b) => a.position - b.position)
    .filter((column) => !deleted.has(column.id))
    .map((column) =>
      withType(
        { ...column, name: renamed.get(column.id) ?? column.name },
        retyped.get(column.id),
      ),
    );
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

/** El tipo nuevo, con sus opciones si es selección y sin ellas si no. */
function withType(
  column: WorksheetColumn,
  change: ChangeColumnType | undefined,
): WorksheetColumn {
  if (!change) {
    return column;
  }
  const { options: _previous, ...rest } = column;
  return {
    ...rest,
    type: change.columnType,
    ...(change.options ? { options: change.options } : {}),
  };
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
  | {
      kind: 'rename';
      name: string | null;
      retype: ChangeColumnType | null;
      path: string;
    }
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
    if (isChangeColumnTypeShape(item)) {
      this.changeColumnType(item, path);
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
    const retype = plan?.kind === 'rename' ? plan.retype : null;
    this.plans.set(columnId, { kind: 'rename', name, retype, path });
  }

  /**
   * Solo una columna de la base que guarda valores, una vez y hacia otro tipo.
   * De selección a selección no: cambiar opciones no es cambiar el tipo.
   */
  private changeColumnType(item: ChangeColumnTypeShape, path: string) {
    const plan = this.plans.get(item.columnId);
    const base = this.baseById.get(item.columnId);
    if (!base) {
      // Una columna añadida en el mismo borrador se añade ya con su tipo.
      const isAddedHere = plan?.kind === 'add' || plan?.kind === 'cancelled';
      this.report(
        `${path}.columnId`,
        isAddedHere
          ? ErrorCodes.OPERATION_INVALID
          : ErrorCodes.OPERATION_COLUMN_UNKNOWN,
      );
      return;
    }
    const isRepeated = plan?.kind === 'rename' && plan.retype !== null;
    const isUnchangeable =
      base.type === 'calculated' ||
      base.type === item.columnType ||
      plan?.kind === 'delete' ||
      isRepeated;
    if (isUnchangeable) {
      this.report(path, ErrorCodes.OPERATION_INVALID);
      return;
    }
    const options = this.planOptions(item, path);
    if (options === null) {
      return;
    }
    const retype: ChangeColumnType = {
      type: 'change_column_type',
      columnId: item.columnId,
      columnType: item.columnType,
      ...(options ? { options } : {}),
    };
    const name = plan?.kind === 'rename' ? plan.name : null;
    this.plans.set(item.columnId, { kind: 'rename', name, retype, path });
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
    // Borrar después de cambiar el tipo deja el cambio sin sentido.
    if (plan?.kind === 'rename' && plan.retype) {
      this.report(path, ErrorCodes.OPERATION_INVALID);
      return;
    }
    this.plans.set(columnId, { kind: 'delete', path });
  }

  /**
   * Opciones de una selección: de 1 a 100 etiquetas distintas. Un ID que ya
   * trae (porque el cliente reenvía lo guardado) se conserva; si no, se crea.
   * `undefined` cuando la columna no es de selección; `null` si son inválidas.
   */
  private planOptions(
    item: AddColumnShape | ChangeColumnTypeShape,
    path: string,
  ) {
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
      } else if (plan?.kind === 'rename') {
        if (plan.name !== null && plan.name !== column.name) {
          operations.push({
            type: 'rename_column',
            columnId: column.id,
            name: plan.name,
          });
        }
        if (plan.retype) {
          operations.push(plan.retype);
        }
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

    // Una calculada necesita sus entradas, y que sigan siendo numéricas.
    const numeric = new Set(
      columns
        .filter(({ type }) => NUMERIC_COLUMN_TYPES.includes(type))
        .map(({ id }) => id),
    );
    for (const column of columns) {
      const unusable = column.formula
        ? referencedColumns(column.formula.expression).filter(
            (id) => !numeric.has(id),
          )
        : [];
      for (const columnId of unusable) {
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

type ChangeColumnTypeShape = Readonly<{
  type: 'change_column_type';
  columnId: string;
  columnType: AddableColumnType;
  options?: readonly OptionShape[];
}>;

function isChangeColumnTypeShape(
  value: unknown,
): value is ChangeColumnTypeShape {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['type', 'columnId', 'columnType', 'options']) &&
    value.type === 'change_column_type' &&
    isUuid(value.columnId) &&
    (ADDABLE_COLUMN_TYPES as readonly unknown[]).includes(value.columnType) &&
    (value.options === undefined ||
      (Array.isArray(value.options) && value.options.every(isOptionShape)))
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
