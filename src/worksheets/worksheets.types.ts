import type { StoredFormula } from './formula.js';
import type { ColumnType, SelectionOption } from './worksheet-columns.js';

/** Organización y proyecto de la ruta: solo son selectores que se comprueban. */
export type ProjectScope = Readonly<{
  organizationId: string;
  projectId: string;
}>;

export type Workbook = Readonly<{
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  /** Nulo si está activo. */
  archivedAt: string | null;
}>;

/**
 * `options` solo aparece en las de selección y `formula` solo en las
 * calculadas: el resto de columnas tienen la misma forma que en E3.1.
 */
export type WorksheetColumn = Readonly<{
  id: string;
  name: string;
  type: ColumnType;
  position: number;
  required: boolean;
  options?: readonly SelectionOption[];
  formula?: StoredFormula;
}>;

export type WorksheetRevisionSummary = Readonly<{
  id: string;
  sequence: number;
  rowCount: number;
  createdAt: string;
}>;

/** Cómo nació una revisión: vacía, de un borrador aplicado o como copia de otra hoja. */
export type RevisionSource =
  'initialize' | 'changeset' | 'duplicate' | 'catalog';

/** Una revisión en el historial de la hoja (plan 02 de cierre, H2). */
export type WorksheetRevisionEntry = Readonly<{
  id: string;
  sequence: number;
  schemaVersion: number;
  source: RevisionSource;
  rowCount: number;
  /** El borrador que la produjo; nulo si no salió de uno. */
  changesetId: string | null;
  createdBy: string;
  createdAt: string;
}>;

/** Hoja en un listado: sin columnas. */
export type WorksheetSummary = Readonly<{
  id: string;
  workbookId: string;
  name: string;
  mode: 'free';
  schemaVersion: number;
  generation: number;
  headRevision: WorksheetRevisionSummary;
  createdAt: string;
  /** Nulo si la hoja está activa. */
  archivedAt: string | null;
  /** No nulo si su libro está archivado: entonces la hoja tampoco admite cambios. */
  workbookArchivedAt: string | null;
  /** Solo en una copia: de qué hoja y de qué revisión salió. */
  duplicatedFrom: Readonly<{ worksheetId: string; revisionId: string }> | null;
  /** Solo en una hoja abierta desde un catálogo (H5): el snapshot del que salió. */
  openedFromCatalog: Readonly<{ snapshotId: string }> | null;
}>;

export type Worksheet = WorksheetSummary &
  Readonly<{ columns: readonly WorksheetColumn[] }>;

/** Lo que puede hacer quien pregunta (W9). */
export type WorksheetCapabilities = Readonly<{
  write: boolean;
  approve: boolean;
}>;
