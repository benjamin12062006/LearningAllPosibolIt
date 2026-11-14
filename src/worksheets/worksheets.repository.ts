import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import type { PageRequest } from '../common/http/pagination.js';
import { recordAuditEvent } from '../audit/audit-trail.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  assertNotArchived,
  lockOrganization,
} from '../organizations/organization-lock.js';
import {
  can,
  type OrganizationPermission,
  type OrganizationRole,
} from '../organizations/organization-roles.js';
import { buildNewWorksheet, type NewWorksheet } from './new-worksheet.js';
import { copyColumns } from './worksheet-copy.js';
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
  archivedAt: string | null;
  workbookArchivedAt: string | null;
  sourceWorksheetId: string | null;
  sourceRevisionId: string | null;
  headRevisionId: string;
  headSequence: number;
  headRowCount: number;
  headCreatedAt: string;
}>;

const WORKBOOK_COLUMNS = Prisma.sql`
  b.id,
  b.project_id AS "projectId",
  b.name,
  b.created_at AS "createdAt",
  b.archived_at AS "archivedAt"
`;

/** Columnas de `WORKSHEET_SOURCE`: la hoja, su head (`r`) y su libro (`b`). */
const WORKSHEET_COLUMNS = Prisma.sql`
  w.id,
  w.workbook_id AS "workbookId",
  w.name,
  w.mode,
  w.schema_version AS "schemaVersion",
  w.generation,
  w.created_at AS "createdAt",
  w.archived_at AS "archivedAt",
  b.archived_at AS "workbookArchivedAt",
  w.source_worksheet_id AS "sourceWorksheetId",
  w.source_revision_id AS "sourceRevisionId",
  r.id AS "headRevisionId",
  r.sequence AS "headSequence",
  r.row_count AS "headRowCount",
  r.created_at AS "headCreatedAt"
`;

const WORKSHEET_SOURCE = Prisma.sql`
  FROM estadistica_forms.worksheets w
  JOIN estadistica_forms.worksheet_revisions r
    ON r.worksheet_id = w.id AND r.id = w.head_revision_id
  JOIN estadistica_forms.workbooks b ON b.id = w.workbook_id
`;

const COLUMN_COLUMNS = Prisma.sql`
  column_id AS "id",
  name,
  type,
  position,
  required,
  options,
  formula
`;

