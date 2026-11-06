import { randomUUID } from 'node:crypto';
import { ErrorCodes, type ErrorCode } from '../common/http/error-codes.js';
import { isCanonicalValue } from './cell-values.js';
import { ROUNDING_MODES, type RoundingMode } from './exact-decimal.js';
import {
  CALCULATION_ENGINE,
  FORMULA_LIMITS,
  FORMULA_OPERATORS,
  type FormulaExpression,
  type FormulaOperator,
  type StoredFormula,
} from './formula.js';
import {
  NUMERIC_COLUMN_TYPES,
  WORKSHEET_LIMITS,
  normalizeName,
  type ColumnType,
  type SelectionOption,
} from './worksheet-columns.js';

/** Lo que el cliente describe de una columna; los IDs los pone el servidor. */
export type ColumnRequest = Readonly<{
  name: string;
  type: ColumnType;
  required: boolean;
  options?: readonly Readonly<{ label: string }>[];
  /** Árbol sin validar; en la petición nombra columnas por su nombre (V3). */
  formula?: unknown;
}>;

/** Columna lista para guardar, con su ID y, si toca, opciones o fórmula. */
export type PlannedColumn = Readonly<{
  columnId: string;
  name: string;
  nameNormalized: string;
  type: ColumnType;
  position: number;
  required: boolean;
  options?: readonly SelectionOption[];
  formula?: StoredFormula;
}>;

export type ColumnIssue = Readonly<{ field: string; code: ErrorCode }>;

export type ColumnPlan =
  | Readonly<{ ok: true; columns: readonly PlannedColumn[] }>
  | Readonly<{ ok: false; issues: readonly ColumnIssue[] }>;

/**
 * Convierte las columnas de la petición en columnas guardables (plan
 * worksheets 03, V1–V4, V11). Nunca lanza: devuelve las columnas o todos los
 * problemas con su campo (`columns.2.formula.expression.args.0.column`).
 */
export function planColumns(requests: readonly ColumnRequest[]): ColumnPlan {
  const planner = new ColumnPlanner(requests);
  const columns = planner.plan();
  if (planner.issues.length > 0) {
    return { ok: false, issues: planner.issues };
  }
  return { ok: true, columns };
}

/**
 * Estado del planificador: los IDs ya asignados (las fórmulas los necesitan
 * para resolver nombres) y los problemas encontrados.
 */
class ColumnPlanner {
  readonly issues: ColumnIssue[] = [];
  private readonly ids: string[];
  private readonly positionsByName = new Map<string, number>();

  constructor(private readonly requests: readonly ColumnRequest[]) {
    this.ids = requests.map(() => randomUUID());
    requests.forEach((request, position) => {
      const key = normalizeName(request.name);
      if (this.positionsByName.has(key)) {
        this.report(
          `columns.${position}.name`,
          ErrorCodes.WORKSHEET_COLUMN_DUPLICATE,
        );
        return;
      }
      this.positionsByName.set(key, position);
    });
  }

  plan(): PlannedColumn[] {
    const columns = this.requests.map((request, position) =>
      this.planColumn(request, position),
    );
    this.reportCycles(columns);
    return columns;
  }

  private planColumn(request: ColumnRequest, position: number): PlannedColumn {
    const path = `columns.${position}`;
    return {
      columnId: this.ids[position],
      name: request.name,
      nameNormalized: normalizeName(request.name),
      type: request.type,
      position,
      required: request.required,
      ...this.planOptions(request, path),
      ...this.planFormula(request, path),
    };
  }

  /** Opciones solo en selección; ahí, de 1 a 100 y con etiquetas distintas. */
  private planOptions(request: ColumnRequest, path: string) {
    if (request.type !== 'selection') {
      if (request.options !== undefined) {
        this.report(`${path}.options`, ErrorCodes.COLUMN_OPTIONS_INVALID);
      }
      return {};
    }

    const labels = request.options ?? [];
    const distinctLabels = new Set(
      labels.map(({ label }) => normalizeName(label)),
    );
    const isValidList =
      labels.length >= 1 &&
      labels.length <= WORKSHEET_LIMITS.optionsPerColumn &&
      distinctLabels.size === labels.length;
    if (!isValidList) {
      this.report(`${path}.options`, ErrorCodes.COLUMN_OPTIONS_INVALID);
      return {};
    }
    return {
      options: labels.map(({ label }) => ({ id: randomUUID(), label })),
    };
  }

  /** Fórmula solo en calculada; una calculada no puede ser obligatoria (V6). */
  private planFormula(request: ColumnRequest, path: string) {
    if (request.type !== 'calculated') {
      if (request.formula !== undefined) {
        this.report(`${path}.formula`, ErrorCodes.COLUMN_FORMULA_INVALID);
      }
      return {};
    }
    if (request.required) {
      this.report(`${path}.required`, ErrorCodes.COLUMN_FORMULA_INVALID);
    }

    const formula = request.formula;
    if (!isFormulaShape(formula)) {
      this.report(`${path}.formula`, ErrorCodes.COLUMN_FORMULA_INVALID);
      return {};
    }
    const counter = { nodes: 0 };
    const expression = this.planExpression(
      formula.expression,
      `${path}.formula.expression`,
      1,
      counter,
    );
    if (counter.nodes > FORMULA_LIMITS.nodes) {
      this.report(
        `${path}.formula.expression`,
        ErrorCodes.COLUMN_FORMULA_INVALID,
      );
    }
    if (!expression) {
      return {};
    }
    return {
      formula: {
        engine: CALCULATION_ENGINE,
        expression,
        scale: formula.scale,
        rounding: formula.rounding,
      } satisfies StoredFormula,
    };
  }

