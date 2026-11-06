import type { Operation } from './changeset-operations.js';

/** Estados de [13]; `applied` y `cancelled` son finales. */
export type ChangesetStatus =
  | 'draft'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'conflicted'
  | 'applied'
  | 'cancelled';

export type Changeset = Readonly<{
  id: string;
  worksheetId: string;
  authorId: string;
  source: 'manual' | 'revert';
  title: string;
  status: ChangesetStatus;
  /** ETag del borrador: cambia con cada guardado o reapertura (D3, D7). */
  draftVersion: number;
  baseRevisionId: string;
  baseSequence: number;
  baseSchemaVersion: number;
  operations: readonly Operation[];
  /** Existe desde el envío: es lo que se revisa y se aprueba. */
  contentHash: string | null;
  appliedRevisionId: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type RevisionPointer = Readonly<{
  id: string;
  sequence: number;
  schemaVersion: number;
}>;

export type Decision = Readonly<{
  id: string;
  actorId: string;
  decision: 'accept' | 'reject';
  contentHash: string;
  draftVersion: number;
  headRevisionId: string;
  policy: 'peer' | 'single_member';
  reason: string | null;
  createdAt: string;
}>;

/** Lo que devuelve aplicar, y lo que guarda su recibo. */
export type ApplyResult = Readonly<{
  changesetId: string;
  revisionId: string;
  sequence: number;
}>;

export function isApplyResult(value: unknown): value is ApplyResult {
  if (!isRecord(value)) {
    return false;
  }
  const { changesetId, revisionId, sequence } = value;
  return (
    typeof changesetId === 'string' &&
    typeof revisionId === 'string' &&
    Number.isInteger(sequence)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
