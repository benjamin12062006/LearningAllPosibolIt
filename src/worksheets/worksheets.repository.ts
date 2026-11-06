import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import type { PageRequest } from '../common/http/pagination.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  assertNotArchived,
  lockOrganization,
} from '../organizations/organization-lock.js';
import {
  can,
  type OrganizationRole,
} from '../organizations/organization-roles.js';
import type { NewWorksheet } from './new-worksheet.js';
import { normalizeName } from './worksheet-columns.js';
import type {
  ProjectScope,
  Workbook,
  Worksheet,
  WorksheetColumn,
  WorksheetSummary,
} from './worksheets.types.js';

/** Rol de quien pregunta en la organización del proyecto. */
export type ProjectAccess = Readonly<{
  role: OrganizationRole;
  isArchived: boolean;
}>;

/** Fila de hoja con su head ya unido; `toSummary` la agrupa. */
type WorksheetRow = Readonly<{
  id: string;
  workbookId: string;
  name: string;
  mode: 'free';
  schemaVersion: number;
  generation: number;
  createdAt: string;
  headRevisionId: string;
  headSequence: number;
  headRowCount: number;
  headCreatedAt: string;
}>;

const WORKBOOK_COLUMNS = Prisma.sql`
  b.id,
  b.project_id AS "projectId",
  b.name,
  b.created_at AS "createdAt"
`;

/** Columnas de `worksheets w JOIN worksheet_revisions r` (el head). */
const WORKSHEET_COLUMNS = Prisma.sql`
  w.id,
  w.workbook_id AS "workbookId",
  w.name,
  w.mode,
  w.schema_version AS "schemaVersion",
  w.generation,
  w.created_at AS "createdAt",
  r.id AS "headRevisionId",
  r.sequence AS "headSequence",
  r.row_count AS "headRowCount",
  r.created_at AS "headCreatedAt"
`;

const COLUMN_COLUMNS = Prisma.sql`
  column_id AS "id",
  name,
  type,
  position,
  required
`;

/**
 * La organización y el proyecto de la ruta se comprueban en cada consulta:
 * todas filtran por los dos y por la membresía de quien pregunta (W7, C6).
 */
