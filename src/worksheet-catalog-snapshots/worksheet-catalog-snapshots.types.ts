/** Una columna elegida y la cabecera que tiene en el snapshot (su nombre en la revisión). */
export type CatalogColumn = Readonly<{ columnId: string; header: string }>;

/** Filtro y orden tal como se validaron (D24). */
export type CatalogQuery = Readonly<{
  filter: unknown;
  sort: readonly Readonly<{ columnId: string; direction: 'asc' | 'desc' }>[];
}>;

/**
 * Procedencia de un snapshot de catálogo creado desde una revisión de hoja
 * (D27). Es lo que devuelven `POST` y `GET`.
 */
export type WorksheetCatalogSnapshot = Readonly<{
  snapshotId: string;
  worksheetId: string;
  revisionId: string;
  revisionSequence: number;
  createdBy: string;
  idColumnId: string;
  columns: readonly CatalogColumn[];
  query: CatalogQuery;
  serializerVersion: string;
  rowCount: number;
  sourceHash: string;
  createdAt: string;
}>;

/**
 * Cambia cuando cambia cómo se escribe una celda en el CSV del catálogo: la
 * misma versión, revisión y petición dan los mismos bytes (D28).
 */
export const CATALOG_SERIALIZER_VERSION = 'worksheet-catalog/1';

export const WORKSHEET_CATALOG_LIMITS = {
  /** Filas por lectura, las mismas que al exportar (ficha 03, medición). */
  rowsPerPage: 200,
  /** Problemas que se devuelven como mucho, los mismos que al importar. */
  reportedProblems: 500,
} as const;
