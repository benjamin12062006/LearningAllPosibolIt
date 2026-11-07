import type { ImportOptions } from './import-options.js';
import type { ExcludedRow, ImportReport } from './import-plan.js';

export type ImportFormat = 'csv' | 'xlsx';

/**
 * Una celda de XLSX que no es texto (plan imports&exports 01, D13). Se
 * convierte por su tipo y no como texto escrito: un número no depende de
 * `decimalSeparator` y una fecha ya viene como `YYYY-MM-DD`. `text` es lo que
 * se muestra en la vista previa.
 */
export type TypedCell = Readonly<{
  kind: 'number' | 'date' | 'boolean' | 'error' | 'uncalculated';
  text: string;
}>;

/** Texto tal cual (CSV y celdas de texto de XLSX) o una celda con tipo. */
export type ImportField = string | TypedCell;

/** El archivo leído: cabeceras y filas, más la huella del archivo. */
export type ImportTable = Readonly<{
  format: ImportFormat;
  headers: readonly string[];
  /** `rows[i]` es la fila de origen `i + 1` (sin contar la cabecera). */
  rows: readonly (readonly ImportField[])[];
  fileHash: string;
  fileBytes: number;
}>;

/** Procedencia de una importación: lo que se pidió y lo que salió (D6, D7). */
export type WorksheetImport = Readonly<{
  id: string;
  worksheetId: string;
  changesetId: string;
  createdBy: string;
  format: ImportFormat;
  fileHash: string;
  fileBytes: number;
  options: ImportOptions;
  report: ImportReport;
  excludedRows: readonly ExcludedRow[];
  includedHash: string;
  createdAt: string;
}>;

/** Lo que se ve antes de decidir el mapeo. */
export type ImportPreview = Readonly<{
  format: ImportFormat;
  /** Solo XLSX: hojas del libro y la que se leyó (`null` si hay que elegir). */
  sheets?: readonly string[];
  sheet?: string | null;
  fileHash: string;
  fileBytes: number;
  rows: number;
  headers: readonly string[];
  sample: readonly (readonly string[])[];
  /** Cabecera → columna existente con el mismo nombre normalizado. */
  suggestedColumns: readonly Readonly<{ header: string; columnId: string }>[];
}>;

export function isTypedCell(field: ImportField): field is TypedCell {
  return typeof field !== 'string';
}

/** Lo que se muestra de un campo en la vista previa. */
export function displayText(field: ImportField): string {
  return isTypedCell(field) ? field.text : field;
}