@Injectable()
export class WorksheetsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Lecturas ──

  /** `null` si el proyecto no es de esa organización o el usuario no es miembro. */
  async findAccess(
    actorId: string,
    scope: ProjectScope,
  ): Promise<ProjectAccess | null> {
    const rows = await this.prisma.$queryRaw<ProjectAccess[]>(Prisma.sql`
      SELECT
        m.role,
        o.archived_at IS NOT NULL AS "isArchived"
      FROM estadistica_forms.projects p
      JOIN estadistica_forms.organizations o ON o.id = p.organization_id
      JOIN estadistica_forms.organization_members m
        ON m.organization_id = o.id AND m.user_id = ${actorId}
      WHERE p.id = ${scope.projectId}
        AND p.organization_id = ${scope.organizationId}
    `);
    return rows[0] ?? null;
  }

  async findWorkbooks(
    actorId: string,
    scope: ProjectScope,
    page: PageRequest,
  ): Promise<Workbook[]> {
    return this.prisma.$queryRaw<Workbook[]>(Prisma.sql`
      SELECT ${WORKBOOK_COLUMNS}
      FROM estadistica_forms.workbooks b
      WHERE b.organization_id = ${scope.organizationId}
        AND b.project_id = ${scope.projectId}
        AND ${isMember(actorId, Prisma.sql`b.organization_id`)}
      ORDER BY b.created_at DESC, b.id DESC
      LIMIT ${page.limit} OFFSET ${page.offset}
    `);
  }

  async workbookExists(
    actorId: string,
    scope: ProjectScope,
    workbookId: string,
  ): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT b.id
      FROM estadistica_forms.workbooks b
      WHERE b.id = ${workbookId}
        AND b.organization_id = ${scope.organizationId}
        AND b.project_id = ${scope.projectId}
        AND ${isMember(actorId, Prisma.sql`b.organization_id`)}
    `);
    return rows.length > 0;
  }

  async findWorksheets(
    actorId: string,
    scope: ProjectScope,
    workbookId: string,
    page: PageRequest,
  ): Promise<WorksheetSummary[]> {
    const rows = await this.prisma.$queryRaw<WorksheetRow[]>(Prisma.sql`
      SELECT ${WORKSHEET_COLUMNS}
      FROM estadistica_forms.worksheets w
      JOIN estadistica_forms.worksheet_revisions r
        ON r.worksheet_id = w.id AND r.id = w.head_revision_id
      WHERE w.workbook_id = ${workbookId}
        AND w.organization_id = ${scope.organizationId}
        AND w.project_id = ${scope.projectId}
        AND ${isMember(actorId, Prisma.sql`w.organization_id`)}
      ORDER BY w.created_at DESC, w.id DESC
      LIMIT ${page.limit} OFFSET ${page.offset}
    `);
    return rows.map(toSummary);
  }

  findWorksheet(
    actorId: string,
    scope: ProjectScope,
    worksheetId: string,
  ): Promise<Worksheet | null> {
    return findWorksheetIn(this.prisma, actorId, scope, worksheetId);
  }

  // ── Escrituras ──

  async createWorkbook(
    actorId: string,
    scope: ProjectScope,
    name: string,
  ): Promise<Workbook> {
    return this.prisma.$transaction(async (tx) => {
      await lockWritableProject(tx, actorId, scope);
      if (await workbookNameTaken(tx, scope, name)) {
        throw apiError(ErrorCodes.WORKBOOK_NAME_TAKEN);
      }

      const rows = await tx.$queryRaw<Workbook[]>(Prisma.sql`
        INSERT INTO estadistica_forms.workbooks AS b
          (id, organization_id, project_id, name, name_normalized, created_by, created_at)
        VALUES (
          ${randomUUID()},
          ${scope.organizationId},
          ${scope.projectId},
          ${name},
          ${normalizeName(name)},
          ${actorId},
          ${new Date().toISOString()}
        )
        RETURNING ${WORKBOOK_COLUMNS}
      `);
      return rows[0];
    });
  }

  /**
   * Hoja, columnas, revisión inicial y puntero al head en una sola
   * transacción (C14): o se crea todo o nada.
   */
  async createWorksheet(
    actorId: string,
    scope: ProjectScope,
    workbookId: string,
    worksheet: NewWorksheet,
  ): Promise<{ worksheet: Worksheet; access: ProjectAccess }> {
    const now = new Date().toISOString();

    return this.prisma.$transaction(async (tx) => {
      const access = await lockWritableProject(tx, actorId, scope);
      if (!(await workbookInScope(tx, scope, workbookId))) {
        throw apiError(ErrorCodes.WORKBOOK_NOT_FOUND);
      }
      if (await worksheetNameTaken(tx, workbookId, worksheet.nameNormalized)) {
        throw apiError(ErrorCodes.WORKSHEET_NAME_TAKEN);
      }

      await insertWorksheet(tx, { actorId, scope, workbookId, worksheet, now });
      await insertColumns(tx, scope, worksheet);
      await insertInitialRevision(tx, { actorId, scope, worksheet, now });
      await pointHeadToInitialRevision(tx, worksheet);

      const created = await findWorksheetIn(
        tx,
        actorId,
        scope,
        worksheet.worksheetId,
      );
      if (!created) {
        throw apiError(ErrorCodes.INTERNAL_ERROR);
      }
      return { worksheet: created, access };
    });
  }
}

// ── Acceso ──

function isMember(actorId: string, organizationColumn: Prisma.Sql) {
  return Prisma.sql`
    EXISTS (
      SELECT 1
      FROM estadistica_forms.organization_members m
      WHERE m.organization_id = ${organizationColumn}
        AND m.user_id = ${actorId}
    )
  `;
}

/**
 * Primer paso de toda escritura (W7): bloquea la organización (F39) y, ya
 * dentro de la transacción, comprueba por este orden: miembro y proyecto de
 * esa organización (404), archivada (409) y permiso `worksheet.write` (403).
 */
async function lockWritableProject(
  tx: Prisma.TransactionClient,
  actorId: string,
  scope: ProjectScope,
): Promise<ProjectAccess> {
  const organization = await lockOrganization(tx, scope.organizationId);
  const rows = await tx.$queryRaw<{ role: OrganizationRole }[]>(Prisma.sql`
    SELECT m.role
    FROM estadistica_forms.projects p
    JOIN estadistica_forms.organization_members m
      ON m.organization_id = p.organization_id AND m.user_id = ${actorId}
    WHERE p.id = ${scope.projectId}
      AND p.organization_id = ${scope.organizationId}
  `);
  const role = rows[0]?.role;
  if (!organization || !role) {
    throw apiError(ErrorCodes.PROJECT_NOT_FOUND);
  }
  assertNotArchived(organization);
  if (!can(role, 'worksheet.write')) {
    throw apiError(ErrorCodes.FORBIDDEN);
  }
  return { role, isArchived: false };
}

// ── Comprobaciones dentro de la transacción ──
// Son seguras sin más bloqueos: toda escritura de libros y hojas de la
// organización espera a la fila de la organización bloqueada.

async function workbookNameTaken(
  tx: Prisma.TransactionClient,
  scope: ProjectScope,
  name: string,
) {
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id
    FROM estadistica_forms.workbooks
    WHERE project_id = ${scope.projectId}
      AND name_normalized = ${normalizeName(name)}
  `);
  return rows.length > 0;
}

