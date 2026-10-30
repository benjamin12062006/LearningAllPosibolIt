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

export type ImportError = PublicError;
export type ImportRow = {
  sourceRow: number;
  externalId: string;
  originalValues: Record<string, string>;
};
export type StoredUpload = { filename: string; size: number; hash: string };
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
  delimiter: 'comma' | 'semicolon';
  requestId: string;
};
export type ClaimedImport = {
  id: string;
  snapshotId: string;
  projectId: string;
  requestId: string;
  artifactKey: string;
  sourceHash: string;
  byteSize: number;
  idColumn: string;
  delimiter: 'comma' | 'semicolon';
};

export class ImportFailure extends ApplicationFailure {}

export const CATALOG_IMPORT_OPTIONS = Symbol('CATALOG_IMPORT_OPTIONS');
export type CatalogImportOptions = {
  root: string;
  autoStart: boolean;
  pollMs: number;
  shutdownMs: number;
};
