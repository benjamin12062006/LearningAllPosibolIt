import { ErrorCodes, type ErrorCode } from '../common/http/error-codes.js';
import { isCanonicalValue, type CellLiteral } from './cell-values.js';
import type { ColumnType } from './worksheet-columns.js';
import type { WorksheetColumn } from './worksheets.types.js';

/** Límites del filtro y de la página ([12], «Lectura, búsqueda y cálculos»). */
export const ROW_QUERY_LIMITS = {
  depth: 3,
  predicates: 20,
  inValues: 100,
  sortColumns: 3,
  pageSize: 100,
  defaultPageSize: 50,
} as const;

export type FilterOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'in'
  | 'is_null';

const ORDERED = ['lt', 'lte', 'gt', 'gte'] as const;

/** Qué operadores tienen sentido en cada tipo (plan worksheets 02, R5). */
const OPERATORS_BY_TYPE: Record<ColumnType, readonly FilterOperator[]> = {
  text: ['equals', 'not_equals', 'contains', 'in', 'is_null'],
  integer: ['equals', 'not_equals', ...ORDERED, 'in', 'is_null'],
  decimal: ['equals', 'not_equals', ...ORDERED, 'in', 'is_null'],
  date: ['equals', 'not_equals', ...ORDERED, 'in', 'is_null'],
  boolean: ['equals', 'not_equals', 'is_null'],
};

export type QueryColumn = Readonly<{ id: string; type: ColumnType }>;

export type FilterPredicate = Readonly<{
  kind: 'predicate';
  column: QueryColumn;
  op: FilterOperator;
  /** Vacío con `is_null`; uno o más con `in`; exactamente uno con el resto. */
  values: readonly CellLiteral[];
}>;

export type FilterGroup = Readonly<{
  kind: 'and' | 'or';
  children: readonly FilterNode[];
}>;

export type FilterNode = FilterGroup | FilterPredicate;

export type SortTerm = Readonly<{
  column: QueryColumn;
  direction: 'asc' | 'desc';
}>;

/** Consulta ya validada contra las columnas de la revisión. */
export type ParsedRowQuery = Readonly<{
  filter: FilterNode | null;
  sort: readonly SortTerm[];
  /** Columnas que se devuelven, en este orden. */
  columnIds: readonly string[];
}>;

export type RowQueryInput = Readonly<{
  filter?: unknown;
  sort?: readonly Readonly<{ columnId: string; direction: 'asc' | 'desc' }>[];
  columns?: readonly string[];
}>;

export type QueryIssue = Readonly<{ field: string; code: ErrorCode }>;

export type RowQueryResult =
  | Readonly<{ ok: true; query: ParsedRowQuery }>
  | Readonly<{ ok: false; issues: readonly QueryIssue[] }>;

/**
 * Valida filtro, orden y columnas contra las columnas de la revisión que se
 * lee (R6). Nunca lanza: devuelve la consulta tipada o todos los problemas con
 * el campo donde están (`filter.and.1.value`, `sort.0.columnId`).
 */
export function parseRowQuery(
  input: RowQueryInput,
  columns: readonly WorksheetColumn[],
): RowQueryResult {
  const parser = new RowQueryParser(columns);
  const query: ParsedRowQuery = {
    filter: parser.parseFilter(input.filter),
    sort: parser.parseSort(input.sort ?? []),
    columnIds: parser.parseSelection(input.columns),
  };
  if (parser.issues.length > 0) {
    return { ok: false, issues: parser.issues };
  }
  return { ok: true, query };
}

/**
 * Estado del análisis: los problemas encontrados y cuántos predicados lleva.
 * Un objeto pequeño en lugar de pasar ambos por toda la recursión.
 */
class RowQueryParser {
  readonly issues: QueryIssue[] = [];
  private predicateCount = 0;
  private readonly columnsById: ReadonlyMap<string, WorksheetColumn>;

  constructor(private readonly columns: readonly WorksheetColumn[]) {
    this.columnsById = new Map(columns.map((column) => [column.id, column]));
  }

  parseFilter(filter: unknown): FilterNode | null {
    if (filter === undefined) {
      return null;
    }
    const node = this.parseNode(filter, 'filter', 1);
    if (this.predicateCount > ROW_QUERY_LIMITS.predicates) {
      this.report('filter', ErrorCodes.ROW_FILTER_INVALID);
    }
    return node;
  }

  parseSort(sort: NonNullable<RowQueryInput['sort']>): readonly SortTerm[] {
    const terms: SortTerm[] = [];
    sort.forEach((term, index) => {
      const column = this.columnsById.get(term.columnId);
      if (!column) {
        this.report(
          `sort.${index}.columnId`,
          ErrorCodes.ROW_FILTER_COLUMN_UNKNOWN,
        );
        return;
      }
      terms.push({ column, direction: term.direction });
    });
    return terms;
  }

