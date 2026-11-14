import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { findReceipt, saveReceipt } from '../audit/audit-trail.js';
import { insertDraft } from '../changesets/changesets.repository.js';
import type { SetCell } from '../changesets/changeset-operations.js';
import type { RevisionPointer } from '../changesets/changesets.types.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { PrismaService } from '../database/prisma.service.js';
import { LONG_TRANSACTION } from '../database/transaction-timeouts.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  assertNotArchived,
  lockOrganization,
} from '../organizations/organization-lock.js';
import {
  can,
  type OrganizationRole,
} from '../organizations/organization-roles.js';
import { orderSql } from '../worksheets/row-query-sql.js';
import type {
  ReadableRevision,
  StoredRow,
} from '../worksheets/worksheet-rows.repository.js';
import type {
  CreateWorksheetChangeProposal,
  NewWorksheetPreview,
  NewWorksheetSelection,
  TransformChange,
  WorksheetChangeProposal,
  WorksheetPreview,
  WorksheetSelection,
  WorksheetToolScope,
} from './worksheet-tools.types.js';

type SheetAccess = Readonly<{
  role: OrganizationRole;
  organizationArchived: boolean;
  worksheetArchived: boolean;
}>;

const SELECTION_REVISION_COLUMNS = Prisma.sql`
  s.revision_id AS "revisionId",
  r.sequence AS "revisionSequence",
  r.schema_version AS "schemaVersion"
`;
/**
 * La caducidad se lee como texto ISO en UTC. El adaptador de Prisma convierte
 * `timestamptz` a `Date` sin la zona de la sesión y, fuera de UTC, la desplaza:
 * todo nacía caducado en una máquina en UTC−5.
 */
