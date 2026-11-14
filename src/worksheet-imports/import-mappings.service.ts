import { Injectable } from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes, type ErrorCode } from '../common/http/error-codes.js';
import {
  fetchWindow,
  resolvePage,
  toPage,
  type PageRequest,
} from '../common/http/pagination.js';
import { publicError } from '../common/http/public-error.js';
import { UsersService } from '../users/users.service.js';
import type { ProjectScope } from '../worksheets/worksheets.types.js';
import {
  parseMappingTemplate,
  unknownTemplateColumns,
} from './import-mapping.js';
import type { CreateImportMappingDto } from './import-mappings.dto.js';
import {
  ImportMappingsRepository,
  type ImportMapping,
} from './import-mappings.repository.js';
import { WorksheetImportsRepository } from './worksheet-imports.repository.js';

/**
 * Plantillas de mapeo de una hoja (plan 02 de cierre, H3): guardar el mapeo de
 * una importación con nombre para repetirlo con el archivo del mes siguiente.
 */
@Injectable()
export class ImportMappingsService {
  constructor(
    private readonly usersService: UsersService,
    private readonly mappings: ImportMappingsRepository,
    private readonly imports: WorksheetImportsRepository,
  ) {}

  /**
   * Valida la plantilla como unas opciones de importación y contra las
   * columnas actuales de la hoja: una plantilla que no se podría usar no se
   * guarda.
   */
  async create(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    worksheetId: string,
    input: CreateImportMappingDto,
  ): Promise<ImportMapping> {
    const parsed = parseMappingTemplate(input.mapping);
    if (!parsed.ok) {
      throw issuesError(ErrorCodes.IMPORT_OPTIONS_INVALID, parsed.issues);
    }
    const user = await this.usersService.findCurrent(identity);
    const head = await this.imports.findHead(user.id, scope, worksheetId);
    if (!head) {
      throw apiError(ErrorCodes.WORKSHEET_NOT_FOUND);
    }
    const columns = await this.imports.findColumns(
      scope,
      worksheetId,
      head.schemaVersion,
    );
    const unknown = unknownTemplateColumns(parsed.template, columns);
    if (unknown.length > 0) {
      throw issuesError(ErrorCodes.IMPORT_MAPPING_INVALID, unknown);
    }

    return this.mappings.create(user.id, scope, worksheetId, {
      name: input.name,
      template: parsed.template,
    });
  }

  async findByWorksheet(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    worksheetId: string,
    query?: Partial<PageRequest>,
  ) {
    const user = await this.usersService.findCurrent(identity);
    if (!(await this.imports.findHead(user.id, scope, worksheetId))) {
      throw apiError(ErrorCodes.WORKSHEET_NOT_FOUND);
    }

    const page = resolvePage(query);
    const rows = await this.mappings.findByWorksheet(
      user.id,
      scope,
      worksheetId,
      fetchWindow(page),
    );
    return toPage(rows, page);
  }

  async find(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    mappingId: string,
  ): Promise<ImportMapping> {
    const user = await this.usersService.findCurrent(identity);
    const mapping = await this.mappings.find(user.id, scope, mappingId);
    if (!mapping) {
      throw apiError(ErrorCodes.IMPORT_MAPPING_NOT_FOUND);
    }
    return mapping;
  }

  /** Borrar una plantilla no toca las importaciones que la usaron: guardan sus opciones. */
  async delete(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    mappingId: string,
  ) {
    const user = await this.usersService.findCurrent(identity);
    await this.mappings.delete(user.id, scope, mappingId);
  }
}

function issuesError(
  code: ErrorCode,
  issues: readonly Readonly<{ field: string; code: ErrorCode }>[],
) {
  return apiError(
    code,
    issues.map(({ field, code: issueCode }) => ({
      field,
      ...publicError(issueCode),
    })),
  );
}
