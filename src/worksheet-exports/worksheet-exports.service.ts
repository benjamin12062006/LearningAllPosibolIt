import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  ArtifactStore,
  isMissingFile,
  type WrittenArtifact,
} from '../artifacts/artifact.store.js';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import {
  fetchWindow,
  resolvePage,
  toPage,
  type PageRequest,
} from '../common/http/pagination.js';
import { publicError } from '../common/http/public-error.js';
import { UsersService } from '../users/users.service.js';
import {
  parseRowQuery,
  type ParsedRowQuery,
  type QueryIssue,
} from '../worksheets/row-query.js';
import { orderSql, whereSql } from '../worksheets/row-query-sql.js';
import { WorksheetRowsRepository } from '../worksheets/worksheet-rows.repository.js';
import type {
  ProjectScope,
  WorksheetColumn,
} from '../worksheets/worksheets.types.js';
import type { CsvWriteOptions } from './export-csv.js';
import {
  writeExportFile,
  type ExportFilePlan,
  type ExportFileSummary,
} from './worksheet-export-file.js';
import type { CreateWorksheetExportDto } from './worksheet-exports.dto.js';
import {
  WorksheetExportsRepository,
  type RevisionToExport,
  type WorksheetExportFile,
} from './worksheet-exports.repository.js';
import {
  SERIALIZER_VERSION,
  WORKSHEET_EXPORT_LIMITS,
  type ExportOptions,
  type ExportQuery,
  type WorksheetExport,
} from './worksheet-exports.types.js';

export type WorksheetExportDownload = Readonly<{
  content: Readable;
  file: WorksheetExportFile;
}>;

/** Campos que solo tienen sentido en un CSV. */
const CSV_ONLY_FIELDS = ['delimiter', 'formulas'] as const;

const DELIMITERS = { comma: ',', semicolon: ';' } as const;

/**
 * Exportar una revisión fija de hoja a CSV o XLSX (E5.3, plan imports&exports
 * 01, D15–D21). El archivo se genera dentro de la petición, por páginas, y la
 * exportación solo se guarda cuando el archivo está completo y verificado.
 */
@Injectable()
export class WorksheetExportsService {
  private readonly logger = new Logger(WorksheetExportsService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly repository: WorksheetExportsRepository,
    private readonly rows: WorksheetRowsRepository,
    private readonly store: ArtifactStore,
  ) {}

  async create(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    worksheetId: string,
    input: CreateWorksheetExportDto,
  ) {
    const user = await this.usersService.findCurrent(identity);
    const revision = await this.requireRevision(
      user.id,
      scope,
      worksheetId,
      input.revisionId ?? null,
    );
    const options = exportOptionsOf(input);
    const columns = await this.rows.findColumns(
      scope,
      worksheetId,
      revision.schemaVersion,
    );
    const query = parseOrReject(input, columns);

    const plan = filePlanOf(revision, columns, query, options);
    const written = await this.store.writeWorksheetExport(
      input.format,
      (sink) =>
        writeExportFile(
          sink,
          plan,
          this.rows.pagesAt({
            scope,
            worksheetId,
            sequence: revision.sequence,
            where: whereSql(query.filter),
            order: orderSql(query.sort),
            pageSize: WORKSHEET_EXPORT_LIMITS.rowsPerPage,
          }),
        ),
    );
    const saved = await this.save(user.id, scope, {
      worksheetId,
      revision,
      format: input.format,
      options,
      query: exportQueryOf(input, query),
      columnCount: plan.selected.length,
      ...written,
    });

    return { export: saved, downloadUrl: downloadUrlOf(scope, saved.id) };
  }

  async find(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    exportId: string,
  ): Promise<WorksheetExport> {
    const user = await this.usersService.findCurrent(identity);
    const found = await this.repository.find(user.id, scope, exportId);
    if (!found) {
      throw apiError(ErrorCodes.WORKSHEET_EXPORT_NOT_FOUND);
    }
    return found;
  }

  /**
   * Exportaciones de una hoja (H2), también de una archivada. Leer la
   * revisión actual comprueba que la hoja existe y que quien pregunta la ve.
   */
  async findByWorksheet(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    worksheetId: string,
    query?: Partial<PageRequest>,
  ) {
    const user = await this.usersService.findCurrent(identity);
    await this.requireRevision(user.id, scope, worksheetId, null);

    const page = resolvePage(query);
    const rows = await this.repository.findByWorksheet(
      user.id,
      scope,
      worksheetId,
      fetchWindow(page),
    );
    return toPage(rows, page);
  }

  /** El archivo de una exportación, ya abierto (como `productos.tsv`, R2). */
  async openDownload(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    exportId: string,
  ): Promise<WorksheetExportDownload> {
    const user = await this.usersService.findCurrent(identity);
    const file = await this.repository.findFile(user.id, scope, exportId);
    if (!file) {
      throw apiError(ErrorCodes.WORKSHEET_EXPORT_NOT_FOUND);
    }
    return { content: await this.openFile(exportId, file), file };
  }

