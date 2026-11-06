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
}>;

export type Worksheet = WorksheetSummary &
  Readonly<{ columns: readonly WorksheetColumn[] }>;

/** Lo que puede hacer quien pregunta (W9). */
export type WorksheetCapabilities = Readonly<{
  write: boolean;
  approve: boolean;
}>;
