import type { AuthenticatedRequest } from '../auth/authenticated-request.js';
import {
  ApplicationFailure,
  type PublicError,
} from '../common/http/public-error.js';
import type { RetryOptions } from '../jobs/retry-delay.js';

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
  /** Lo pone `assignRequestId` en cada petición (jobs&files, D12). */
  requestId?: string;
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
  /** Token del reclamo: solo con él se puede escribir (plan jobs&files, D4). */
  token: string;
  /** Fallos temporales ya consumidos. */
  attempts: number;
  /** Duración del lease; cada escritura del worker lo renueva (D5). */
  leaseMs: number;
};

/** Fallo esperado de una importación; su `detail` se guarda tal cual. */
export class ImportFailure extends ApplicationFailure {}

export const CATALOG_IMPORT_OPTIONS = Symbol('CATALOG_IMPORT_OPTIONS');
export type CatalogImportOptions = {
  autoStart: boolean;
  pollMs: number;
  shutdownMs: number;
  /** Si faltan, `IMPORT_JOB_DEFAULTS`. */
  leaseMs?: number;
  retry?: RetryOptions;
};

/**
 * Lease y reintentos de los trabajos de importación (plan jobs&files, D4 y D5).
 * Un lote tarda segundos: dos minutos sin escribir solo pasan si el proceso
 * cayó. Tres fallos temporales, con esperas cortas, antes de rendirse.
 */
export const IMPORT_JOB_DEFAULTS = Object.freeze({
  leaseMs: 2 * 60_000,
  retry: Object.freeze({
    baseDelayMs: 5_000,
    maxDelayMs: 60_000,
    maxAttempts: 3,
  }),
});