/** Fila tal como sale de SQL: `options` y `formula` son nulas en casi todas. */
type ColumnRow = Omit<WorksheetColumn, 'options' | 'formula'> &
  Readonly<{
    options: WorksheetColumn['options'] | null;
    formula: WorksheetColumn['formula'] | null;
  }>;

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
    archived?: boolean,
  ): Promise<Workbook[]> {
    return this.prisma.$queryRaw<Workbook[]>(Prisma.sql`
      SELECT ${WORKBOOK_COLUMNS}
      FROM estadistica_forms.workbooks b
      WHERE b.organization_id = ${scope.organizationId}
        AND b.project_id = ${scope.projectId}
        AND ${isMember(actorId, Prisma.sql`b.organization_id`)}
        ${onlyArchived(Prisma.sql`b.archived_at`, archived)}
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
    archived?: boolean,
  ): Promise<WorksheetSummary[]> {
    const rows = await this.prisma.$queryRaw<WorksheetRow[]>(Prisma.sql`
      SELECT ${WORKSHEET_COLUMNS}
      ${WORKSHEET_SOURCE}
      WHERE w.workbook_id = ${workbookId}
        AND w.organization_id = ${scope.organizationId}
        AND w.project_id = ${scope.projectId}
        AND ${isMember(actorId, Prisma.sql`w.organization_id`)}
        ${onlyArchived(Prisma.sql`w.archived_at`, archived)}
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
      await lockProjectFor(tx, actorId, scope, 'worksheet.write');
      if (await workbookNameTaken(tx, scope, name, null)) {
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
      const access = await lockProjectFor(
        tx,
        actorId,
        scope,
        'worksheet.write',
      );
      const workbook = await requireWorkbook(tx, scope, workbookId);
      assertWorkbookActive(workbook);
      if (
        await worksheetNameTaken(tx, workbookId, worksheet.nameNormalized, null)
      ) {
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

  /**
   * Copia una hoja tal como estaba en una revisión (plan 02 de cierre, P8):
   * hoja, columnas, filas y revisión nuevas, todas con IDs nuevos, en una
   * transacción. No copia borradores, importaciones ni el historial: la copia
   * empieza en su revisión 1. El origen puede estar archivado (copiar es
   * leerlo); el libro de destino, no.
   */
  async duplicateWorksheet(
    actorId: string,
    scope: ProjectScope,
    sourceId: string,
    target: Readonly<{
      name: string;
      workbookId?: string;
      revisionId?: string;
    }>,
  ): Promise<{ worksheet: Worksheet; access: ProjectAccess }> {
    const now = new Date().toISOString();

    return this.prisma.$transaction(async (tx) => {
      const access = await lockProjectFor(
        tx,
        actorId,
        scope,
        'worksheet.write',
      );
      const source = await requireWorksheet(tx, actorId, scope, sourceId);
      const workbookId = target.workbookId ?? source.workbookId;
      assertWorkbookActive(await requireWorkbook(tx, scope, workbookId));
      const copiedFrom = await requireCopySource(
        tx,
        scope,
        sourceId,
        target.revisionId ?? source.headRevision.id,
      );

      const copy = copyColumns(
        await findColumnsIn(tx, scope, sourceId, copiedFrom.schemaVersion),
      );
      const worksheet = withRowCount(
        buildNewWorksheet(target.name, copy.columns),
        copiedFrom.rowCount,
      );
      if (
        await worksheetNameTaken(tx, workbookId, worksheet.nameNormalized, null)
      ) {
        throw apiError(ErrorCodes.WORKSHEET_NAME_TAKEN);
      }

      const insert = { actorId, scope, worksheet, now };
      await insertWorksheet(tx, { ...insert, workbookId, copiedFrom });
      await insertColumns(tx, scope, worksheet);
      await insertInitialRevision(tx, { ...insert, source: 'duplicate' });
      await copyRows(tx, scope, copiedFrom, worksheet, copy.newIdOf);
      await pointHeadToInitialRevision(tx, worksheet);
      await auditWorksheet(
        tx,
        scope,
        actorId,
        worksheet.worksheetId,
        'worksheet.duplicated',
        {
          fromWorksheetId: copiedFrom.worksheetId,
          fromRevisionId: copiedFrom.revisionId,
        },
      );
      return {
        worksheet: await requireWorksheet(
          tx,
          actorId,
          scope,
          worksheet.worksheetId,
        ),
        access,
      };
    });
  }

  // ── Renombrar y archivar (plan 02 de cierre, H1) ──

  async renameWorkbook(
    actorId: string,
    scope: ProjectScope,
    workbookId: string,
    name: string,
  ): Promise<Workbook> {
    return this.prisma.$transaction(async (tx) => {
      await lockProjectFor(tx, actorId, scope, 'worksheet.write');
      const workbook = await requireWorkbook(tx, scope, workbookId);
      assertWorkbookActive(workbook);
      if (await workbookNameTaken(tx, scope, name, workbookId)) {
        throw apiError(ErrorCodes.WORKBOOK_NAME_TAKEN);
      }

      await tx.$executeRaw(Prisma.sql`
        UPDATE estadistica_forms.workbooks
        SET name = ${name},
          name_normalized = ${normalizeName(name)}
        WHERE id = ${workbookId}
      `);
      await auditWorkbook(tx, scope, actorId, workbookId, 'workbook.renamed', {
        from: workbook.name,
        to: name,
      });
      return requireWorkbook(tx, scope, workbookId);
    });
  }

  /**
   * Archivar o restaurar un libro: Manager o más. Repetirlo no cambia nada (ni
   * la fecha ni la auditoría), para que un doble clic sea inofensivo.
   */
  async setWorkbookArchived(
    actorId: string,
    scope: ProjectScope,
    workbookId: string,
    archived: boolean,
  ): Promise<Workbook> {
    return this.prisma.$transaction(async (tx) => {
      await lockProjectFor(tx, actorId, scope, 'changeset.approve');
      const workbook = await requireWorkbook(tx, scope, workbookId);
      if ((workbook.archivedAt !== null) === archived) {
        return workbook;
      }

      await tx.$executeRaw(Prisma.sql`
        UPDATE estadistica_forms.workbooks
        SET archived_at = ${archived ? new Date().toISOString() : null}
        WHERE id = ${workbookId}
      `);
      const action = archived ? 'workbook.archived' : 'workbook.restored';
      await auditWorkbook(tx, scope, actorId, workbookId, action, {});
      return requireWorkbook(tx, scope, workbookId);
    });
  }

  async renameWorksheet(
    actorId: string,
    scope: ProjectScope,
    worksheetId: string,
    name: string,
  ): Promise<{ worksheet: Worksheet; access: ProjectAccess }> {
    return this.prisma.$transaction(async (tx) => {
      const access = await lockProjectFor(
        tx,
        actorId,
        scope,
        'worksheet.write',
      );
      const worksheet = await requireWorksheet(tx, actorId, scope, worksheetId);
      assertWorksheetIsActive(worksheet);
      const nameNormalized = normalizeName(name);
      if (
        await worksheetNameTaken(
          tx,
          worksheet.workbookId,
          nameNormalized,
          worksheetId,
        )
      ) {
        throw apiError(ErrorCodes.WORKSHEET_NAME_TAKEN);
      }

      await tx.$executeRaw(Prisma.sql`
        UPDATE estadistica_forms.worksheets
        SET name = ${name},
          name_normalized = ${nameNormalized}
        WHERE id = ${worksheetId}
      `);
      await auditWorksheet(
        tx,
        scope,
        actorId,
        worksheetId,
        'worksheet.renamed',
        { from: worksheet.name, to: name },
      );
      return {
        worksheet: await requireWorksheet(tx, actorId, scope, worksheetId),
        access,
      };
    });
  }

  /** Como en los libros: Manager o más, y repetirlo no cambia nada. */
  async setWorksheetArchived(
    actorId: string,
    scope: ProjectScope,
    worksheetId: string,
    archived: boolean,
  ): Promise<{ worksheet: Worksheet; access: ProjectAccess }> {
    return this.prisma.$transaction(async (tx) => {
      const access = await lockProjectFor(
        tx,
        actorId,
        scope,
        'changeset.approve',
      );
      const worksheet = await requireWorksheet(tx, actorId, scope, worksheetId);
      if ((worksheet.archivedAt !== null) === archived) {
        return { worksheet, access };
      }

      await tx.$executeRaw(Prisma.sql`
        UPDATE estadistica_forms.worksheets
        SET archived_at = ${archived ? new Date().toISOString() : null}
        WHERE id = ${worksheetId}
      `);
      const action = archived ? 'worksheet.archived' : 'worksheet.restored';
      await auditWorksheet(tx, scope, actorId, worksheetId, action, {});
      return {
        worksheet: await requireWorksheet(tx, actorId, scope, worksheetId),
        access,
      };
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
 * esa organización (404), archivada (409) y el permiso pedido (403). Lo usan
 * también los borradores de E4, que dependen de este módulo.
 */
export async function lockProjectFor(
  tx: Prisma.TransactionClient,
  actorId: string,
  scope: ProjectScope,
  permission: OrganizationPermission,
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
  if (!can(role, permission)) {
    throw apiError(ErrorCodes.FORBIDDEN);
  }
  return { role, isArchived: false };
}

// ── Comprobaciones dentro de la transacción ──
// Son seguras sin más bloqueos: toda escritura de libros y hojas de la
// organización espera a la fila de la organización bloqueada.

/**
 * ¿Usa ya ese nombre otro libro del proyecto? `exceptId` es el libro que se
 * está renombrando: cambiar solo las mayúsculas de su nombre no es un choque.
 * Los archivados también cuentan: su nombre sigue reservado.
 */
async function workbookNameTaken(
  tx: Prisma.TransactionClient,
  scope: ProjectScope,
  name: string,
  exceptId: string | null,
) {
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id
    FROM estadistica_forms.workbooks
    WHERE project_id = ${scope.projectId}
      AND name_normalized = ${normalizeName(name)}
      AND id IS DISTINCT FROM ${exceptId}
  `);
  return rows.length > 0;
}

/** El libro, o 404 si no es de este proyecto. */
async function requireWorkbook(
  tx: Prisma.TransactionClient,
  scope: ProjectScope,
  workbookId: string,
): Promise<Workbook> {
  const rows = await tx.$queryRaw<Workbook[]>(Prisma.sql`
    SELECT ${WORKBOOK_COLUMNS}
    FROM estadistica_forms.workbooks b
    WHERE b.id = ${workbookId}
      AND b.organization_id = ${scope.organizationId}
      AND b.project_id = ${scope.projectId}
  `);
  if (!rows[0]) {
    throw apiError(ErrorCodes.WORKBOOK_NOT_FOUND);
  }
  return rows[0];
}

function assertWorkbookActive(workbook: Workbook) {
  if (workbook.archivedAt !== null) {
    throw apiError(ErrorCodes.WORKBOOK_ARCHIVED);
  }
}

async function requireWorksheet(
  tx: Prisma.TransactionClient,
  actorId: string,
  scope: ProjectScope,
  worksheetId: string,
): Promise<Worksheet> {
  const worksheet = await findWorksheetIn(tx, actorId, scope, worksheetId);
  if (!worksheet) {
    throw apiError(ErrorCodes.WORKSHEET_NOT_FOUND);
  }
  return worksheet;
}

/** Una hoja está archivada si lo está ella o lo está su libro. */
export function isArchivedWorksheet(
  worksheet: Pick<WorksheetSummary, 'archivedAt' | 'workbookArchivedAt'>,
) {
  return worksheet.archivedAt !== null || worksheet.workbookArchivedAt !== null;
}

function assertWorksheetIsActive(
  worksheet: Pick<WorksheetSummary, 'archivedAt' | 'workbookArchivedAt'>,
) {
  if (isArchivedWorksheet(worksheet)) {
    throw apiError(ErrorCodes.WORKSHEET_ARCHIVED);
  }
}

/**
 * Para las escrituras de otros módulos sobre una hoja (borradores,
 * importaciones, puente al catálogo): 404 si la hoja no es de este proyecto y
 * 409 si ella o su libro están archivados. Quien llama ya bloqueó la
 * organización con `lockProjectFor`, así que no puede archivarse a la vez.
 */
export async function assertWorksheetActive(
  tx: Prisma.TransactionClient,
  scope: ProjectScope,
  worksheetId: string,
) {
  const rows = await tx.$queryRaw<
    Pick<WorksheetSummary, 'archivedAt' | 'workbookArchivedAt'>[]
  >(Prisma.sql`
    SELECT
      w.archived_at AS "archivedAt",
      b.archived_at AS "workbookArchivedAt"
    FROM estadistica_forms.worksheets w
    JOIN estadistica_forms.workbooks b ON b.id = w.workbook_id
    WHERE w.id = ${worksheetId}
      AND w.organization_id = ${scope.organizationId}
      AND w.project_id = ${scope.projectId}
  `);
  if (!rows[0]) {
    throw apiError(ErrorCodes.WORKSHEET_NOT_FOUND);
  }
  assertWorksheetIsActive(rows[0]);
}

/** Como `workbookNameTaken`, dentro de un libro. */
async function worksheetNameTaken(
  tx: Prisma.TransactionClient,
  workbookId: string,
  nameNormalized: string,
  exceptId: string | null,
) {
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id
    FROM estadistica_forms.worksheets
    WHERE workbook_id = ${workbookId}
      AND name_normalized = ${nameNormalized}
      AND id IS DISTINCT FROM ${exceptId}
  `);
  return rows.length > 0;
}

/** Sin filtro, activos y archivados; con él, solo unos u otros. */
function onlyArchived(column: Prisma.Sql, archived: boolean | undefined) {
  if (archived === undefined) {
    return Prisma.empty;
  }
  return archived
    ? Prisma.sql`AND ${column} IS NOT NULL`
    : Prisma.sql`AND ${column} IS NULL`;
}

// ── Copia de una hoja ──

/** La revisión pedida de esa hoja; una de otra hoja responde como una inexistente. */
async function requireCopySource(
  tx: Prisma.TransactionClient,
  scope: ProjectScope,
  worksheetId: string,
  revisionId: string,
): Promise<CopySource> {
  const rows = await tx.$queryRaw<CopySource[]>(Prisma.sql`
    SELECT
      worksheet_id AS "worksheetId",
      id AS "revisionId",
      sequence,
      schema_version AS "schemaVersion",
      row_count AS "rowCount"
    FROM estadistica_forms.worksheet_revisions
    WHERE id = ${revisionId}
      AND worksheet_id = ${worksheetId}
      AND organization_id = ${scope.organizationId}
  `);
  if (!rows[0]) {
    throw apiError(ErrorCodes.WORKSHEET_REVISION_NOT_FOUND);
  }
  return rows[0];
}

/** La copia nace con las filas del origen: su primera revisión no está vacía. */
function withRowCount(worksheet: NewWorksheet, rowCount: number): NewWorksheet {
  return {
    ...worksheet,
    initialRevision: { ...worksheet.initialRevision, rowCount },
  };
}

/**
 * Copia en una sentencia las filas vivas en la revisión de origen, con `row_id`
 * nuevo y las celdas reescritas con los IDs de columna de la copia. Una hoja
 * sin columnas no tiene nada que reescribir: sus filas quedan con `{}`.
 */
async function copyRows(
  tx: Prisma.TransactionClient,
  scope: ProjectScope,
  source: CopySource,
  worksheet: NewWorksheet,
  newIdOf: ReadonlyMap<string, string>,
) {
  const sequence = worksheet.initialRevision.sequence;
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO estadistica_forms.worksheet_row_versions
      (organization_id, worksheet_id, row_id, from_sequence, to_sequence,
       sort_key, cell_values, is_deleted)
    SELECT
      ${scope.organizationId},
      ${worksheet.worksheetId},
      gen_random_uuid()::text,
      ${sequence},
      NULL,
      v.sort_key,
      ${copiedCellValues(newIdOf)},
      false
    FROM estadistica_forms.worksheet_row_versions v
    WHERE v.worksheet_id = ${source.worksheetId}
      AND v.organization_id = ${scope.organizationId}
      AND v.from_sequence <= ${source.sequence}
      AND (v.to_sequence IS NULL OR v.to_sequence > ${source.sequence})
      AND NOT v.is_deleted
  `);
}

function copiedCellValues(newIdOf: ReadonlyMap<string, string>) {
  if (newIdOf.size === 0) {
    return Prisma.sql`'{}'::jsonb`;
  }
  const pairs = [...newIdOf].map(
    ([oldId, newId]) => Prisma.sql`(${oldId}, ${newId})`,
  );
  return Prisma.sql`
    COALESCE(
      (
        SELECT jsonb_object_agg(ids.new_id, cell.value)
        FROM jsonb_each(v.cell_values) AS cell
        JOIN (VALUES ${Prisma.join(pairs)}) AS ids(old_id, new_id)
          ON ids.old_id = cell.key
      ),
      '{}'::jsonb
    )
  `;
}

// ── Auditoría ──

function auditWorkbook(
  tx: Prisma.TransactionClient,
  scope: ProjectScope,
  actorId: string,
  workbookId: string,
  action: string,
  details: Readonly<Record<string, unknown>>,
) {
  return recordAuditEvent(tx, {
    organizationId: scope.organizationId,
    actorId,
    action,
    resourceType: 'workbook',
    resourceId: workbookId,
    details,
    now: new Date().toISOString(),
  });
}

function auditWorksheet(
  tx: Prisma.TransactionClient,
  scope: ProjectScope,
  actorId: string,
  worksheetId: string,
  action: string,
  details: Readonly<Record<string, unknown>>,
) {
  return recordAuditEvent(tx, {
    organizationId: scope.organizationId,
    actorId,
    action,
    resourceType: 'worksheet',
    resourceId: worksheetId,
    details,
    now: new Date().toISOString(),
  });
}

// ── Inserciones de la hoja nueva ──

type WorksheetInsert = Readonly<{
  actorId: string;
  scope: ProjectScope;
  worksheet: NewWorksheet;
  now: string;
}>;

/** La revisión de la que sale una copia, con lo necesario para leer sus filas. */
type CopySource = Readonly<{
  worksheetId: string;
  revisionId: string;
  sequence: number;
  schemaVersion: number;
  rowCount: number;
}>;

/** El head queda nulo hasta `pointHeadToInitialRevision`, en esta misma transacción. */
async function insertWorksheet(
  tx: Prisma.TransactionClient,
  input: WorksheetInsert &
    Readonly<{ workbookId: string; copiedFrom?: CopySource }>,
) {
  const { worksheet, scope } = input;
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO estadistica_forms.worksheets
      (id, organization_id, project_id, workbook_id, name, name_normalized,
       mode, schema_version, generation, head_revision_id, created_by, created_at,
       source_worksheet_id, source_revision_id)
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
      ${input.now},
      ${input.copiedFrom?.worksheetId ?? null},
      ${input.copiedFrom?.revisionId ?? null}
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
      ${column.required},
      ${jsonOrNull(column.options)}::jsonb,
      ${jsonOrNull(column.formula)}::jsonb
    )`,
  );
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO estadistica_forms.worksheet_column_versions
      (organization_id, worksheet_id, schema_version, column_id, name,
       name_normalized, type, position, required, options, formula)
    VALUES ${Prisma.join(values)}
  `);
}

function jsonOrNull(value: unknown) {
  return value === undefined ? null : JSON.stringify(value);
}

async function insertInitialRevision(
  tx: Prisma.TransactionClient,
  input: WorksheetInsert & Readonly<{ source?: 'initialize' | 'duplicate' }>,
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
      ${input.source ?? 'initialize'},
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
    ${WORKSHEET_SOURCE}
    WHERE w.id = ${worksheetId}
      AND w.organization_id = ${scope.organizationId}
      AND w.project_id = ${scope.projectId}
      AND ${isMember(actorId, Prisma.sql`w.organization_id`)}
  `);
  const row = rows[0];
  if (!row) {
    return null;
  }

  const columns = await findColumnsIn(
    client,
    scope,
    worksheetId,
    row.schemaVersion,
  );
  return { ...toSummary(row), columns };
}

/**
 * Columnas de una versión de esquema, en orden. La comparten la lectura de la
 * hoja y la de filas. El llamador ya comprobó el acceso a la hoja.
 */
export async function findColumnsIn(
  client: Prisma.TransactionClient,
  scope: ProjectScope,
  worksheetId: string,
  schemaVersion: number,
): Promise<WorksheetColumn[]> {
  const rows = await client.$queryRaw<ColumnRow[]>(Prisma.sql`
    SELECT ${COLUMN_COLUMNS}
    FROM estadistica_forms.worksheet_column_versions
    WHERE worksheet_id = ${worksheetId}
      AND organization_id = ${scope.organizationId}
      AND schema_version = ${schemaVersion}
    ORDER BY position
  `);
  return rows.map(toColumn);
}

/** Opciones y fórmula solo aparecen en las columnas que las tienen. */
function toColumn(row: ColumnRow): WorksheetColumn {
  const { options, formula, ...column } = row;
  return {
    ...column,
    ...(options ? { options } : {}),
    ...(formula ? { formula } : {}),
  };
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
    archivedAt: row.archivedAt,
    workbookArchivedAt: row.workbookArchivedAt,
    duplicatedFrom: duplicatedFromOf(row),
  };
}

function duplicatedFromOf(
  row: WorksheetRow,
): WorksheetSummary['duplicatedFrom'] {
  if (row.sourceWorksheetId === null || row.sourceRevisionId === null) {
    return null;
  }
  return {
    worksheetId: row.sourceWorksheetId,
    revisionId: row.sourceRevisionId,
  };
}
