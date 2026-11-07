import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ArtifactStore } from '../artifacts/artifact.store.js';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import {
  CatalogImportService,
  type PlannedImportIds,
} from '../catalog-import/catalog-import.service.js';
import type { StoredUpload } from '../catalog-import/import.types.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { publicError } from '../common/http/public-error.js';
import { can } from '../organizations/organization-roles.js';
import { UsersService } from '../users/users.service.js';
import {
  parseRowQuery,
  type ParsedRowQuery,
  type QueryIssue,
} from '../worksheets/row-query.js';
import { orderSql, whereSql } from '../worksheets/row-query-sql.js';
import {
  WorksheetRowsRepository,
  type ReadableRevision,
} from '../worksheets/worksheet-rows.repository.js';
import type {
  ProjectScope,
  WorksheetColumn,
} from '../worksheets/worksheets.types.js';
import {
  writeCatalogCsv,
  type CatalogCsvPlan,
  type CatalogCsvSummary,
  type CatalogRowProblem,
} from './catalog-csv.js';
import type { CreateWorksheetCatalogSnapshotDto } from './worksheet-catalog-snapshots.dto.js';
import {
  WorksheetCatalogSnapshotsRepository,
  type CatalogSourceAccess,
} from './worksheet-catalog-snapshots.repository.js';
import {
  CATALOG_SERIALIZER_VERSION,
  WORKSHEET_CATALOG_LIMITS,
  type WorksheetCatalogSnapshot,
} from './worksheet-catalog-snapshots.types.js';

/** Lo que el CSV ya escrito aporta a la procedencia. */
type WrittenCatalogCsv = Readonly<{
  upload: StoredUpload;
  result: CatalogCsvSummary;
}>;

/** Un campo de error no puede ser más largo (como al importar). */
const MAX_FIELD_LENGTH = 128;

/**
 * El puente de una revisión de hoja al catálogo y al feed (E5.4, plan
 * imports&exports 01, D22–D28). Es un adaptador (ficha 04, C35): traduce la
 * revisión al CSV que la importación de catálogo ya acepta y entra por su
 * caso de uso, como la actualización del feed. Ni `catalog-import` ni las
 * hojas dependen de este módulo.
 */
@Injectable()
export class WorksheetCatalogSnapshotsService {
  constructor(
    private readonly usersService: UsersService,
    private readonly repository: WorksheetCatalogSnapshotsRepository,
    private readonly rows: WorksheetRowsRepository,
    private readonly store: ArtifactStore,
    private readonly imports: CatalogImportService,
  ) {}

  /**
   * Escribe la revisión como CSV en `tmp/` comprobando lo que el catálogo
   * rechazaría, y la acepta como una importación con su procedencia en la
   * misma transacción. Responde 202 como una importación: el worker de
   * catálogo termina el snapshot.
   */
  async create(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    worksheetId: string,
    input: CreateWorksheetCatalogSnapshotDto,
    requestId: string,
  ) {
    const user = await this.usersService.findCurrent(identity);
    const access = await this.repository.findAccess(
      user.id,
      scope,
      worksheetId,
    );
    assertCanSendToCatalog(access, user.id);
    const revision = await this.requireRevision(
      user.id,
      scope,
      worksheetId,
      input.revisionId ?? null,
    );
    const columns = await this.rows.findColumns(
      scope,
      worksheetId,
      revision.schemaVersion,
    );
    const query = parseOrReject(input, columns);
    const plan = csvPlanOf(columns, query, input.idColumnId);

    const written = await this.writeCsv(
      scope,
      worksheetId,
      revision,
      query,
      plan,
    );
    const ids: PlannedImportIds = {
      snapshotId: randomUUID(),
      jobId: randomUUID(),
    };
    const catalogSnapshot = provenanceOf({
      ids,
      worksheetId,
      revision,
      createdBy: user.id,
      plan,
      request: input,
      written,
    });
    const accepted = await this.accept(user.id, scope, {
      access,
      plan,
      written,
      ids,
      catalogSnapshot,
      requestId,
    });
    return { catalogSnapshot, ...accepted };
  }

  async find(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    snapshotId: string,
  ): Promise<WorksheetCatalogSnapshot> {
    const user = await this.usersService.findCurrent(identity);
    const found = await this.repository.find(user.id, scope, snapshotId);
    if (!found) {
      throw apiError(ErrorCodes.WORKSHEET_CATALOG_SNAPSHOT_NOT_FOUND);
    }
    return found;
  }

  /** Como al exportar: una revisión de otra hoja responde igual que una inexistente. */
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

  /**
   * Si hay problemas o ninguna fila, se lanza dentro de la escritura: el
   * almacén borra el temporal y no se acepta nada (D25).
   */
  private writeCsv(
    scope: ProjectScope,
    worksheetId: string,
    revision: ReadableRevision,
    query: ParsedRowQuery,
    plan: CatalogCsvPlan,
  ): Promise<WrittenCatalogCsv> {
    const pages = this.rows.pagesAt({
      scope,
      worksheetId,
      sequence: revision.sequence,
      where: whereSql(query.filter),
      order: orderSql(query.sort),
      pageSize: WORKSHEET_CATALOG_LIMITS.rowsPerPage,
    });
    return this.store.writeImportUpload(async (sink) => {
      const summary = await writeCatalogCsv(sink, plan, pages);
      assertAcceptable(summary);
      return summary;
    });
  }

