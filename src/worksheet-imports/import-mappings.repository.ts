import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { recordAuditEvent } from '../audit/audit-trail.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import type { PageRequest } from '../common/http/pagination.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { normalizeName } from '../worksheets/worksheet-columns.js';
import {
  assertWorksheetActive,
  lockProjectFor,
} from '../worksheets/worksheets.repository.js';
import type { ProjectScope } from '../worksheets/worksheets.types.js';
import {
  parseMappingTemplate,
  type MappingTemplate,
} from './import-mapping.js';

/** Una plantilla de mapeo tal como la ve el cliente (H3). */
export type ImportMapping = Readonly<{
  id: string;
  worksheetId: string;
  name: string;
  mapping: MappingTemplate;
  createdBy: string;
  createdAt: string;
}>;

/** Fila tal como sale de SQL: `mapping` es `jsonb` y se comprueba al leerla. */
type ImportMappingRow = Omit<ImportMapping, 'mapping'> &
  Readonly<{ mapping: unknown }>;

const MAPPING_COLUMNS = Prisma.sql`
  m.id,
  m.worksheet_id AS "worksheetId",
  m.name,
  m.mapping,
  m.created_by AS "createdBy",
  m.created_at AS "createdAt"
`;

/**
 * Plantillas de mapeo de las hojas (plan 02 de cierre, H3). Como en el resto
 * de hojas, cada lectura filtra por organización, proyecto y membresía, y cada
 * escritura empieza por `lockProjectFor`.
 */
@Injectable()
export class ImportMappingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async find(
    actorId: string,
    scope: ProjectScope,
    mappingId: string,
  ): Promise<ImportMapping | null> {
    const rows = await this.prisma.$queryRaw<ImportMappingRow[]>(Prisma.sql`
      SELECT ${MAPPING_COLUMNS}
      FROM estadistica_forms.worksheet_import_mappings m
      WHERE m.id = ${mappingId}
        AND m.organization_id = ${scope.organizationId}
        AND m.project_id = ${scope.projectId}
        AND ${isMember(actorId)}
    `);
    return rows[0] ? toImportMapping(rows[0]) : null;
  }

  /** Las plantillas de una hoja, de la más reciente a la más antigua. */
  async findByWorksheet(
    actorId: string,
    scope: ProjectScope,
    worksheetId: string,
    page: PageRequest,
  ): Promise<ImportMapping[]> {
    const rows = await this.prisma.$queryRaw<ImportMappingRow[]>(Prisma.sql`
      SELECT ${MAPPING_COLUMNS}
      FROM estadistica_forms.worksheet_import_mappings m
      WHERE m.worksheet_id = ${worksheetId}
        AND m.organization_id = ${scope.organizationId}
        AND m.project_id = ${scope.projectId}
        AND ${isMember(actorId)}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ${page.limit} OFFSET ${page.offset}
    `);
    return rows.map(toImportMapping);
  }

  /**
   * Guarda una plantilla ya validada. Una hoja archivada no admite plantillas
   * nuevas: es configuración de la hoja, como sus columnas.
   */
  async create(
    actorId: string,
    scope: ProjectScope,
    worksheetId: string,
    input: Readonly<{ name: string; template: MappingTemplate }>,
  ): Promise<ImportMapping> {
    return this.prisma.$transaction(async (tx) => {
      await lockProjectFor(tx, actorId, scope, 'worksheet.write');
      await assertWorksheetActive(tx, scope, worksheetId);
      if (await nameTaken(tx, worksheetId, input.name)) {
        throw apiError(ErrorCodes.IMPORT_MAPPING_NAME_TAKEN);
      }

      const id = randomUUID();
      const now = new Date().toISOString();
      const rows = await tx.$queryRaw<ImportMappingRow[]>(Prisma.sql`
        INSERT INTO estadistica_forms.worksheet_import_mappings AS m
          (id, organization_id, project_id, worksheet_id, name,
           name_normalized, mapping, created_by, created_at)
        VALUES (
          ${id},
          ${scope.organizationId},
          ${scope.projectId},
          ${worksheetId},
          ${input.name},
          ${normalizeName(input.name)},
          ${JSON.stringify(input.template)}::jsonb,
          ${actorId},
          ${now}
        )
        RETURNING ${MAPPING_COLUMNS}
      `);
      await audit(tx, scope, actorId, id, 'import_mapping.created', now, {
        worksheetId,
        name: input.name,
      });
      return toImportMapping(rows[0]);
    });
  }

  async delete(actorId: string, scope: ProjectScope, mappingId: string) {
    await this.prisma.$transaction(async (tx) => {
      await lockProjectFor(tx, actorId, scope, 'worksheet.write');
      const rows = await tx.$queryRaw<{ worksheetId: string; name: string }[]>(
        Prisma.sql`
          SELECT worksheet_id AS "worksheetId", name
          FROM estadistica_forms.worksheet_import_mappings
          WHERE id = ${mappingId}
            AND organization_id = ${scope.organizationId}
            AND project_id = ${scope.projectId}
          FOR UPDATE
        `,
      );
      const mapping = rows[0];
      if (!mapping) {
        throw apiError(ErrorCodes.IMPORT_MAPPING_NOT_FOUND);
      }
      await assertWorksheetActive(tx, scope, mapping.worksheetId);

      await tx.$executeRaw(Prisma.sql`
        DELETE FROM estadistica_forms.worksheet_import_mappings
        WHERE id = ${mappingId}
      `);
      const now = new Date().toISOString();
      await audit(
        tx,
        scope,
        actorId,
        mappingId,
        'import_mapping.deleted',
        now,
        {
          worksheetId: mapping.worksheetId,
          name: mapping.name,
        },
      );
    });
  }
}

function isMember(actorId: string) {
  return Prisma.sql`
    EXISTS (
      SELECT 1
      FROM estadistica_forms.organization_members om
      WHERE om.organization_id = m.organization_id
        AND om.user_id = ${actorId}
    )
  `;
}

/** El nombre es único en la hoja, sin distinguir mayúsculas ni espacios. */
async function nameTaken(
  tx: Prisma.TransactionClient,
  worksheetId: string,
  name: string,
) {
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id
    FROM estadistica_forms.worksheet_import_mappings
    WHERE worksheet_id = ${worksheetId}
      AND name_normalized = ${normalizeName(name)}
  `);
  return rows.length > 0;
}

/** Solo este repositorio escribe `mapping`; una forma distinta es un error del backend. */
function toImportMapping(row: ImportMappingRow): ImportMapping {
  const parsed = parseMappingTemplate(row.mapping);
  if (!parsed.ok) {
    throw new Error(`La plantilla ${row.id} tiene una forma inválida.`);
  }
  return { ...row, mapping: parsed.template };
}

function audit(
  tx: Prisma.TransactionClient,
  scope: ProjectScope,
  actorId: string,
  mappingId: string,
  action: string,
  now: string,
  details: Readonly<Record<string, unknown>>,
) {
  return recordAuditEvent(tx, {
    organizationId: scope.organizationId,
    actorId,
    action,
    resourceType: 'worksheet_import_mapping',
    resourceId: mappingId,
    details,
    now,
  });
}