  /** Recorre el árbol de la petición y lo devuelve con IDs en lugar de nombres. */
  private planExpression(
    node: unknown,
    path: string,
    depth: number,
    counter: { nodes: number },
  ): FormulaExpression | null {
    counter.nodes += 1;
    if (depth > FORMULA_LIMITS.depth) {
      this.report(path, ErrorCodes.COLUMN_FORMULA_INVALID);
      return null;
    }

    if (isOperationShape(node)) {
      const [left, right] = node.args.map((arg, index) =>
        this.planExpression(arg, `${path}.args.${index}`, depth + 1, counter),
      );
      return left && right ? { op: node.op, args: [left, right] } : null;
    }
    if (isColumnShape(node)) {
      return this.resolveColumn(node.column, `${path}.column`);
    }
    if (isConstantShape(node)) {
      return { value: node.value };
    }
    this.report(path, ErrorCodes.COLUMN_FORMULA_INVALID);
    return null;
  }

  /** El nombre tiene que ser una columna numérica o calculada de la misma hoja. */
  private resolveColumn(name: string, path: string): FormulaExpression | null {
    const position = this.positionsByName.get(normalizeName(name));
    const isNumericInput =
      position !== undefined &&
      NUMERIC_COLUMN_TYPES.includes(this.requests[position].type);
    if (position === undefined || !isNumericInput) {
      this.report(path, ErrorCodes.COLUMN_FORMULA_REFERENCE_INVALID);
      return null;
    }
    return { column: this.ids[position] };
  }

  /**
   * Recorrido en profundidad por las calculadas (C20). Una columna que se
   * reencuentra mientras está «en visita» cierra un ciclo; se marca cada
   * columna del ciclo, incluida una que se nombra a sí misma.
   */
  private reportCycles(columns: readonly PlannedColumn[]) {
    const byId = new Map(columns.map((column) => [column.columnId, column]));
    const state = new Map<string, 'visiting' | 'done'>();
    const onCycle = new Set<string>();
    const stack: string[] = [];

    const visit = (columnId: string) => {
      if (state.get(columnId) === 'done') {
        return;
      }
      if (state.get(columnId) === 'visiting') {
        for (const id of stack.slice(stack.indexOf(columnId))) {
          onCycle.add(id);
        }
        return;
      }
      state.set(columnId, 'visiting');
      stack.push(columnId);
      const formula = byId.get(columnId)?.formula;
      for (const reference of formula
        ? referencedColumns(formula.expression)
        : []) {
        if (byId.get(reference)?.type === 'calculated') {
          visit(reference);
        }
      }
      stack.pop();
      state.set(columnId, 'done');
    };

    for (const column of columns) {
      if (column.type === 'calculated') {
        visit(column.columnId);
      }
    }
    for (const column of columns) {
      if (onCycle.has(column.columnId)) {
        this.report(
          `columns.${column.position}.formula`,
          ErrorCodes.COLUMN_FORMULA_CYCLE,
        );
      }
    }
  }

  private report(field: string, code: ErrorCode) {
    this.issues.push({ field, code });
  }
}

/** IDs de las columnas que nombra una fórmula, en orden y sin repetir. */
export function referencedColumns(expression: FormulaExpression): string[] {
  if ('column' in expression) {
    return [expression.column];
  }
  if ('value' in expression) {
    return [];
  }
  return [...new Set(expression.args.flatMap((arg) => referencedColumns(arg)))];
}

type FormulaShape = Readonly<{
  expression: unknown;
  scale: number;
  rounding: RoundingMode;
}>;

const OPERATOR_SET = new Set<string>(FORMULA_OPERATORS);
const ROUNDING_SET = new Set<string>(ROUNDING_MODES);

function isFormulaShape(value: unknown): value is FormulaShape {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['expression', 'scale', 'rounding']) &&
    'expression' in value &&
    Number.isInteger(value.scale) &&
    typeof value.scale === 'number' &&
    value.scale >= 0 &&
    value.scale <= FORMULA_LIMITS.maxScale &&
    typeof value.rounding === 'string' &&
    ROUNDING_SET.has(value.rounding)
  );
}

function isOperationShape(value: unknown): value is Readonly<{
  op: FormulaOperator;
  args: readonly [unknown, unknown];
}> {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['op', 'args']) &&
    typeof value.op === 'string' &&
    OPERATOR_SET.has(value.op) &&
    Array.isArray(value.args) &&
    value.args.length === 2
  );
}

function isColumnShape(value: unknown): value is Readonly<{ column: string }> {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['column']) &&
    typeof value.column === 'string'
  );
}

/** Constante decimal con forma canónica: `"0.16"`, nunca `0.16` ni `"1e3"`. */
function isConstantShape(value: unknown): value is Readonly<{ value: string }> {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['value']) &&
    isCanonicalValue({ type: 'decimal' }, value.value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}
