/**
 * Tipos de columna de E3.1 (plan worksheets 01, W3). `selection` necesita
 * opciones y `calculated` un AST: llegan con los validadores de E3.3. La
 * migración limita `type` a esta misma lista.
 */
export const COLUMN_TYPES = [
  'text',
  'integer',
  'decimal',
  'date',
  'boolean',
] as const;

export type ColumnType = (typeof COLUMN_TYPES)[number];

/** Límites de lanzamiento de [12]; son propuesta sujeta a pruebas. */
export const WORKSHEET_LIMITS = {
  columnsPerWorksheet: 200,
  nameLength: 120,
} as const;

/** Lo que el cliente describe de una columna; el ID lo pone el servidor. */
export type ColumnDefinition = Readonly<{
  name: string;
  type: ColumnType;
  required: boolean;
}>;

/**
 * «Precio», « precio » y «PRECIO» son el mismo nombre: los nombres son únicos
 * con esta forma (W4, W5). Es la misma expresión que comprueba la migración.
 */
export function normalizeName(name: string) {
  return name.trim().toLowerCase();
}
