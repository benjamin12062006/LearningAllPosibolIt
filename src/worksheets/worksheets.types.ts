import type { ColumnType } from './worksheet-columns.js';

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

export type WorksheetColumn = Readonly<{
  id: string;
  name: string;
  type: ColumnType;
  position: number;
  required: boolean;
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
