/**
 * Tipos de columna. Los cinco primeros guardan su valor en la celda (E3.1);
 * `selection` guarda el ID de una opción y `calculated` no guarda nada: su
 * valor sale del motor de cálculo (E3.3, plan worksheets 03). La migración
 * limita `type` a esta misma lista.
 */
export const COLUMN_TYPES = [
  'text',
  'integer',
  'decimal',
  'date',
  'boolean',
  'selection',
  'calculated',
] as const;

export type ColumnType = (typeof COLUMN_TYPES)[number];

/** Tipos que una fórmula puede usar como entrada (V4). */
export const NUMERIC_COLUMN_TYPES: readonly ColumnType[] = [
  'integer',
  'decimal',
  'calculated',
];

/** Límites de lanzamiento de [12]; son propuesta sujeta a pruebas. */
export const WORKSHEET_LIMITS = {
  columnsPerWorksheet: 200,
  nameLength: 120,
  optionsPerColumn: 100,
  /** Filas vivas de una revisión; se comprueba al aplicar (plan imports&exports 01). */
  rowsPerWorksheet: 5000,
} as const;

export function exceedsRowLimit(rowCount: number) {
  return rowCount > WORKSHEET_LIMITS.rowsPerWorksheet;
}

/** Opción de una columna de selección: la celda guarda `id`, no la etiqueta (V1). */
export type SelectionOption = Readonly<{ id: string; label: string }>;

/**
 * «Precio», « precio » y «PRECIO» son el mismo nombre: los nombres son únicos
 * con esta forma (W4, W5). Es la misma expresión que comprueba la migración.
 */
export function normalizeName(name: string) {
  return name.trim().toLowerCase();
}