async function workbookInScope(
  tx: Prisma.TransactionClient,
  scope: ProjectScope,
  workbookId: string,
) {
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id
    FROM estadistica_forms.workbooks
    WHERE id = ${workbookId}
      AND organization_id = ${scope.organizationId}
      AND project_id = ${scope.projectId}
  `);
  return rows.length > 0;
}

async function worksheetNameTaken(
  tx: Prisma.TransactionClient,
  workbookId: string,
  nameNormalized: string,
) {
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id
    FROM estadistica_forms.worksheets
    WHERE workbook_id = ${workbookId}
      AND name_normalized = ${nameNormalized}
  `);
  return rows.length > 0;
}

// ── Inserciones de la hoja nueva ──

type WorksheetInsert = Readonly<{
  actorId: string;
  scope: ProjectScope;
  worksheet: NewWorksheet;
  now: string;
}>;

/** El head queda nulo hasta `pointHeadToInitialRevision`, en esta misma transacción. */
async function insertWorksheet(
  tx: Prisma.TransactionClient,
  input: WorksheetInsert & Readonly<{ workbookId: string }>,
) {
  const { worksheet, scope } = input;
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO estadistica_forms.worksheets
      (id, organization_id, project_id, workbook_id, name, name_normalized,
       mode, schema_version, generation, head_revision_id, created_by, created_at)
    VALUES (
      ${worksheet.worksheetId},
      ${scope.organizationId},
      ${scope.projectId},
      ${input.workbookId},
      ${worksheet.name},
      ${worksheet.nameNormalized},
      'free',
      ${worksheet.schemaVersion},
      ${worksheet.initialRevision.sequence},
      NULL,
      ${input.actorId},
      ${input.now}
    )
  `);
}

async function insertColumns(
  tx: Prisma.TransactionClient,
  scope: ProjectScope,
  worksheet: NewWorksheet,
) {
  if (worksheet.columns.length === 0) {
    return;
  }
  const values = worksheet.columns.map(
    (column) => Prisma.sql`(
      ${scope.organizationId},
      ${worksheet.worksheetId},
      ${worksheet.schemaVersion},
      ${column.columnId},
      ${column.name},
      ${column.nameNormalized},
      ${column.type},
      ${column.position},
      ${column.required}
    )`,
  );
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO estadistica_forms.worksheet_column_versions
      (organization_id, worksheet_id, schema_version, column_id, name,
       name_normalized, type, position, required)
    VALUES ${Prisma.join(values)}
  `);
}

async function insertInitialRevision(
  tx: Prisma.TransactionClient,
  input: WorksheetInsert,
) {
  const { worksheet, scope } = input;
  const revision = worksheet.initialRevision;
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO estadistica_forms.worksheet_revisions
      (id, organization_id, worksheet_id, sequence, schema_version, source,
       row_count, created_by, created_at)
    VALUES (
      ${revision.revisionId},
      ${scope.organizationId},
      ${worksheet.worksheetId},
      ${revision.sequence},
      ${revision.schemaVersion},
      'initialize',
      ${revision.rowCount},
      ${input.actorId},
      ${input.now}
    )
  `);
}

async function pointHeadToInitialRevision(
  tx: Prisma.TransactionClient,
  worksheet: NewWorksheet,
) {
  await tx.$executeRaw(Prisma.sql`
    UPDATE estadistica_forms.worksheets
    SET head_revision_id = ${worksheet.initialRevision.revisionId}
    WHERE id = ${worksheet.worksheetId}
  `);
}

// ── Lectura de una hoja completa ──

async function findWorksheetIn(
  client: Prisma.TransactionClient,
  actorId: string,
  scope: ProjectScope,
  worksheetId: string,
): Promise<Worksheet | null> {
  const rows = await client.$queryRaw<WorksheetRow[]>(Prisma.sql`
    SELECT ${WORKSHEET_COLUMNS}
    FROM estadistica_forms.worksheets w
    JOIN estadistica_forms.worksheet_revisions r
      ON r.worksheet_id = w.id AND r.id = w.head_revision_id
    WHERE w.id = ${worksheetId}
      AND w.organization_id = ${scope.organizationId}
      AND w.project_id = ${scope.projectId}
      AND ${isMember(actorId, Prisma.sql`w.organization_id`)}
  `);
  const row = rows[0];
  if (!row) {
    return null;
  }

  const columns = await client.$queryRaw<WorksheetColumn[]>(Prisma.sql`
    SELECT ${COLUMN_COLUMNS}
    FROM estadistica_forms.worksheet_column_versions
    WHERE worksheet_id = ${worksheetId}
      AND organization_id = ${scope.organizationId}
      AND schema_version = ${row.schemaVersion}
    ORDER BY position
  `);
  return { ...toSummary(row), columns };
}

function toSummary(row: WorksheetRow): WorksheetSummary {
  return {
    id: row.id,
    workbookId: row.workbookId,
    name: row.name,
    mode: row.mode,
    schemaVersion: row.schemaVersion,
    generation: row.generation,
    headRevision: {
      id: row.headRevisionId,
      sequence: row.headSequence,
      rowCount: row.headRowCount,
      createdAt: row.headCreatedAt,
    },
    createdAt: row.createdAt,
  };
}
