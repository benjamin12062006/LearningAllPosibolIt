import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import type { PageRequest } from '../common/http/pagination.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  can,
  type OrganizationPermission,
  type OrganizationRole,
} from '../organizations/organization-roles.js';
import { normalizeName } from './worksheet-columns.js';
import type { ViewVisibility } from './worksheets.dto.js';
import { lockProjectFor } from './worksheets.repository.js';
import type { ProjectScope } from './worksheets.types.js';

/** Lo que guarda una vista: la misma forma que pide `rows/query` (H4). */
export type SavedViewQuery = Readonly<{
  filter?: Readonly<Record<string, unknown>>;
  sort?: readonly Readonly<{ columnId: string; direction: 'asc' | 'desc' }>[];
  columns?: readonly string[];
}>;

export type SavedView = Readonly<{
  id: string;
  worksheetId: string;
  ownerId: string;
  name: string;
  visibility: ViewVisibility;
  query: SavedViewQuery;
  createdAt: string;
  updatedAt: string;
}>;

export type SavedViewInput = Readonly<{
  name: string;
  visibility: ViewVisibility;
  query: SavedViewQuery;
}>;

/** Fila tal como sale de SQL: `query` es `jsonb` y se comprueba al leerla. */
type SavedViewRow = Omit<SavedView, 'query'> & Readonly<{ query: unknown }>;

const VIEW_COLUMNS = Prisma.sql`
  v.id,
  v.worksheet_id AS "worksheetId",
  v.owner_id AS "ownerId",
  v.name,
  v.visibility,
  v.query,
  v.created_at AS "createdAt",
  v.updated_at AS "updatedAt"
`;

/**
 * Vistas guardadas (plan 02 de cierre, H4). Una vista personal solo existe
 * para su autor: para los demás responde 404, como lo ajeno. Una del equipo la
 * ve cualquier miembro.
 */
@Injectable()
export class SavedViewsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async find(
    actorId: string,
    scope: ProjectScope,
    viewId: string,
  ): Promise<SavedView | null> {
    const rows = await this.prisma.$queryRaw<SavedViewRow[]>(Prisma.sql`
      SELECT ${VIEW_COLUMNS}
      FROM estadistica_forms.worksheet_saved_views v
      WHERE v.id = ${viewId}
        AND ${isVisibleTo(actorId, scope)}
    `);
    return rows[0] ? toSavedView(rows[0]) : null;
  }

  /** Las del equipo y las propias, de la más reciente a la más antigua. */
  async findByWorksheet(
    actorId: string,
    scope: ProjectScope,
    worksheetId: string,
    page: PageRequest,
  ): Promise<SavedView[]> {
    const rows = await this.prisma.$queryRaw<SavedViewRow[]>(Prisma.sql`
      SELECT ${VIEW_COLUMNS}
      FROM estadistica_forms.worksheet_saved_views v
      WHERE v.worksheet_id = ${worksheetId}
        AND ${isVisibleTo(actorId, scope)}
      ORDER BY v.created_at DESC, v.id DESC
      LIMIT ${page.limit} OFFSET ${page.offset}
    `);
    return rows.map(toSavedView);
  }

  /**
   * Una vista personal pide ser miembro; una del equipo, poder editar la hoja
   * (Editor), porque la verán todos. Guardar vistas sí se puede en una hoja
   * archivada: no cambia ningún valor.
   */
  async create(
    actorId: string,
    scope: ProjectScope,
    worksheetId: string,
    input: SavedViewInput,
  ): Promise<SavedView> {
    return this.prisma.$transaction(async (tx) => {
      await lockProjectFor(tx, actorId, scope, permissionFor(input.visibility));
      await assertWorksheetInScope(tx, scope, worksheetId);
      if (await nameTaken(tx, worksheetId, actorId, input.name, null)) {
        throw apiError(ErrorCodes.SAVED_VIEW_NAME_TAKEN);
      }

      const now = new Date().toISOString();
      const rows = await tx.$queryRaw<SavedViewRow[]>(Prisma.sql`
        INSERT INTO estadistica_forms.worksheet_saved_views AS v
          (id, organization_id, project_id, worksheet_id, owner_id, name,
           name_normalized, visibility, query, created_at, updated_at)
        VALUES (
          ${randomUUID()},
          ${scope.organizationId},
          ${scope.projectId},
          ${worksheetId},
          ${actorId},
          ${input.name},
          ${normalizeName(input.name)},
          ${input.visibility},
          ${JSON.stringify(input.query)}::jsonb,
          ${now},
          ${now}
        )
        RETURNING ${VIEW_COLUMNS}
      `);
      return toSavedView(rows[0]);
    });
  }

  /** Sustituye nombre, visibilidad y consulta. La vista sigue siendo de su autor. */
  async replace(
    actorId: string,
    scope: ProjectScope,
    viewId: string,
    input: SavedViewInput,
  ): Promise<SavedView> {
    return this.prisma.$transaction(async (tx) => {
      const { role } = await lockProjectFor(
        tx,
        actorId,
        scope,
        permissionFor(input.visibility),
      );
      const view = await lockEditableView(tx, actorId, scope, viewId, role);
      const ownerHasName = await nameTaken(
        tx,
        view.worksheetId,
        view.ownerId,
        input.name,
        viewId,
      );
      if (ownerHasName) {
        throw apiError(ErrorCodes.SAVED_VIEW_NAME_TAKEN);
      }

      const rows = await tx.$queryRaw<SavedViewRow[]>(Prisma.sql`
        UPDATE estadistica_forms.worksheet_saved_views AS v
        SET name = ${input.name},
          name_normalized = ${normalizeName(input.name)},
          visibility = ${input.visibility},
          query = ${JSON.stringify(input.query)}::jsonb,
          updated_at = ${new Date().toISOString()}
        WHERE v.id = ${viewId}
        RETURNING ${VIEW_COLUMNS}
      `);
      return toSavedView(rows[0]);
    });
  }

  async delete(actorId: string, scope: ProjectScope, viewId: string) {
    await this.prisma.$transaction(async (tx) => {
      const { role } = await lockProjectFor(
        tx,
        actorId,
        scope,
        'organization.read',
      );
      await lockEditableView(tx, actorId, scope, viewId, role);
      await tx.$executeRaw(Prisma.sql`
        DELETE FROM estadistica_forms.worksheet_saved_views
        WHERE id = ${viewId}
      `);
    });
  }
}

