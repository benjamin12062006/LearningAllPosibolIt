import { Injectable } from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { parseIdempotencyKey } from '../common/http/idempotency-key.js';
import { publicError } from '../common/http/public-error.js';
import { Prisma } from '../generated/prisma/client.js';
import { UsersService } from '../users/users.service.js';
import { cellProblem, type CellLiteral } from '../worksheets/cell-values.js';
import { parseRowQuery } from '../worksheets/row-query.js';
import { whereSql } from '../worksheets/row-query-sql.js';
import { WorksheetRowsRepository } from '../worksheets/worksheet-rows.repository.js';
import type {
  ProjectScope,
  WorksheetColumn,
} from '../worksheets/worksheets.types.js';
import {
  rowSelectorOf,
  transformOf,
  type CreateWorksheetChangeProposalDto,
  type CreateWorksheetSelectionDto,
  type PreviewWorksheetTransformDto,
} from './worksheet-tools.dto.js';
import { WorksheetToolsRepository } from './worksheet-tools.repository.js';
import type {
  TransformChange,
  WorksheetPreview,
  WorksheetToolScope,
} from './worksheet-tools.types.js';
import {
  planTransform,
  TRANSFORM_LIMITS,
  type Transform,
} from './worksheet-transform.js';

@Injectable()
export class WorksheetToolsService {
  constructor(
    private readonly users: UsersService,
    private readonly rows: WorksheetRowsRepository,
    private readonly tools: WorksheetToolsRepository,
  ) {}

  async createSelection(
    identity: AuthenticatedIdentity,
    project: ProjectScope,
    worksheetId: string,
    input: CreateWorksheetSelectionDto,
  ) {
    const scope = await this.authorizedScope(identity, project, worksheetId);
    const revision = await this.rows.findRevision(
      scope.actorId,
      scope,
      worksheetId,
      input.revisionId,
    );
    if (!revision) throw apiError(ErrorCodes.WORKSHEET_REVISION_NOT_FOUND);
    const columns = await this.rows.findColumns(
      scope,
      worksheetId,
      revision.schemaVersion,
    );
    selectColumns(columns, input.columnIds);

    const selector = rowSelectorOf(input.rows);
    const where =
      selector.kind === 'selectedRows'
        ? rowIdsIn(selector.rowIds)
        : filterWhere(selector.filter, columns);
    const matches = await this.tools.findRows(scope, revision.sequence, {
      where,
      limit: TRANSFORM_LIMITS.rows + 1,
    });
    if (matches.length > TRANSFORM_LIMITS.rows)
      throw apiError(ErrorCodes.AI_SHEET_TRANSFORM_LIMIT);
    if (
      selector.kind === 'selectedRows' &&
      matches.length !== selector.rowIds.length
    ) {
      throw apiError(ErrorCodes.AI_SHEET_SELECTION_ROW_NOT_FOUND);
    }
    const selection = await this.tools.saveSelection(scope, revision, {
      rowIds: matches.map(({ rowId }) => rowId),
      columnIds: input.columnIds,
      expiresAt: expiresAt(),
    });
    return {
      selectionId: selection.id,
      revisionId: selection.revisionId,
      rowCount: selection.rowIds.length,
      expiresAt: selection.expiresAt,
    };
  }

  /**
   * Que una selección exista, sea de esta persona y de esta hoja y no haya
   * caducado. La usa el agente al fijar el contexto de una ejecución.
   */
  async requireSelection(
    identity: AuthenticatedIdentity,
    project: ProjectScope,
    worksheetId: string,
    selectionId: string,
  ): Promise<void> {
    const scope = await this.authorizedScope(identity, project, worksheetId);
    const selection = await this.tools.findSelection(scope, selectionId);
    if (!selection) {
      throw apiError(ErrorCodes.AI_SHEET_SELECTION_NOT_FOUND);
    }
    if (isExpired(selection.expiresAt)) {
      throw apiError(ErrorCodes.AI_SHEET_SELECTION_EXPIRED);
    }
  }

  async previewTransform(
    identity: AuthenticatedIdentity,
    project: ProjectScope,
    worksheetId: string,
    input: PreviewWorksheetTransformDto,
  ) {
    const scope = await this.authorizedScope(identity, project, worksheetId);
    const selection = await this.tools.findSelection(scope, input.selectionId);
    if (!selection) throw apiError(ErrorCodes.AI_SHEET_SELECTION_NOT_FOUND);
    if (isExpired(selection.expiresAt))
      throw apiError(ErrorCodes.AI_SHEET_SELECTION_EXPIRED);

    const schema = await this.rows.findColumns(
      scope,
      worksheetId,
      selection.schemaVersion,
    );
    const selectedSchema = selectColumns(schema, selection.columnIds);
    const targetColumns = selectColumns(selectedSchema, input.columnIds);
    if (
      selection.rowIds.length * targetColumns.length >
      TRANSFORM_LIMITS.cells
    ) {
      throw apiError(ErrorCodes.AI_SHEET_TRANSFORM_LIMIT);
    }
    const targetTransforms = planColumnsTransform(
      targetColumns,
      transformOf(input.transform),
    );
    const rows = await this.tools.findRows(scope, selection.revisionSequence, {
      where: rowIdsIn(selection.rowIds),
      limit: TRANSFORM_LIMITS.rows,
      columnIds: input.columnIds,
    });
    const result = transformRows(rows, targetTransforms);
    const preview = await this.tools.savePreview(scope, selection, {
      ...result,
      expiresAt: new Date(
        Math.min(Date.parse(expiresAt()), Date.parse(selection.expiresAt)),
      ).toISOString(),
    });
    return previewSummary(preview);
  }

