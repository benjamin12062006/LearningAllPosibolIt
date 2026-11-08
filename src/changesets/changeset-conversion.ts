import { convertValue } from '../worksheets/cell-conversion.js';
import type { ColumnType } from '../worksheets/worksheet-columns.js';
import type { WorksheetColumn } from '../worksheets/worksheets.types.js';
import {
  isRowOperation,
  type Operation,
  type RowValues,
  type SetCell,
} from './changeset-operations.js';
import {
  isSchemaOperation,
  resultingColumns,
  type ChangeColumnType,
} from './changeset-schema.js';

/** Lo que el cambio de tipo hace con una columna; es lo que se previsualiza. */
export type ColumnConversion = Readonly<{
  columnId: string;
  fromType: ColumnType;
  toType: ColumnType;
  /** Celdas con valor que pasan al tipo nuevo. */
  convertedCells: number;
  /** Celdas que no tienen forma exacta en el tipo nuevo: bloquean enviar. */
  incompatibleCells: number;
}>;

export type ConversionPlan = Readonly<{
  /** Un `set_cell` por celda convertida; van detrás de las del borrador. */
  operations: readonly SetCell[];
  conversions: readonly ColumnConversion[];
  /** Las celdas que se quedan con su valor de antes, ya inválido. */
  incompatible: readonly Readonly<{ rowId: string; columnId: string }>[];
}>;

const NO_CONVERSION: ConversionPlan = {
  operations: [],
  conversions: [],
  incompatible: [],
};

/** Columnas de la base cuyo tipo cambia el borrador: sus filas hay que leerlas todas. */
export function retypedColumnIds(operations: readonly Operation[]): string[] {
  return operations.filter(isChangeColumnType).map(({ columnId }) => columnId);
}

/**
 * La conversión de un borrador (C5 del plan de cierre). Se calcula siempre a
 * partir de la revisión base, al revisar y al aplicar: así el borrador no
 * guarda un `set_cell` por fila (pasaría de las 1.000 operaciones) y la vista
 * previa es lo mismo que se aplica. `baseRows` tiene que traer todas las filas
 * vivas con valor en las columnas que cambian de tipo.
 *
 * Se saltan las filas que el borrador borra y las celdas que el borrador ya
 * fija con su propio `set_cell`: es como se corrige un incompatible.
 */
export function planConversion(
  operations: readonly Operation[],
  baseColumns: readonly WorksheetColumn[],
  baseRows: RowValues,
): ConversionPlan {
  const changes = operations.filter(isChangeColumnType);
  if (changes.length === 0) {
    return NO_CONVERSION;
  }
  const resulting = new Map(
    resultingColumns(baseColumns, operations.filter(isSchemaOperation)).map(
      (column) => [column.id, column],
    ),
  );
  const baseById = new Map(baseColumns.map((column) => [column.id, column]));
  const draft = DraftCells.of(operations);

  const plan = new ConversionBuilder();
  for (const change of changes) {
    const from = baseById.get(change.columnId);
    const to = resulting.get(change.columnId);
    if (!from || !to) {
      continue;
    }
    plan.startColumn(from, to);
    for (const [rowId, values] of baseRows) {
      const value = values[change.columnId];
      const isConvertible =
        value !== undefined &&
        value !== null &&
        !draft.decides(rowId, change.columnId);
      if (isConvertible) {
        plan.convert(rowId, from, to, value);
      }
    }
  }
  return plan.finish();
}

function isChangeColumnType(
  operation: Operation,
): operation is ChangeColumnType {
  return operation.type === 'change_column_type';
}

/** Lo que el propio borrador decide sobre filas y celdas. */
class DraftCells {
  private constructor(
    private readonly deletedRows: ReadonlySet<string>,
    private readonly setCells: ReadonlySet<string>,
  ) {}

  static of(operations: readonly Operation[]) {
    const deletedRows = new Set<string>();
    const setCells = new Set<string>();
    for (const operation of operations.filter(isRowOperation)) {
      if (operation.type === 'delete_row') {
        deletedRows.add(operation.rowId);
      } else if (operation.type === 'set_cell') {
        setCells.add(cellKey(operation.rowId, operation.columnId));
      }
    }
    return new DraftCells(deletedRows, setCells);
  }

  decides(rowId: string, columnId: string) {
    return (
      this.deletedRows.has(rowId) || this.setCells.has(cellKey(rowId, columnId))
    );
  }
}

/** Las operaciones, los recuentos por columna y los incompatibles, a la vez. */
class ConversionBuilder {
  private readonly operations: SetCell[] = [];
  private readonly conversions: ColumnConversion[] = [];
  private readonly incompatible: { rowId: string; columnId: string }[] = [];
  private current: {
    columnId: string;
    fromType: ColumnType;
    toType: ColumnType;
    convertedCells: number;
    incompatibleCells: number;
  } | null = null;

  startColumn(from: WorksheetColumn, to: WorksheetColumn) {
    this.closeColumn();
    this.current = {
      columnId: from.id,
      fromType: from.type,
      toType: to.type,
      convertedCells: 0,
      incompatibleCells: 0,
    };
  }

  convert(
    rowId: string,
    from: WorksheetColumn,
    to: WorksheetColumn,
    value: unknown,
  ) {
    if (!this.current) {
      return;
    }
    const converted =
      typeof value === 'string' || typeof value === 'boolean'
        ? convertValue(from, to, value)
        : null;
    if (converted?.kind === 'value') {
      this.operations.push({
        type: 'set_cell',
        rowId,
        columnId: from.id,
        value: converted.value,
      });
      this.current.convertedCells += 1;
      return;
    }
    this.incompatible.push({ rowId, columnId: from.id });
    this.current.incompatibleCells += 1;
  }

  finish(): ConversionPlan {
    this.closeColumn();
    return {
      operations: this.operations,
      conversions: this.conversions,
      incompatible: this.incompatible,
    };
  }

  private closeColumn() {
    if (this.current) {
      this.conversions.push({ ...this.current });
      this.current = null;
    }
  }
}

/** Los UUID no llevan `:`: no hay dos celdas con la misma clave. */
function cellKey(rowId: string, columnId: string) {
  return `${rowId}:${columnId}`;
}