  /**
   * Entra por el mismo camino que una subida (D22). Dentro de su transacción
   * se vuelve a comprobar el acceso y se guarda la procedencia. Si `accept`
   * falla, el CSV puede seguir en `tmp/`: se retira (borrar uno que ya no está
   * no es un error).
   */
  private async accept(
    userId: string,
    scope: ProjectScope,
    input: Readonly<{
      access: CatalogSourceAccess;
      plan: CatalogCsvPlan;
      written: WrittenCatalogCsv;
      ids: PlannedImportIds;
      catalogSnapshot: WorksheetCatalogSnapshot;
      requestId: string;
    }>,
  ) {
    const { upload } = input.written;
    try {
      return await this.imports.accept(
        userId,
        scope.projectId,
        { ...upload, originalname: originalNameOf(input) },
        { idColumn: input.plan.idColumn.name, delimiter: 'comma' },
        input.requestId,
        input.ids,
        async (tx) => {
          const access = await this.repository.findAccess(
            userId,
            scope,
            input.catalogSnapshot.worksheetId,
            tx,
          );
          assertCanSendToCatalog(access, userId);
          await this.repository.insert(
            tx,
            userId,
            scope,
            input.catalogSnapshot,
          );
        },
      );
    } catch (error) {
      await this.store.removeTemporary(upload.filename);
      throw error;
    }
  }
}

/**
 * D23, en este orden: miembro de esa hoja (404), organización activa (409),
 * permiso de escritura (403) y propietario del proyecto (403): reglas,
 * evaluaciones, TSV y feed siguen siendo suyos mientras E1.2 esté aplazada.
 */
function assertCanSendToCatalog(
  access: CatalogSourceAccess | null,
  userId: string,
): asserts access is CatalogSourceAccess {
  if (!access) {
    throw apiError(ErrorCodes.WORKSHEET_NOT_FOUND);
  }
  if (access.isArchived) {
    throw apiError(ErrorCodes.ORGANIZATION_ARCHIVED);
  }
  if (!can(access.role, 'worksheet.write')) {
    throw apiError(ErrorCodes.FORBIDDEN);
  }
  if (access.projectOwnerId !== userId) {
    throw apiError(ErrorCodes.WORKSHEET_CATALOG_OWNER_REQUIRED);
  }
}

function parseOrReject(
  input: CreateWorksheetCatalogSnapshotDto,
  columns: readonly WorksheetColumn[],
): ParsedRowQuery {
  const result = parseRowQuery(input, columns);
  if (!result.ok) {
    throw validationError(result.issues);
  }
  return result.query;
}

/** La columna identificadora tiene que ser una de las elegidas (D24). */
function csvPlanOf(
  columns: readonly WorksheetColumn[],
  query: ParsedRowQuery,
  idColumnId: string,
): CatalogCsvPlan {
  const byId = new Map(columns.map((column) => [column.id, column]));
  const idColumn = byId.get(idColumnId);
  if (!idColumn || !query.columnIds.includes(idColumnId)) {
    throw validationError([
      { field: 'idColumnId', code: ErrorCodes.CATALOG_ID_COLUMN_INVALID },
    ]);
  }
  return {
    idColumn,
    selected: query.columnIds.flatMap((id) => byId.get(id) ?? []),
    all: columns,
  };
}

function assertAcceptable(summary: CatalogCsvSummary) {
  if (summary.problems.length > 0) {
    throw apiError(
      ErrorCodes.WORKSHEET_CATALOG_ROWS_INVALID,
      summary.problems.map(toRowIssue),
    );
  }
  if (summary.rowCount === 0) {
    throw apiError(ErrorCodes.WORKSHEET_CATALOG_EMPTY);
  }
}

/** `rows.<rowId>.<columnId>`, como las demás validaciones por campo. */
function toRowIssue({ rowId, columnId, code }: CatalogRowProblem) {
  const field = columnId ? `rows.${rowId}.${columnId}` : `rows.${rowId}`;
  return { field: field.slice(0, MAX_FIELD_LENGTH), ...publicError(code) };
}

function validationError(issues: readonly QueryIssue[]) {
  return apiError(
    ErrorCodes.VALIDATION_FAILED,
    issues.map(({ field, code }) => ({ field, ...publicError(code) })),
  );
}

function provenanceOf(
  input: Readonly<{
    ids: PlannedImportIds;
    worksheetId: string;
    revision: ReadableRevision;
    createdBy: string;
    plan: CatalogCsvPlan;
    request: CreateWorksheetCatalogSnapshotDto;
    written: WrittenCatalogCsv;
  }>,
): WorksheetCatalogSnapshot {
  return {
    snapshotId: input.ids.snapshotId,
    worksheetId: input.worksheetId,
    revisionId: input.revision.id,
    revisionSequence: input.revision.sequence,
    createdBy: input.createdBy,
    idColumnId: input.plan.idColumn.id,
    columns: input.plan.selected.map((column) => ({
      columnId: column.id,
      header: column.name,
    })),
    query: catalogQueryOf(input.request),
    serializerVersion: CATALOG_SERIALIZER_VERSION,
    rowCount: input.written.result.rowCount,
    sourceHash: input.written.upload.hash,
    createdAt: new Date().toISOString(),
  };
}

/** Lo pedido, ya validado, como en las exportaciones (E5.3). */
function catalogQueryOf(request: CreateWorksheetCatalogSnapshotDto) {
  return {
    filter: request.filter ?? null,
    sort: (request.sort ?? []).map(({ columnId, direction }) => ({
      columnId,
      direction,
    })),
  };
}

/** Se ve en el listado de importaciones; `accept` le quita caracteres de control y barras. */
function originalNameOf(
  input: Readonly<{
    access: CatalogSourceAccess;
    catalogSnapshot: WorksheetCatalogSnapshot;
  }>,
) {
  const sequence = input.catalogSnapshot.revisionSequence;
  return `${input.access.worksheetName} (revisión ${sequence}).csv`;
}