  /**
   * Sin revisión pedida, la actual: si no aparece, es la hoja la que no
   * existe. Con revisión pedida, una de otra hoja responde igual que una
   * inexistente (como `rows/query`).
   */
  private async requireRevision(
    userId: string,
    scope: ProjectScope,
    worksheetId: string,
    revisionId: string | null,
  ): Promise<RevisionToExport> {
    const revision = await this.repository.findRevision(
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
   * El archivo ya está guardado y verificado. Si la fila no se guarda, nadie
   * lo referencia y se borra.
   */
  private async save(
    userId: string,
    scope: ProjectScope,
    input: Readonly<{
      worksheetId: string;
      revision: RevisionToExport;
      format: WorksheetExport['format'];
      options: ExportOptions;
      query: ExportQuery;
      columnCount: number;
      file: WrittenArtifact;
      result: ExportFileSummary;
    }>,
  ): Promise<WorksheetExport> {
    try {
      return await this.repository.insert(userId, scope, {
        id: randomUUID(),
        worksheetId: input.worksheetId,
        revisionId: input.revision.id,
        revisionSequence: input.revision.sequence,
        createdBy: userId,
        format: input.format,
        options: input.options,
        query: input.query,
        serializerVersion: SERIALIZER_VERSION,
        rowCount: input.result.rowCount,
        columnCount: input.columnCount,
        problemCellCount: input.result.problemCellCount,
        byteSize: input.file.byteSize,
        checksum: input.file.checksum,
        artifactKey: input.file.key,
      });
    } catch (error) {
      await this.discardFile(input.file.key);
      throw error;
    }
  }

  /**
   * La fila existe pero el archivo no: es un fallo del almacenamiento, no del
   * cliente. Se registra sin datos de la hoja y se responde 503.
   */
  private async openFile(exportId: string, file: WorksheetExportFile) {
    try {
      return await this.store.openWorksheetExport(file.artifactKey);
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
      this.logger.error({ code: 'WORKSHEET_EXPORT_FILE_MISSING', exportId });
      throw apiError(ErrorCodes.EXPORT_FILE_UNAVAILABLE);
    }
  }

  /** Si no se puede borrar, queda sin referencia y lo retira la limpieza de huérfanos. */
  private async discardFile(key: string) {
    try {
      await this.store.removeWorksheetExport(key);
    } catch {
      this.logger.error({ code: 'WORKSHEET_EXPORT_FILE_DISCARD_FAILED' });
    }
  }
}

/**
 * Opciones con sus valores por defecto (D16). Una opción de CSV en un XLSX es
 * un error, no se ignora: quien la envía espera un efecto que no tendría.
 */
function exportOptionsOf(input: CreateWorksheetExportDto): ExportOptions {
  if (input.format === 'csv') {
    return {
      delimiter: input.delimiter ?? 'comma',
      formulas: input.formulas ?? 'escape',
    };
  }
  const sentCsvFields = CSV_ONLY_FIELDS.filter(
    (field) => input[field] !== undefined,
  );
  if (sentCsvFields.length > 0) {
    throw apiError(
      ErrorCodes.VALIDATION_FAILED,
      sentCsvFields.map((field) => ({
        field,
        ...publicError(ErrorCodes.FIELD_NOT_ALLOWED),
      })),
    );
  }
  return {};
}

function parseOrReject(
  input: CreateWorksheetExportDto,
  columns: readonly WorksheetColumn[],
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

function filePlanOf(
  revision: RevisionToExport,
  columns: readonly WorksheetColumn[],
  query: ParsedRowQuery,
  options: ExportOptions,
): ExportFilePlan {
  const byId = new Map(columns.map((column) => [column.id, column]));
  return {
    csv: csvWriteOptionsOf(options),
    sheetName: revision.worksheetName,
    selected: query.columnIds.flatMap((id) => byId.get(id) ?? []),
    all: columns,
  };
}

function csvWriteOptionsOf(options: ExportOptions): CsvWriteOptions | null {
  if (!isCsvOptions(options)) {
    return null;
  }
  return {
    delimiter: DELIMITERS[options.delimiter],
    formulas: options.formulas,
  };
}

function isCsvOptions(
  options: ExportOptions,
): options is Extract<ExportOptions, { delimiter: unknown }> {
  return 'delimiter' in options;
}

/** Lo que se guarda como procedencia: lo pedido, ya validado, con las columnas resueltas. */
function exportQueryOf(
  input: CreateWorksheetExportDto,
  query: ParsedRowQuery,
): ExportQuery {
  return {
    columnIds: query.columnIds,
    filter: input.filter ?? null,
    sort: (input.sort ?? []).map(({ columnId, direction }) => ({
      columnId,
      direction,
    })),
  };
}

function downloadUrlOf(scope: ProjectScope, exportId: string) {
  return `/api/v1/organizations/${scope.organizationId}/projects/${scope.projectId}/worksheet-exports/${exportId}/file`;
}