  /** Sin selección, todas las columnas en el orden de la hoja. */
  parseSelection(selection: readonly string[] | undefined): readonly string[] {
    if (selection === undefined) {
      return this.columns.map((column) => column.id);
    }
    selection.forEach((columnId, index) => {
      if (!this.columnsById.has(columnId)) {
        this.report(`columns.${index}`, ErrorCodes.ROW_FILTER_COLUMN_UNKNOWN);
      }
    });
    return [...new Set(selection)];
  }

  private parseNode(
    value: unknown,
    path: string,
    depth: number,
  ): FilterNode | null {
    if (isGroup(value)) {
      return this.parseGroup(value, path, depth);
    }
    if (isPredicateShape(value)) {
      return this.parsePredicate(value, path);
    }
    this.report(path, ErrorCodes.ROW_FILTER_INVALID);
    return null;
  }

  private parseGroup(
    group: GroupShape,
    path: string,
    depth: number,
  ): FilterGroup | null {
    const kind = 'and' in group ? 'and' : 'or';
    const items = 'and' in group ? group.and : group.or;
    const groupPath = `${path}.${kind}`;
    if (depth > ROW_QUERY_LIMITS.depth || items.length === 0) {
      this.report(groupPath, ErrorCodes.ROW_FILTER_INVALID);
      return null;
    }

    const children: FilterNode[] = [];
    items.forEach((item, index) => {
      const child = this.parseNode(item, `${groupPath}.${index}`, depth + 1);
      if (child) {
        children.push(child);
      }
    });
    return { kind, children };
  }

  private parsePredicate(
    predicate: PredicateShape,
    path: string,
  ): FilterPredicate | null {
    this.predicateCount += 1;

    const column = this.columnsById.get(predicate.column);
    if (!column) {
      this.report(`${path}.column`, ErrorCodes.ROW_FILTER_COLUMN_UNKNOWN);
      return null;
    }
    if (!OPERATORS_BY_TYPE[column.type].includes(predicate.op)) {
      this.report(`${path}.op`, ErrorCodes.ROW_FILTER_OPERATOR_INVALID);
      return null;
    }

    const values = literalsFor(column, predicate.op, predicate.value);
    if (!values) {
      this.report(`${path}.value`, ErrorCodes.ROW_FILTER_VALUE_INVALID);
      return null;
    }
    return { kind: 'predicate', column, op: predicate.op, values };
  }

  private report(field: string, code: ErrorCode) {
    this.issues.push({ field, code });
  }
}

type GroupShape =
  Readonly<{ and: readonly unknown[] }> | Readonly<{ or: readonly unknown[] }>;

type PredicateShape = Readonly<{
  column: string;
  op: FilterOperator;
  value?: unknown;
}>;

const OPERATORS = new Set<string>(Object.values(OPERATORS_BY_TYPE).flat());

/** Exactamente una clave, `and` u `or`, con una lista. */
function isGroup(value: unknown): value is GroupShape {
  if (!isPlainObject(value)) {
    return false;
  }
  const keys = Object.keys(value);
  const key = keys[0];
  return (
    keys.length === 1 &&
    (key === 'and' || key === 'or') &&
    Array.isArray(value[key])
  );
}

/** `column` y `op` conocidos; `value` opcional. Ninguna otra clave. */
function isPredicateShape(value: unknown): value is PredicateShape {
  if (!isPlainObject(value)) {
    return false;
  }
  const allowedKeys = new Set(['column', 'op', 'value']);
  return (
    Object.keys(value).every((key) => allowedKeys.has(key)) &&
    typeof value.column === 'string' &&
    typeof value.op === 'string' &&
    OPERATORS.has(value.op)
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Los literales del predicado, ya con la forma canónica del tipo. `null`
 * significa que el valor no sirve: falta, sobra o no tiene la forma correcta.
 */
function literalsFor(
  column: WorksheetColumn,
  op: FilterOperator,
  value: unknown,
): readonly CellLiteral[] | null {
  if (op === 'is_null') {
    return value === undefined ? [] : null;
  }
  if (op === 'in') {
    return isLiteralList(column, value) ? value : null;
  }
  return isCanonicalValue(column.type, value) ? [value] : null;
}

/** Entre 1 y 100 literales, todos con la forma del tipo de la columna. */
function isLiteralList(
  column: WorksheetColumn,
  value: unknown,
): value is CellLiteral[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= ROW_QUERY_LIMITS.inValues &&
    value.every((item: unknown) => isCanonicalValue(column.type, item))
  );
}