  async findPreview(
    identity: AuthenticatedIdentity,
    project: ProjectScope,
    worksheetId: string,
    previewId: string,
    limit: number,
    offset: number,
  ) {
    const scope = await this.authorizedScope(identity, project, worksheetId);
    const preview = await this.tools.findPreview(scope, previewId);
    if (!preview) throw apiError(ErrorCodes.AI_SHEET_PREVIEW_NOT_FOUND);
    if (isExpired(preview.expiresAt))
      throw apiError(ErrorCodes.AI_SHEET_PREVIEW_EXPIRED);
    const end = offset + limit;
    return {
      ...previewSummary(preview),
      items: preview.changes.slice(offset, end),
      page: { limit, offset, hasMore: end < preview.changes.length },
    };
  }

  async createChangeProposal(
    identity: AuthenticatedIdentity,
    project: ProjectScope,
    worksheetId: string,
    input: CreateWorksheetChangeProposalDto,
    key: string | undefined,
  ) {
    const scope = await this.authorizedScope(identity, project, worksheetId);
    const idempotencyKey = parseIdempotencyKey(key);
    return this.tools.createProposal(scope, {
      previewId: input.previewId,
      explanation: input.explanation,
      idempotencyKey,
      now: new Date(),
    });
  }

  private async authorizedScope(
    identity: AuthenticatedIdentity,
    project: ProjectScope,
    worksheetId: string,
  ): Promise<WorksheetToolScope> {
    const actor = await this.users.findCurrent(identity);
    const scope = { ...project, worksheetId, actorId: actor.id };
    await this.tools.assertSheetAccess(scope);
    return scope;
  }
}

function selectColumns(
  schema: readonly WorksheetColumn[],
  ids: readonly string[],
): WorksheetColumn[] {
  const byId = new Map(schema.map((column) => [column.id, column]));
  return ids.map((id) => {
    const column = byId.get(id);
    if (!column) throw apiError(ErrorCodes.AI_SHEET_SELECTION_COLUMN_NOT_FOUND);
    return column;
  });
}

function rowIdsIn(rowIds: readonly string[]): Prisma.Sql {
  return rowIds.length === 0
    ? Prisma.sql`false`
    : Prisma.sql`r.row_id IN (${Prisma.join(rowIds)})`;
}

function filterWhere(
  filter: unknown,
  columns: readonly WorksheetColumn[],
): Prisma.Sql {
  const parsed = parseRowQuery({ filter }, columns);
  if (!parsed.ok) {
    throw apiError(
      ErrorCodes.VALIDATION_FAILED,
      parsed.issues.map(({ field, code }) => ({ field, ...publicError(code) })),
    );
  }
  if (!parsed.query.filter) throw apiError(ErrorCodes.VALIDATION_FAILED);
  return whereSql(parsed.query.filter);
}

function planColumnsTransform(
  columns: readonly WorksheetColumn[],
  transform: Transform,
) {
  return columns.map((column) => {
    const apply = planTransform(column, transform);
    if (!apply) throw apiError(ErrorCodes.VALIDATION_FAILED);
    return { column, apply };
  });
}

function transformRows(
  rows: readonly Readonly<{
    rowId: string;
    cellValues: Record<string, unknown>;
  }>[],
  transforms: ReturnType<typeof planColumnsTransform>,
) {
  const changes: TransformChange[] = [];
  let issueCount = 0;
  let bytes = 2;
  for (const row of rows) {
    for (const { column, apply } of transforms) {
      const value = row.cellValues[column.id] ?? null;
      if (!isCell(value) || cellProblem(column, value)) {
        issueCount += 1;
        continue;
      }
      const after = apply(value);
      if (value === after) continue;
      if (cellProblem(column, after)) {
        issueCount += 1;
        continue;
      }
      const change = {
        rowId: row.rowId,
        columnId: column.id,
        before: value,
        after,
      };
      bytes += Buffer.byteLength(JSON.stringify(change), 'utf8') + 1;
      if (bytes > TRANSFORM_LIMITS.storedBytes)
        throw apiError(ErrorCodes.AI_SHEET_TRANSFORM_LIMIT);
      changes.push(change);
    }
  }
  return { changes, issueCount };
}

function previewSummary(preview: WorksheetPreview) {
  const sample: TransformChange[] = [];
  let sampleBytes = 0;
  for (const change of preview.changes.slice(0, TRANSFORM_LIMITS.sampleCells)) {
    sampleBytes += Buffer.byteLength(JSON.stringify(change), 'utf8') + 1;
    if (sampleBytes > TRANSFORM_LIMITS.sampleBytes) break;
    sample.push(change);
  }
  return {
    previewId: preview.id,
    revisionId: preview.revisionId,
    selectionId: preview.selectionId,
    expiresAt: preview.expiresAt,
    affectedRows: new Set(preview.changes.map(({ rowId }) => rowId)).size,
    affectedCells: preview.changes.length,
    sample,
    issueCount: preview.issueCount,
    canCreateProposal:
      preview.changes.length > 0 &&
      preview.issueCount === 0 &&
      preview.changesetId === null,
  };
}

function isCell(value: unknown): value is CellLiteral | null {
  return (
    value === null || typeof value === 'string' || typeof value === 'boolean'
  );
}

function expiresAt(): string {
  return new Date(Date.now() + TRANSFORM_LIMITS.ttlMs).toISOString();
}

function isExpired(value: string): boolean {
  return Date.parse(value) <= Date.now();
}