function isoUtc(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

const JOIN_SELECTION_REVISION = Prisma.sql`
  JOIN estadistica_forms.worksheet_revisions r
    ON r.worksheet_id = s.worksheet_id AND r.id = s.revision_id
`;

const CREATE_PROPOSAL_OPERATION = 'worksheet.transform.create_proposal';

@Injectable()
export class WorksheetToolsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async assertSheetAccess(scope: WorksheetToolScope): Promise<void> {
    const access = await findSheetAccess(this.prisma, scope);
    assertCanTransform(access);
  }

  /** Lee exclusivamente las celdas solicitadas de una revisión inmutable. */
  findRows(
    scope: WorksheetToolScope,
    sequence: number,
    request: Readonly<{
      where: Prisma.Sql;
      limit: number;
      columnIds?: readonly string[];
    }>,
  ): Promise<StoredRow[]> {
    const cells = projectCells(request.columnIds ?? []);
    return this.prisma.$queryRaw<StoredRow[]>`
      SELECT r.row_id AS "rowId", ${cells} AS "cellValues"
      FROM estadistica_forms.worksheet_row_versions r
      JOIN estadistica_forms.worksheets w
        ON w.organization_id = r.organization_id AND w.id = r.worksheet_id
      WHERE w.organization_id = ${scope.organizationId}
        AND w.project_id = ${scope.projectId}
        AND w.id = ${scope.worksheetId}
        AND r.from_sequence <= ${sequence}
        AND (r.to_sequence IS NULL OR r.to_sequence > ${sequence})
        AND NOT r.is_deleted
        AND ${selectionMembership(scope)}
        AND ${request.where}
      ORDER BY ${orderSql([])}
      LIMIT ${request.limit}`;
  }

  saveSelection(
    scope: WorksheetToolScope,
    revision: ReadableRevision,
    input: NewWorksheetSelection,
  ): Promise<WorksheetSelection> {
    return this.prisma.$transaction(async (tx) => {
      await lockSheetAccess(tx, scope);
      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO estadistica_forms.worksheet_transform_selections
          (id, organization_id, project_id, worksheet_id, actor_id, revision_id,
           row_ids, column_ids, expires_at)
        VALUES (
          ${id}, ${scope.organizationId}, ${scope.projectId}, ${scope.worksheetId},
          ${scope.actorId}, ${revision.id}, ${JSON.stringify(input.rowIds)}::jsonb,
          ${JSON.stringify(input.columnIds)}::jsonb, ${input.expiresAt}::timestamptz
        )`;
      return {
        id,
        revisionId: revision.id,
        revisionSequence: revision.sequence,
        schemaVersion: revision.schemaVersion,
        ...input,
      };
    });
  }

  findSelection(
    scope: WorksheetToolScope,
    selectionId: string,
  ): Promise<WorksheetSelection | null> {
    return findSelectionIn(this.prisma, scope, selectionId);
  }

  savePreview(
    scope: WorksheetToolScope,
    selection: WorksheetSelection,
    input: NewWorksheetPreview & Readonly<{ now?: Date }>,
  ): Promise<WorksheetPreview> {
    return this.prisma.$transaction(async (tx) => {
      await lockSheetAccess(tx, scope);
      const current = await findSelectionIn(tx, scope, selection.id, true);
      if (!current) {
        throw apiError(ErrorCodes.AI_SHEET_SELECTION_NOT_FOUND);
      }
      if (hasExpired(current.expiresAt, input.now ?? new Date())) {
        throw apiError(ErrorCodes.AI_SHEET_SELECTION_EXPIRED);
      }
      await requireCurrentHead(tx, scope, current);
      assertChangesWithinSelection(current, input.changes);

      const id = randomUUID();
      const expiresAt = earlierExpiry(current.expiresAt, input.expiresAt);
      const hash = transformHash(scope, current, input.changes);
      await tx.$executeRaw`
        INSERT INTO estadistica_forms.worksheet_transform_previews
          (id, selection_id, changes, issue_count, hash, expires_at)
        VALUES (
          ${id}, ${current.id}, ${JSON.stringify(input.changes)}::jsonb,
          ${input.issueCount}, ${hash}, ${expiresAt}::timestamptz
        )`;
      return {
        id,
        selectionId: current.id,
        revisionId: current.revisionId,
        revisionSequence: current.revisionSequence,
        schemaVersion: current.schemaVersion,
        changes: input.changes,
        issueCount: input.issueCount,
        expiresAt,
        hash,
        changesetId: null,
      };
    }, LONG_TRANSACTION);
  }

  findPreview(
    scope: WorksheetToolScope,
    previewId: string,
  ): Promise<WorksheetPreview | null> {
    return findPreviewIn(this.prisma, scope, previewId);
  }

  createProposal(
    scope: WorksheetToolScope,
    request: CreateWorksheetChangeProposal,
  ): Promise<WorksheetChangeProposal> {
    return this.prisma.$transaction(
      (tx) => this.createProposalIn(tx, scope, request),
      LONG_TRANSACTION,
    );
  }

  /**
   * La confirmación E6.3a puede compartir la transacción. El llamador toma
   * primero el bloqueo de la organización si ya tiene otros recursos bloqueados.
   */
  async createProposalIn(
    tx: Prisma.TransactionClient,
    scope: WorksheetToolScope,
    request: CreateWorksheetChangeProposal,
  ): Promise<WorksheetChangeProposal> {
    await lockSheetAccess(tx, scope);
    const receiptKey = {
      organizationId: scope.organizationId,
      actorId: scope.actorId,
      operation: CREATE_PROPOSAL_OPERATION,
      resourceId: scope.worksheetId,
      idempotencyKey: request.idempotencyKey,
    };
    const payloadHash = sha256([
      request.previewId,
      request.explanation,
      request.expectedHash ?? null,
    ]);
    const receipt = await findReceipt(tx, receiptKey);
    if (receipt) {
      if (receipt.payloadHash !== payloadHash) {
        throw apiError(ErrorCodes.IDEMPOTENCY_KEY_REUSED);
      }
      return resultFromReceipt(receipt.result);
    }

    const preview = await requireAvailablePreview(tx, scope, request);
    const base = await requireCurrentHead(tx, scope, preview);
    const id = await insertDraft(tx, scope.actorId, scope, {
      worksheetId: scope.worksheetId,
      title: request.explanation,
      source: 'ai',
      base,
      operations: draftOperations(preview.changes),
    });
    await tx.$executeRaw`
      UPDATE estadistica_forms.worksheet_transform_previews
      SET changeset_id = ${id}
      WHERE id = ${preview.id}`;
    const result: WorksheetChangeProposal = {
      id,
      worksheetId: scope.worksheetId,
      baseRevisionId: base.id,
      draftVersion: 1,
      status: 'draft',
    };
    await saveReceipt(tx, receiptKey, {
      payloadHash,
      result,
      now: request.now.toISOString(),
    });
    return result;
  }

  /** Las vistas previas se borran en cascada. Sus borradores y recibos quedan. */
  async deleteExpired(now: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        DELETE FROM estadistica_forms.worksheet_transform_selections
        WHERE expires_at <= ${now.toISOString()}::timestamptz`;
      await tx.$executeRaw`
        DELETE FROM estadistica_forms.worksheet_transform_previews
        WHERE expires_at <= ${now.toISOString()}::timestamptz`;
    });
  }
}

