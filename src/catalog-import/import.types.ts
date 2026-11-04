import type { AuthenticatedRequest } from '../auth/authenticated-request.js';
import {
  ApplicationFailure,
  type PublicError,
} from '../common/http/public-error.js';

export const IMPORT_LIMITS = {
  fileBytes: 10_485_760,
  rows: 5_000,
  columns: 200,
  recordSize: 1_048_576,
  batchRows: 250,
  batchBytes: 1_048_576,
  sampleRows: 20,
} as const;

export type ImportDelimiter = 'comma' | 'semicolon';

export type ImportError = PublicError;

export type ImportRow = {
  sourceRow: number;
  externalId: string;
  originalValues: Record<string, string>;
};

/** Archivo ya guardado en `tmp/` por `ArtifactStore.receive`. */
export type StoredUpload = { filename: string; size: number; hash: string };

/** Datos que el guard y el interceptor añaden a la request de subida. */
export type ImportRequest = AuthenticatedRequest & {
  importOwnerId?: string;
  importRequestId?: string;
  file?: Express.Multer.File & StoredUpload;
};

export type Acceptance = {
  snapshotId: string;
  jobId: string;
  projectId: string;
  ownerId: string;
  artifactKey: string;
  sourceHash: string;
  byteSize: number;
  originalName: string;
  idColumn: string;
  delimiter: ImportDelimiter;
  requestId: string;
};

/** Importación borrada en la base cuyo archivo falta retirar del disco. */
/**
 * Lo que hay que retirar del disco tras borrar una importación: su CSV y los TSV
 * de las exportaciones que se borraron en cascada con sus evaluaciones.
 */
export type DeletedImport = {
  snapshotId: string;
  artifactKey: string;
  exportArtifactKeys: string[];
};

/**
 * Lo que hay que retirar del disco tras borrar un proyecto: lo de cada
 * importación y los archivos de las versiones de su feed.
 */
export type DeletedProject = {
  imports: DeletedImport[];
  feedArtifactKeys: string[];
};

/** Trabajo que el worker ha reclamado y está procesando. */
export type ClaimedImport = {
  id: string;
  snapshotId: string;
  projectId: string;
  requestId: string;
  artifactKey: string;
  sourceHash: string;
  byteSize: number;
  idColumn: string;
  delimiter: ImportDelimiter;
};

/** Fallo esperado de una importación; su `detail` se guarda tal cual. */
export class ImportFailure extends ApplicationFailure {}

export const CATALOG_IMPORT_OPTIONS = Symbol('CATALOG_IMPORT_OPTIONS');
export type CatalogImportOptions = {
  autoStart: boolean;
  pollMs: number;
  shutdownMs: number;
};
