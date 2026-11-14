import { Injectable } from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { publicError } from '../common/http/public-error.js';
import { UsersService } from '../users/users.service.js';
import {
  decodeRowCursor,
  encodeRowCursor,
  hashRowQuery,
  type RowCursor,
} from './row-cursor.js';
import {
  parseRowQuery,
  ROW_QUERY_LIMITS,
  type ParsedRowQuery,
  type QueryIssue,
  type RowQueryInput,
} from './row-query.js';
import { evaluateRow } from './row-evaluation.js';
import { orderSql, whereSql } from './row-query-sql.js';
import {
  WorksheetRowsRepository,
  type ReadableRevision,
  type StoredRow,
} from './worksheet-rows.repository.js';
import { SavedViewsRepository } from './saved-views.repository.js';
import type { QueryRowsDto } from './worksheets.dto.js';
import { WorksheetsRepository } from './worksheets.repository.js';
import type { ProjectScope, WorksheetColumn } from './worksheets.types.js';

/** Lo que lee una consulta de filas: la petición, o la vista que pide. */
type RowsRequest = RowQueryInput &
  Readonly<{ revisionId?: string; cursor?: string; limit?: number }>;

export type RowItem = Readonly<{
  rowId: string;
  /** Todas las columnas pedidas; una celda sin valor es `null`. */
  values: Readonly<Record<string, unknown>>;
  /** Celdas que no cumplen su columna y cálculos sin resultado (V7, V8). */
  problems: readonly Readonly<{ columnId: string; code: string }>[];
}>;

/**
 * Lectura de filas de una revisión fija (E3.2): filtro tipado, orden y páginas
 * con un cursor que no cambia de revisión ni de consulta (T05).
 */
@Injectable()
export class WorksheetRowsService {
  constructor(
    private readonly usersService: UsersService,
    private readonly worksheets: WorksheetsRepository,
    private readonly rows: WorksheetRowsRepository,
    private readonly views: SavedViewsRepository,
  ) {}

  async query(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    worksheetId: string,
    request: QueryRowsDto,
  ) {
    const user = await this.usersService.findCurrent(identity);
    await this.requireProjectAccess(user.id, scope);
    const input = await this.withSavedView(
      user.id,
      scope,
      worksheetId,
      request,
    );

    const cursor = readCursor(input);
    const revision = await this.requireRevision(
      user.id,
      scope,
      worksheetId,
      cursor?.revisionId ?? input.revisionId ?? null,
    );
    const columns = await this.rows.findColumns(
      scope,
      worksheetId,
      revision.schemaVersion,
    );
    const query = parseOrReject(input, columns);
    const queryHash = hashRowQuery(query);
    assertCursorMatches(cursor, queryHash);

    const limit = input.limit ?? ROW_QUERY_LIMITS.defaultPageSize;
    const offset = cursor?.offset ?? 0;
    const stored = await this.rows.findRows({
      scope,
      worksheetId,
      sequence: revision.sequence,
      where: whereSql(query.filter),
      order: orderSql(query.sort),
      // Una fila de más dice si hay otra página sin contar todas.
      page: { limit: limit + 1, offset },
    });

    const hasMore = stored.length > limit;
    return {
      items: stored.slice(0, limit).map((row) => toItem(row, columns, query)),
      nextCursor: hasMore
        ? encodeRowCursor({
            revisionId: revision.id,
            queryHash,
            offset: offset + limit,
          })
        : null,
      revisionId: revision.id,
      schemaVersion: revision.schemaVersion,
    };
  }

  /**
   * Con `viewId` (H4), el filtro, el orden y las columnas salen de la vista.
   * Mandarlos además es un error y no se mezcla: así nadie lee creyendo que
   * usa la vista cuando no. La vista se valida contra las columnas de la
   * revisión que se lea, como cualquier consulta.
   */
  private async withSavedView(
    userId: string,
    scope: ProjectScope,
    worksheetId: string,
    request: QueryRowsDto,
  ): Promise<RowsRequest> {
    if (request.viewId === undefined) {
      return request;
    }
    const repeated = (['filter', 'sort', 'columns'] as const).filter(
      (field) => request[field] !== undefined,
    );
    if (repeated.length > 0) {
      throw apiError(
        ErrorCodes.VALIDATION_FAILED,
        repeated.map((field) => ({
          field,
          ...publicError(ErrorCodes.VALIDATION_FAILED),
        })),
      );
    }
    const view = await this.views.find(userId, scope, request.viewId);
    if (!view || view.worksheetId !== worksheetId) {
      throw apiError(ErrorCodes.SAVED_VIEW_NOT_FOUND);
    }
    const { revisionId, cursor, limit } = request;
    return { revisionId, cursor, limit, ...view.query };
  }

  private async requireProjectAccess(userId: string, scope: ProjectScope) {
    if (!(await this.worksheets.findAccess(userId, scope))) {
      throw apiError(ErrorCodes.PROJECT_NOT_FOUND);
    }
  }

  /**
   * Sin revisión pedida, la actual: si no aparece, es la hoja la que no existe.
   * Con revisión pedida, una de otra hoja responde igual que una inexistente.
   */
  private async requireRevision(
    userId: string,
    scope: ProjectScope,
    worksheetId: string,
    revisionId: string | null,
  ): Promise<ReadableRevision> {
    const revision = await this.rows.findRevision(
      userId,
      scope,
      worksheetId,
      revisionId,
    );
    if (revision) {
      return revision;
    }
    if (revisionId) {
      throw apiError(ErrorCodes.WORKSHEET_REVISION_NOT_FOUND);
    }
    throw apiError(ErrorCodes.WORKSHEET_NOT_FOUND);
  }
}

/**
 * Un cursor ilegible, o uno que pide otra revisión que la enviada, no se
 * acepta: seguir leyendo nunca cambia de revisión.
 */
function readCursor(input: RowsRequest): RowCursor | null {
  if (input.cursor === undefined) {
    return null;
  }
  const cursor = decodeRowCursor(input.cursor);
  const contradictsRevision =
    cursor !== null &&
    input.revisionId !== undefined &&
    input.revisionId !== cursor.revisionId;
  if (!cursor || contradictsRevision) {
    throw apiError(ErrorCodes.WORKSHEET_CURSOR_INVALID);
  }
  return cursor;
}

function assertCursorMatches(cursor: RowCursor | null, queryHash: string) {
  if (cursor && cursor.queryHash !== queryHash) {
    throw apiError(ErrorCodes.WORKSHEET_CURSOR_INVALID);
  }
}

function parseOrReject(
  input: RowsRequest,
  columns: Parameters<typeof parseRowQuery>[1],
): ParsedRowQuery {
  const result = parseRowQuery(input, columns);
  if (!result.ok) {
    throw apiError(ErrorCodes.VALIDATION_FAILED, result.issues.map(toIssue));
  }
  return result.query;
}

function toIssue(issue: QueryIssue) {
  return { field: issue.field, ...publicError(issue.code) };
}

/** Valores de las columnas pedidas, con las calculadas ya resueltas, y sus problemas. */
function toItem(
  row: StoredRow,
  columns: readonly WorksheetColumn[],
  query: ParsedRowQuery,
): RowItem {
  const { values, problems } = evaluateRow(
    columns,
    row.cellValues,
    query.columnIds,
  );
  return {
    rowId: row.rowId,
    values,
    problems: problems.map(({ columnId, code }) => ({
      columnId,
      ...publicError(code),
    })),
  };
}
