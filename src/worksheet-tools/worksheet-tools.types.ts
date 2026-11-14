import type { CellValue } from '../changesets/changeset-operations.js';
import type { ProjectScope } from '../worksheets/worksheets.types.js';

export type WorksheetToolScope = ProjectScope &
  Readonly<{ actorId: string; worksheetId: string }>;

type RevisionContext = Readonly<{
  revisionId: string;
  revisionSequence: number;
  schemaVersion: number;
}>;

export type NewWorksheetSelection = Readonly<{
  rowIds: readonly string[];
  columnIds: readonly string[];
  expiresAt: string;
}>;

export type WorksheetSelection = NewWorksheetSelection &
  RevisionContext &
  Readonly<{ id: string }>;

export type TransformChange = Readonly<{
  rowId: string;
  columnId: string;
  before: CellValue;
  after: CellValue;
}>;

export type NewWorksheetPreview = Readonly<{
  changes: readonly TransformChange[];
  issueCount: number;
  expiresAt: string;
}>;

export type WorksheetPreview = NewWorksheetPreview &
  RevisionContext &
  Readonly<{
    id: string;
    selectionId: string;
    hash: string;
    changesetId: string | null;
  }>;

export type CreateWorksheetChangeProposal = Readonly<{
  previewId: string;
  explanation: string;
  idempotencyKey: string;
  now: Date;
  expectedHash?: string;
}>;

export type WorksheetChangeProposal = Readonly<{
  id: string;
  worksheetId: string;
  baseRevisionId: string;
  draftVersion: 1;
  status: 'draft';
}>;
