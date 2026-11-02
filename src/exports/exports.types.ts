import type { WrittenArtifact } from '../artifacts/artifact.store.js';
import type { ExportApproval } from './export-approval.js';

/**
 * Lo que devuelven `POST` y `GET …/exports/:exportId` (D9). La clave del archivo
 * es interna y no sale del servidor (RC1).
 */
export type ExportView = Readonly<{
  id: string;
  evaluationId: string;
  acceptedInvalidCount: number;
  acceptedExcludedCount: number;
  rowCount: number;
  byteSize: number;
  tsvChecksum: string;
  createdAt: string;
}>;

/** Una exportación lista para guardar: la aprobación y el TSV ya escrito. */
export type NewExport = Readonly<{
  id: string;
  ownerId: string;
  projectId: string;
  evaluationId: string;
  approval: ExportApproval;
  rowCount: number;
  file: WrittenArtifact;
  createdAt: string;
}>;

export const EXPORT_OPTIONS = Symbol('EXPORT_OPTIONS');
export type ExportOptions = {
  /** Limpiar al arrancar los TSV que ninguna exportación referencia. */
  autoStart: boolean;
};