/**
 * Cambiar o borrar una vista: su autor siempre; una del equipo, también un
 * Manager, para poder retirar una que confunda al resto.
 */
export function canEditView(
  view: Pick<SavedView, 'ownerId' | 'visibility'>,
  actorId: string,
  role: OrganizationRole,
): boolean {
  if (view.ownerId === actorId) {
    return true;
  }
  return view.visibility === 'team' && can(role, 'changeset.approve');
}

function permissionFor(visibility: ViewVisibility): OrganizationPermission {
  return visibility === 'team' ? 'worksheet.write' : 'organization.read';
}

/** Del equipo o propia, en este proyecto y siendo miembro. */
function isVisibleTo(actorId: string, scope: ProjectScope) {
  return Prisma.sql`
    v.organization_id = ${scope.organizationId}
    AND v.project_id = ${scope.projectId}
    AND (v.visibility = 'team' OR v.owner_id = ${actorId})
    AND EXISTS (
      SELECT 1
      FROM estadistica_forms.organization_members m
      WHERE m.organization_id = v.organization_id
        AND m.user_id = ${actorId}
    )
  `;
}

/** Una vista que no ve quien pregunta responde 404; una que ve pero no puede cambiar, 403. */
async function lockEditableView(
  tx: Prisma.TransactionClient,
  actorId: string,
  scope: ProjectScope,
  viewId: string,
  role: OrganizationRole,
): Promise<SavedView> {
  const rows = await tx.$queryRaw<SavedViewRow[]>(Prisma.sql`
    SELECT ${VIEW_COLUMNS}
    FROM estadistica_forms.worksheet_saved_views v
    WHERE v.id = ${viewId}
      AND ${isVisibleTo(actorId, scope)}
    FOR UPDATE OF v
  `);
  if (!rows[0]) {
    throw apiError(ErrorCodes.SAVED_VIEW_NOT_FOUND);
  }
  const view = toSavedView(rows[0]);
  if (!canEditView(view, actorId, role)) {
    throw apiError(ErrorCodes.FORBIDDEN);
  }
  return view;
}

async function assertWorksheetInScope(
  tx: Prisma.TransactionClient,
  scope: ProjectScope,
  worksheetId: string,
) {
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id
    FROM estadistica_forms.worksheets
    WHERE id = ${worksheetId}
      AND organization_id = ${scope.organizationId}
      AND project_id = ${scope.projectId}
  `);
  if (!rows[0]) {
    throw apiError(ErrorCodes.WORKSHEET_NOT_FOUND);
  }
}

/** El nombre es único entre las vistas de una persona en la hoja. */
async function nameTaken(
  tx: Prisma.TransactionClient,
  worksheetId: string,
  ownerId: string,
  name: string,
  exceptId: string | null,
) {
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id
    FROM estadistica_forms.worksheet_saved_views
    WHERE worksheet_id = ${worksheetId}
      AND owner_id = ${ownerId}
      AND name_normalized = ${normalizeName(name)}
      AND id IS DISTINCT FROM ${exceptId}
  `);
  return rows.length > 0;
}

/** Solo este repositorio escribe `query`; una forma distinta es un error del backend. */
function toSavedView(row: SavedViewRow): SavedView {
  if (!isSavedViewQuery(row.query)) {
    throw new Error(
      `La vista ${row.id} tiene una consulta con forma inválida.`,
    );
  }
  return { ...row, query: row.query };
}

function isSavedViewQuery(value: unknown): value is SavedViewQuery {
  if (!isRecord(value)) {
    return false;
  }
  const { filter, sort, columns, ...rest } = value;
  const hasValidFilter = filter === undefined || isRecord(filter);
  const hasValidSort =
    sort === undefined || (Array.isArray(sort) && sort.every(isSortTerm));
  const hasValidColumns =
    columns === undefined ||
    (Array.isArray(columns) && columns.every((id) => typeof id === 'string'));
  return (
    Object.keys(rest).length === 0 &&
    hasValidFilter &&
    hasValidSort &&
    hasValidColumns
  );
}

function isSortTerm(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.columnId === 'string' &&
    (value.direction === 'asc' || value.direction === 'desc')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
