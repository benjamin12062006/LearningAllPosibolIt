import { Injectable } from '@nestjs/common';
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
import { can } from '../organizations/organization-roles.js';
import { UsersService } from '../users/users.service.js';
import {
  planColumns,
  type ColumnRequest,
  type PlannedColumn,
} from './column-plan.js';
import { buildNewWorksheet } from './new-worksheet.js';
import type {
  CreateWorksheetDto,
  DuplicateWorksheetDto,
} from './worksheets.dto.js';
import {
  isArchivedWorksheet,
  WorksheetsRepository,
  type ProjectAccess,
} from './worksheets.repository.js';
import type {
  ProjectScope,
  WorksheetCapabilities,
  WorksheetSummary,
} from './worksheets.types.js';

/**
 * Libros y hojas libres de un proyecto (ampliación E3.1). No piden la
 * configuración de canal del proyecto (W12): una hoja no depende de Google.
 */
@Injectable()
export class WorksheetsService {
  constructor(
    private readonly usersService: UsersService,
    private readonly repository: WorksheetsRepository,
  ) {}

  async createWorkbook(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    name: string,
  ) {
    const user = await this.usersService.findCurrent(identity);
    return this.repository.createWorkbook(user.id, scope, name);
  }

  async findWorkbooks(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    query: ArchivableListQuery = {},
  ) {
    const user = await this.usersService.findCurrent(identity);
    await this.requireAccess(user.id, scope);

    const page = resolvePage(query);
    const rows = await this.repository.findWorkbooks(
      user.id,
      scope,
      fetchWindow(page),
      query.archived,
    );
    return toPage(rows, page);
  }

  async renameWorkbook(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    workbookId: string,
    name: string,
  ) {
    const user = await this.usersService.findCurrent(identity);
    return this.repository.renameWorkbook(user.id, scope, workbookId, name);
  }

  /** Archivado se sigue leyendo; no admite hojas nuevas ni cambios en las suyas. */
  async archiveWorkbook(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    workbookId: string,
  ) {
    const user = await this.usersService.findCurrent(identity);
    return this.repository.setWorkbookArchived(
      user.id,
      scope,
      workbookId,
      true,
    );
  }

  async restoreWorkbook(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    workbookId: string,
  ) {
    const user = await this.usersService.findCurrent(identity);
    return this.repository.setWorkbookArchived(
      user.id,
      scope,
      workbookId,
      false,
    );
  }

  async createWorksheet(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    workbookId: string,
    input: CreateWorksheetDto,
  ) {
    const columns = planOrReject(
      input.columns.map((column) => ({
        name: column.name,
        type: column.type,
        required: column.required ?? false,
        options: column.options,
        formula: column.formula,
      })),
    );

    const user = await this.usersService.findCurrent(identity);
    const { worksheet, access } = await this.repository.createWorksheet(
      user.id,
      scope,
      workbookId,
      buildNewWorksheet(input.name, columns),
    );
    return { worksheet, capabilities: capabilitiesOf(access, worksheet) };
  }

  async findWorksheets(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    workbookId: string,
    query: ArchivableListQuery = {},
  ) {
    const user = await this.usersService.findCurrent(identity);
    await this.requireAccess(user.id, scope);
    if (!(await this.repository.workbookExists(user.id, scope, workbookId))) {
      throw apiError(ErrorCodes.WORKBOOK_NOT_FOUND);
    }

    const page = resolvePage(query);
    const rows = await this.repository.findWorksheets(
      user.id,
      scope,
      workbookId,
      fetchWindow(page),
      query.archived,
    );
    return toPage(rows, page);
  }

  async findWorksheet(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    worksheetId: string,
  ) {
    const user = await this.usersService.findCurrent(identity);
    const access = await this.requireAccess(user.id, scope);
    const worksheet = await this.repository.findWorksheet(
      user.id,
      scope,
      worksheetId,
    );
    if (!worksheet) {
      throw apiError(ErrorCodes.WORKSHEET_NOT_FOUND);
    }
    return { worksheet, capabilities: capabilitiesOf(access, worksheet) };
  }

  async renameWorksheet(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    worksheetId: string,
    name: string,
  ) {
    const user = await this.usersService.findCurrent(identity);
    const { worksheet, access } = await this.repository.renameWorksheet(
      user.id,
      scope,
      worksheetId,
      name,
    );
    return { worksheet, capabilities: capabilitiesOf(access, worksheet) };
  }

  /** Una copia independiente de la hoja, con IDs nuevos y su procedencia. */
  async duplicateWorksheet(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    worksheetId: string,
    input: DuplicateWorksheetDto,
  ) {
    const user = await this.usersService.findCurrent(identity);
    const { worksheet, access } = await this.repository.duplicateWorksheet(
      user.id,
      scope,
      worksheetId,
      {
        name: input.name,
        workbookId: input.workbookId,
        revisionId: input.revisionId,
      },
    );
    return { worksheet, capabilities: capabilitiesOf(access, worksheet) };
  }

  /**
   * Archivada se sigue leyendo y exportando; no admite borradores,
   * importaciones ni llevarla al catálogo hasta que se restaure.
   */
  async archiveWorksheet(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    worksheetId: string,
  ) {
    return this.setWorksheetArchived(identity, scope, worksheetId, true);
  }

  async restoreWorksheet(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    worksheetId: string,
  ) {
    return this.setWorksheetArchived(identity, scope, worksheetId, false);
  }

  private async setWorksheetArchived(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    worksheetId: string,
    archived: boolean,
  ) {
    const user = await this.usersService.findCurrent(identity);
    const { worksheet, access } = await this.repository.setWorksheetArchived(
      user.id,
      scope,
      worksheetId,
      archived,
    );
    return { worksheet, capabilities: capabilitiesOf(access, worksheet) };
  }

  /**
   * Un proyecto de otra organización, o de una donde el usuario no es miembro,
   * responde 404 igual que uno que no existe.
   */
  private async requireAccess(
    userId: string,
    scope: ProjectScope,
  ): Promise<ProjectAccess> {
    const access = await this.repository.findAccess(userId, scope);
    if (!access) {
      throw apiError(ErrorCodes.PROJECT_NOT_FOUND);
    }
    return access;
  }
}

/** Lo que acepta un listado: la página y, si se quiere, solo activos o solo archivados. */
type ArchivableListQuery = Partial<PageRequest> &
  Readonly<{ archived?: boolean }>;

/**
 * Con la organización, la hoja o su libro archivados nadie escribe, aunque su
 * rol lo permita.
 */
function capabilitiesOf(
  access: ProjectAccess,
  worksheet: WorksheetSummary,
): WorksheetCapabilities {
  const isActive = !access.isArchived && !isArchivedWorksheet(worksheet);
  return {
    write: isActive && can(access.role, 'worksheet.write'),
    approve: isActive && can(access.role, 'changeset.approve'),
  };
}

/**
 * Como en reglas: `VALIDATION_FAILED` con un `issue` por problema
 * (`columns.3.name`, `columns.2.formula`), que lleva el código concreto.
 */
function planOrReject(
  requests: readonly ColumnRequest[],
): readonly PlannedColumn[] {
  const plan = planColumns(requests);
  if (plan.ok) {
    return plan.columns;
  }
  throw apiError(
    ErrorCodes.VALIDATION_FAILED,
    plan.issues.map(({ field, code }) => ({ field, ...publicError(code) })),
  );
}
