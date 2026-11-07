import type { WorksheetExportExtension } from '../artifacts/artifact.store.js';
import type { CsvFormulaPolicy } from './export-csv.js';

export type ExportFormat = WorksheetExportExtension;

/** Los mismos nombres que el separador al importar (E5.1). */
export type CsvDelimiterName = 'comma' | 'semicolon';

export type CsvExportOptions = Readonly<{
  delimiter: CsvDelimiterName;
  formulas: CsvFormulaPolicy;
}>;

/** XLSX no tiene opciones: el texto nunca es una fórmula. */
export type ExportOptions = CsvExportOptions | Readonly<Record<string, never>>;

/** Columnas, filtro y orden ya validados contra la revisión (D16). */
export type ExportQuery = Readonly<{
  columnIds: readonly string[];
  filter: unknown;
  sort: readonly Readonly<{ columnId: string; direction: 'asc' | 'desc' }>[];
}>;

/** Lo que devuelven `POST` y `GET`; la clave del archivo no sale del servidor. */
export type WorksheetExport = Readonly<{
  id: string;
  worksheetId: string;
  revisionId: string;
  revisionSequence: number;
  createdBy: string;
  format: ExportFormat;
  options: ExportOptions;
  query: ExportQuery;
  serializerVersion: string;
  rowCount: number;
  columnCount: number;
  problemCellCount: number;
  byteSize: number;
  checksum: string;
  createdAt: string;
}>;

/**
 * Cambia cuando cambia cómo se escribe una celda: dos exportaciones con la
 * misma versión, revisión y consulta tienen los mismos bytes (D21).
 */
export const SERIALIZER_VERSION = 'worksheet-export/1';

export const WORKSHEET_EXPORT_LIMITS = {
  /**
   * Contenido sin comprimir (el CSV, o el XML de la hoja en un XLSX): el
   * tamaño canónico inicial de una revisión en [12].
   */
  contentBytes: 50 * 1024 * 1024,
  /**
   * Filas por lectura: una página se serializa sin ceder el bucle de eventos,
   * así que su tamaño acota el bloqueo (ficha 03, medición).
   */
  rowsPerPage: 200,
} as const;

export const WORKSHEET_EXPORT_OPTIONS = Symbol('WORKSHEET_EXPORT_OPTIONS');
export type WorksheetExportOptions = {
  /** Limpiar al arrancar los archivos que ninguna exportación referencia. */
  autoStart: boolean;
};
