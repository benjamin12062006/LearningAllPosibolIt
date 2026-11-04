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
  buildNewWorksheet,
  duplicateColumnPositions,
} from './new-worksheet.js';
import type { CreateWorksheetDto } from './worksheets.dto.js';
import {
  WorksheetsRepository,
  type ProjectAccess,
} from './worksheets.repository.js';
import type {
  ProjectScope,
  WorksheetCapabilities,
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
    query?: Partial<PageRequest>,
  ) {
    const user = await this.usersService.findCurrent(identity);
    await this.requireAccess(user.id, scope);

    const page = resolvePage(query);
    const rows = await this.repository.findWorkbooks(
      user.id,
      scope,
      fetchWindow(page),
    );
    return toPage(rows, page);
  }

  async createWorksheet(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    workbookId: string,
    input: CreateWorksheetDto,
  ) {
    const columns = input.columns.map((column) => ({
      name: column.name,
      type: column.type,
      required: column.required ?? false,
    }));
    assertUniqueColumnNames(columns);

    const user = await this.usersService.findCurrent(identity);
    const { worksheet, access } = await this.repository.createWorksheet(
      user.id,
      scope,
      workbookId,
      buildNewWorksheet(input.name, columns),
    );
    return { worksheet, capabilities: capabilitiesOf(access) };
  }

  async findWorksheets(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    workbookId: string,
    query?: Partial<PageRequest>,
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
    return { worksheet, capabilities: capabilitiesOf(access) };
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

/** Con la organización archivada nadie escribe, aunque su rol lo permita. */
function capabilitiesOf(access: ProjectAccess): WorksheetCapabilities {
  const isActive = !access.isArchived;
  return {
    write: isActive && can(access.role, 'worksheet.write'),
    approve: isActive && can(access.role, 'changeset.approve'),
  };
}

/**
 * Como en reglas: `VALIDATION_FAILED` con un `issue` por columna repetida
 * (`columns.3.name`), que lleva el código concreto.
 */
function assertUniqueColumnNames(
  columns: Parameters<typeof duplicateColumnPositions>[0],
) {
  const duplicates = duplicateColumnPositions(columns);
  if (duplicates.length === 0) {
    return;
  }
  throw apiError(
    ErrorCodes.VALIDATION_FAILED,
    duplicates.map((position) => ({
      field: `columns.${position}.name`,
      ...publicError(ErrorCodes.WORKSHEET_COLUMN_DUPLICATE),
    })),
  );
}
