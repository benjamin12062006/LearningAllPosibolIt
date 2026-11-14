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
import type { OrganizationRole } from '../organizations/organization-roles.js';
import { UsersService } from '../users/users.service.js';
import { parseRowQuery } from './row-query.js';
import {
  canEditView,
  SavedViewsRepository,
  type SavedView,
  type SavedViewInput,
} from './saved-views.repository.js';
import { WorksheetRowsRepository } from './worksheet-rows.repository.js';
import type { SaveViewDto } from './worksheets.dto.js';
import { WorksheetsRepository } from './worksheets.repository.js';
import type { ProjectScope } from './worksheets.types.js';

/** Una vista como la ve quien pregunta: con si puede cambiarla. */
export type SavedViewView = SavedView & Readonly<{ canEdit: boolean }>;

/**
 * Vistas guardadas de una hoja (plan 02 de cierre, H4): filtros, orden y
 * columnas con nombre, para no rehacerlos. Se usan en `rows/query` con
 * `viewId`.
 */
@Injectable()
export class SavedViewsService {
  constructor(
    private readonly usersService: UsersService,
    private readonly views: SavedViewsRepository,
    private readonly worksheets: WorksheetsRepository,
    private readonly rows: WorksheetRowsRepository,
  ) {}

  /** Se valida contra las columnas actuales: una vista que no se puede usar no se guarda. */
  async create(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    worksheetId: string,
    input: SaveViewDto,
  ): Promise<SavedViewView> {
    const user = await this.usersService.findCurrent(identity);
    const role = await this.requireRole(user.id, scope);
    await this.assertQueryFits(user.id, scope, worksheetId, input);

    const view = await this.views.create(
      user.id,
      scope,
      worksheetId,
      toInput(input),
    );
    return withCanEdit(view, user.id, role);
  }

  async findByWorksheet(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    worksheetId: string,
    query?: Partial<PageRequest>,
  ) {
    const user = await this.usersService.findCurrent(identity);
    const role = await this.requireRole(user.id, scope);
    await this.requireHead(user.id, scope, worksheetId);

    const page = resolvePage(query);
    const rows = await this.views.findByWorksheet(
      user.id,
      scope,
      worksheetId,
      fetchWindow(page),
    );
    const { items, page: pageInfo } = toPage(rows, page);
    return {
      items: items.map((view) => withCanEdit(view, user.id, role)),
      page: pageInfo,
    };
  }

  async find(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    viewId: string,
  ): Promise<SavedViewView> {
    const user = await this.usersService.findCurrent(identity);
    const role = await this.requireRole(user.id, scope);
    const view = await this.requireView(user.id, scope, viewId);
    return withCanEdit(view, user.id, role);
  }

  /** Quién puede cambiarla lo decide el repositorio, dentro de su transacción. */
  async replace(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    viewId: string,
    input: SaveViewDto,
  ): Promise<SavedViewView> {
    const user = await this.usersService.findCurrent(identity);
    const role = await this.requireRole(user.id, scope);
    const current = await this.requireView(user.id, scope, viewId);
    await this.assertQueryFits(user.id, scope, current.worksheetId, input);

    const view = await this.views.replace(
      user.id,
      scope,
      viewId,
      toInput(input),
    );
    return withCanEdit(view, user.id, role);
  }

  async delete(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    viewId: string,
  ) {
    const user = await this.usersService.findCurrent(identity);
    await this.views.delete(user.id, scope, viewId);
  }

  /** Un proyecto de otra organización responde 404, como en el resto de hojas. */
  private async requireRole(
    userId: string,
    scope: ProjectScope,
  ): Promise<OrganizationRole> {
    const access = await this.worksheets.findAccess(userId, scope);
    if (!access) {
      throw apiError(ErrorCodes.PROJECT_NOT_FOUND);
    }
    return access.role;
  }

  private async requireView(
    userId: string,
    scope: ProjectScope,
    viewId: string,
  ): Promise<SavedView> {
    const view = await this.views.find(userId, scope, viewId);
    if (!view) {
      throw apiError(ErrorCodes.SAVED_VIEW_NOT_FOUND);
    }
    return view;
  }

  private async requireHead(
    userId: string,
    scope: ProjectScope,
    worksheetId: string,
  ) {
    const head = await this.rows.findRevision(userId, scope, worksheetId, null);
    if (!head) {
      throw apiError(ErrorCodes.WORKSHEET_NOT_FOUND);
    }
    return head;
  }

  /** La misma validación que `rows/query`, con los campos dentro de `query`. */
  private async assertQueryFits(
    userId: string,
    scope: ProjectScope,
    worksheetId: string,
    input: SaveViewDto,
  ) {
    const head = await this.requireHead(userId, scope, worksheetId);
    const columns = await this.rows.findColumns(
      scope,
      worksheetId,
      head.schemaVersion,
    );
    const parsed = parseRowQuery(input.query, columns);
    if (!parsed.ok) {
      throw apiError(
        ErrorCodes.VALIDATION_FAILED,
        parsed.issues.map((issue) => ({
          field: `query.${issue.field}`,
          ...publicError(issue.code),
        })),
      );
    }
  }
}

/** Copia el body a datos simples: la base guarda datos, nunca instancias de los DTO. */
function toInput(input: SaveViewDto): SavedViewInput {
  const { filter, sort, columns } = input.query;
  return {
    name: input.name,
    visibility: input.visibility,
    query: {
      ...(filter !== undefined ? { filter } : {}),
      ...(sort !== undefined
        ? {
            sort: sort.map(({ columnId, direction }) => ({
              columnId,
              direction,
            })),
          }
        : {}),
      ...(columns !== undefined ? { columns: [...columns] } : {}),
    },
  };
}

function withCanEdit(
  view: SavedView,
  actorId: string,
  role: OrganizationRole,
): SavedViewView {
  return { ...view, canEdit: canEditView(view, actorId, role) };
}