async function findSheetAccess(
  client: Prisma.TransactionClient,
  scope: WorksheetToolScope,
): Promise<SheetAccess | null> {
  const rows = await client.$queryRaw<SheetAccess[]>`
    SELECT
      m.role,
      o.archived_at IS NOT NULL AS "organizationArchived",
      w.archived_at IS NOT NULL OR b.archived_at IS NOT NULL AS "worksheetArchived"
    FROM estadistica_forms.worksheets w
    JOIN estadistica_forms.workbooks b
      ON b.organization_id = w.organization_id
      AND b.project_id = w.project_id
      AND b.id = w.workbook_id
    JOIN estadistica_forms.organizations o ON o.id = w.organization_id
    JOIN estadistica_forms.organization_members m
      ON m.organization_id = w.organization_id AND m.user_id = ${scope.actorId}
    WHERE w.organization_id = ${scope.organizationId}
      AND w.project_id = ${scope.projectId}
      AND w.id = ${scope.worksheetId}`;
  return rows[0] ?? null;
}

function assertCanTransform(access: SheetAccess | null): void {
  if (!access) {
    throw apiError(ErrorCodes.WORKSHEET_NOT_FOUND);
  }
  if (access.organizationArchived) {
    throw apiError(ErrorCodes.ORGANIZATION_ARCHIVED);
  }
  if (!can(access.role, 'ai.use') || !can(access.role, 'worksheet.write')) {
    throw apiError(ErrorCodes.FORBIDDEN);
  }
  if (access.worksheetArchived) {
    throw apiError(ErrorCodes.WORKSHEET_ARCHIVED);
  }
}

async function lockSheetAccess(
  tx: Prisma.TransactionClient,
  scope: WorksheetToolScope,
): Promise<void> {
  // El bloqueo común ordena archivado, roles y cambios de head con H6.
  await lockOrganization(tx, scope.organizationId);
  assertCanTransform(await findSheetAccess(tx, scope));
}

