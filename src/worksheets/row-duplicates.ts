/*
 * Filas repetidas por una clave de columnas (plan 09 del asistente, etapa 2).
 * El criterio va siempre en la respuesta: qué columnas, cómo se comparan y qué
 * fila se conserva. Así la persona ve por qué se propone borrar cada una.
 */

/** `exact`: el valor guardado. `normalized`: sin espacios de más y sin mayúsculas. */
export const KEY_COMPARISONS = ['exact', 'normalized'] as const;
export type KeyComparison = (typeof KEY_COMPARISONS)[number];

/** En el orden de la hoja: la primera o la última de cada grupo. */
export const KEEP_RULES = ['first', 'last'] as const;
export type KeepRule = (typeof KEEP_RULES)[number];

export type DuplicateCriterion = Readonly<{
  columnIds: readonly string[];
  comparison: KeyComparison;
  keep: KeepRule;
}>;

export type KeyedRow = Readonly<{
  rowId: string;
  cellValues: Readonly<Record<string, unknown>>;
}>;

export type DuplicateGroup = Readonly<{
  /** Los valores de la clave tal como están en la fila que se conserva. */
  key: Readonly<Record<string, unknown>>;
  keepRowId: string;
  removeRowIds: readonly string[];
}>;

export type DuplicateScan = Readonly<{
  groups: readonly DuplicateGroup[];
  /** Filas sin ningún valor en la clave: no se agrupan entre sí. */
  rowsWithEmptyKey: number;
}>;

/**
 * Agrupa un recorrido completo de la revisión en su orden. Se acumula grupo a
 * grupo para no guardar dos veces cada fila.
 */
export class DuplicateFinder {
  private readonly rowsByKey = new Map<string, string[]>();
  private readonly firstKeyValues = new Map<string, Record<string, unknown>>();
  private emptyKeys = 0;

  constructor(private readonly criterion: DuplicateCriterion) {}

  add(rows: readonly KeyedRow[]) {
    for (const row of rows) {
      const values = this.keyValuesOf(row);
      if (hasNoValue(values)) {
        this.emptyKeys += 1;
        continue;
      }
      const key = this.comparableKey(values);
      const group = this.rowsByKey.get(key);
      if (group) {
        group.push(row.rowId);
      } else {
        this.rowsByKey.set(key, [row.rowId]);
        this.firstKeyValues.set(key, values);
      }
    }
  }

  result(): DuplicateScan {
    const groups: DuplicateGroup[] = [];
    for (const [key, rowIds] of this.rowsByKey) {
      if (rowIds.length < 2) {
        continue;
      }
      const keepRowId =
        this.criterion.keep === 'first' ? rowIds[0] : rowIds[rowIds.length - 1];
      groups.push({
        key: this.firstKeyValues.get(key) ?? {},
        keepRowId,
        removeRowIds: rowIds.filter((rowId) => rowId !== keepRowId),
      });
    }
    return { groups, rowsWithEmptyKey: this.emptyKeys };
  }

  private keyValuesOf(row: KeyedRow) {
    return Object.fromEntries(
      this.criterion.columnIds.map((columnId) => [
        columnId,
        row.cellValues[columnId] ?? null,
      ]),
    );
  }

  private comparableKey(values: Record<string, unknown>) {
    const parts = this.criterion.columnIds.map((columnId) => {
      const value = values[columnId];
      if (
        this.criterion.comparison === 'normalized' &&
        typeof value === 'string'
      ) {
        return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
      }
      return value;
    });
    return JSON.stringify(parts);
  }
}

function hasNoValue(values: Record<string, unknown>) {
  return Object.values(values).every((value) => value === null || value === '');
}