function selectionMembership(scope: WorksheetToolScope): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1
    FROM estadistica_forms.organization_members m
    WHERE m.organization_id = ${scope.organizationId}
      AND m.user_id = ${scope.actorId}
  )`;
}

function selectionScope(scope: WorksheetToolScope): Prisma.Sql {
  return Prisma.sql`
    s.organization_id = ${scope.organizationId}
    AND s.project_id = ${scope.projectId}
    AND s.worksheet_id = ${scope.worksheetId}
    AND s.actor_id = ${scope.actorId}
    AND ${selectionMembership(scope)}
  `;
}

function projectCells(columnIds: readonly string[]): Prisma.Sql {
  if (columnIds.length === 0) {
    return Prisma.sql`'{}'::jsonb`;
  }
  return Prisma.sql`(
    SELECT jsonb_object_agg(column_id, r.cell_values -> column_id)
    FROM unnest(ARRAY[${Prisma.join(columnIds)}]::text[]) AS column_id
  )`;
}

async function findSelectionIn(
  client: Prisma.TransactionClient,
  scope: WorksheetToolScope,
  selectionId: string,
  lock = false,
): Promise<WorksheetSelection | null> {
  const rows = await client.$queryRaw<WorksheetSelection[]>`
    SELECT
      s.id,
      ${SELECTION_REVISION_COLUMNS},
      s.row_ids AS "rowIds",
      s.column_ids AS "columnIds",
      ${isoUtc(Prisma.sql`s.expires_at`)} AS "expiresAt"
    FROM estadistica_forms.worksheet_transform_selections s
    ${JOIN_SELECTION_REVISION}
    WHERE s.id = ${selectionId} AND ${selectionScope(scope)}
    ${lock ? Prisma.sql`FOR UPDATE OF s` : Prisma.empty}`;
  return rows[0] ?? null;
}

async function findPreviewIn(
  client: Prisma.TransactionClient,
  scope: WorksheetToolScope,
  previewId: string,
  lock = false,
): Promise<WorksheetPreview | null> {
  const rows = await client.$queryRaw<WorksheetPreview[]>`
    SELECT
      p.id,
      p.selection_id AS "selectionId",
      ${SELECTION_REVISION_COLUMNS},
      p.changes,
      p.issue_count AS "issueCount",
      p.hash,
      ${isoUtc(Prisma.sql`p.expires_at`)} AS "expiresAt",
      p.changeset_id AS "changesetId"
    FROM estadistica_forms.worksheet_transform_previews p
    JOIN estadistica_forms.worksheet_transform_selections s ON s.id = p.selection_id
    ${JOIN_SELECTION_REVISION}
    WHERE p.id = ${previewId} AND ${selectionScope(scope)}
    ${lock ? Prisma.sql`FOR UPDATE OF p` : Prisma.empty}`;
  return rows[0] ?? null;
}

async function requireCurrentHead(
  tx: Prisma.TransactionClient,
  scope: WorksheetToolScope,
  expected: Pick<WorksheetSelection, 'revisionId' | 'schemaVersion'>,
): Promise<RevisionPointer> {
  const rows = await tx.$queryRaw<RevisionPointer[]>`
    SELECT
      r.id,
      r.sequence,
      r.schema_version AS "schemaVersion",
      r.row_count AS "rowCount"
    FROM estadistica_forms.worksheets w
    JOIN estadistica_forms.worksheet_revisions r
      ON r.worksheet_id = w.id AND r.id = w.head_revision_id
    WHERE w.id = ${scope.worksheetId}
      AND w.organization_id = ${scope.organizationId}
      AND w.project_id = ${scope.projectId}`;
  const base = rows[0];
  const isCurrent =
    base?.id === expected.revisionId &&
    base.schemaVersion === expected.schemaVersion;
  if (!isCurrent) {
    throw apiError(ErrorCodes.AI_SHEET_PREVIEW_STALE);
  }
  return base;
}

function assertChangesWithinSelection(
  selection: WorksheetSelection,
  changes: readonly TransformChange[],
): void {
  const rowIds = new Set(selection.rowIds);
  const columnIds = new Set(selection.columnIds);
  for (const change of changes) {
    if (!rowIds.has(change.rowId)) {
      throw apiError(ErrorCodes.AI_SHEET_SELECTION_ROW_NOT_FOUND);
    }
    if (!columnIds.has(change.columnId)) {
      throw apiError(ErrorCodes.AI_SHEET_SELECTION_COLUMN_NOT_FOUND);
    }
  }
}

async function requireAvailablePreview(
  tx: Prisma.TransactionClient,
  scope: WorksheetToolScope,
  request: CreateWorksheetChangeProposal,
): Promise<WorksheetPreview> {
  const preview = await findPreviewIn(tx, scope, request.previewId, true);
  if (!preview) {
    throw apiError(ErrorCodes.AI_SHEET_PREVIEW_NOT_FOUND);
  }
  if (preview.changesetId) {
    throw apiError(ErrorCodes.AI_SHEET_PREVIEW_ALREADY_USED);
  }
  if (hasExpired(preview.expiresAt, request.now)) {
    throw apiError(ErrorCodes.AI_SHEET_PREVIEW_EXPIRED);
  }
  if (request.expectedHash && preview.hash !== request.expectedHash) {
    throw apiError(ErrorCodes.AI_SHEET_PREVIEW_STALE);
  }
  if (preview.issueCount > 0 || preview.changes.length === 0) {
    throw apiError(ErrorCodes.AI_SHEET_PREVIEW_INVALID);
  }
  return preview;
}

function draftOperations(changes: readonly TransformChange[]): SetCell[] {
  return changes.map(({ rowId, columnId, after }) => ({
    type: 'set_cell',
    rowId,
    columnId,
    value: after,
  }));
}

function resultFromReceipt(value: unknown): WorksheetChangeProposal {
  if (typeof value !== 'object' || value === null) {
    throw apiError(ErrorCodes.INTERNAL_ERROR);
  }
  if (
    'id' in value &&
    typeof value.id === 'string' &&
    'worksheetId' in value &&
    typeof value.worksheetId === 'string' &&
    'baseRevisionId' in value &&
    typeof value.baseRevisionId === 'string' &&
    'draftVersion' in value &&
    value.draftVersion === 1 &&
    'status' in value &&
    value.status === 'draft'
  ) {
    return {
      id: value.id,
      worksheetId: value.worksheetId,
      baseRevisionId: value.baseRevisionId,
      draftVersion: value.draftVersion,
      status: value.status,
    };
  }
  throw apiError(ErrorCodes.INTERNAL_ERROR);
}

function hasExpired(expiresAt: string, now: Date): boolean {
  return new Date(expiresAt) <= now;
}

function earlierExpiry(
  selectionExpiresAt: string,
  previewExpiresAt: string,
): string {
  return new Date(
    Math.min(Date.parse(selectionExpiresAt), Date.parse(previewExpiresAt)),
  ).toISOString();
}

function transformHash(
  scope: WorksheetToolScope,
  selection: WorksheetSelection,
  changes: readonly TransformChange[],
): string {
  const cells = changes.map(({ rowId, columnId, before, after }) => [
    rowId,
    columnId,
    before,
    after,
  ]);
  return sha256([
    1,
    scope.organizationId,
    scope.projectId,
    scope.worksheetId,
    scope.actorId,
    selection.id,
    selection.revisionId,
    selection.schemaVersion,
    cells,
  ]);
}

function sha256(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}
