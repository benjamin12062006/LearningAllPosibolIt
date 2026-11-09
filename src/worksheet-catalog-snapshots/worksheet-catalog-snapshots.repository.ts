import { Injectable } from '@nestjs/common';
import { recordAuditEvent } from '../audit/audit-trail.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { OrganizationRole } from '../organizations/organization-roles.js';
import type { ProjectScope } from '../worksheets/worksheets.types.js';
import type { WorksheetCatalogSnapshot } from './worksheet-catalog-snapshots.types.js';

/** Lo que decide si alguien puede llevar esta hoja al catálogo (D23). */
export type CatalogSourceAccess = Readonly<{
  role: OrganizationRole;
  isArchived: boolean;
  worksheetName: string;
}>;

const SNAPSHOT_COLUMNS = Prisma.sql`
  c.snapshot_id AS "snapshotId",
  c.worksheet_id AS "worksheetId",
  c.revision_id AS "revisionId",
  c.revision_sequence AS "revisionSequence",
  c.created_by AS "createdBy",
  c.id_column_id AS "idColumnId",
  c.columns,
  c.query,
  c.serializer_version AS "serializerVersion",
  c.row_count AS "rowCount",
  c.source_hash AS "sourceHash",
  c.created_at AS "createdAt"
`;

/**
 * Procedencia de los snapshots creados desde hojas (E5.4). El snapshot, su
 * trabajo y sus filas son de `catalog-import`: aquí solo se guarda de dónde
 * salió, dentro de la transacción en la que se acepta (D22, D27).
 */
@Injectable()
export class WorksheetCatalogSnapshotsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * El papel de quien pregunta en la organización de la hoja, si está
   * archivada y el nombre de la hoja. `null` si la hoja no existe en este
   * proyecto o quien pregunta no es miembro.
   */
  async findAccess(
    actorId: string,
    scope: ProjectScope,
    worksheetId: string,
  ): Promise<CatalogSourceAccess | null> {
    const rows = await this.prisma.$queryRaw<CatalogSourceAccess[]>(Prisma.sql`
      SELECT
        m.role,
        o.archived_at IS NOT NULL AS "isArchived",
        w.name AS "worksheetName"
      FROM estadistica_forms.worksheets w
      JOIN estadistica_forms.projects p
        ON p.id = w.project_id AND p.organization_id = w.organization_id
      JOIN estadistica_forms.organizations o ON o.id = w.organization_id
      JOIN estadistica_forms.organization_members m
        ON m.organization_id = w.organization_id AND m.user_id = ${actorId}
      WHERE w.id = ${worksheetId}
        AND w.organization_id = ${scope.organizationId}
        AND w.project_id = ${scope.projectId}
    `);
    return rows[0] ?? null;
  }

  /**
   * La procedencia y su evento de auditoría, en la transacción de `accept`: el
   * snapshot ya está insertado y la clave foránea comprueba que es de este
   * proyecto.
   */
  async insert(
    tx: Prisma.TransactionClient,
    actorId: string,
    scope: ProjectScope,
    record: WorksheetCatalogSnapshot,
  ) {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO estadistica_forms.worksheet_catalog_snapshots
        (snapshot_id, project_id, organization_id, worksheet_id, revision_id,
         revision_sequence, created_by, id_column_id, columns, query,
         serializer_version, row_count, source_hash, created_at)
      VALUES (
        ${record.snapshotId}, ${scope.projectId}, ${scope.organizationId},
        ${record.worksheetId}, ${record.revisionId}, ${record.revisionSequence},
        ${actorId}, ${record.idColumnId},
        ${JSON.stringify(record.columns)}::jsonb,
        ${JSON.stringify(record.query)}::jsonb,
        ${record.serializerVersion}, ${record.rowCount}, ${record.sourceHash},
        ${record.createdAt}
      )
    `);
    await recordAuditEvent(tx, {
      organizationId: scope.organizationId,
      actorId,
      action: 'worksheet.catalog_snapshot.created',
      resourceType: 'catalog_snapshot',
      resourceId: record.snapshotId,
      details: {
        worksheetId: record.worksheetId,
        revisionId: record.revisionId,
        sourceHash: record.sourceHash,
      },
      now: record.createdAt,
    });
  }

  /** Lo ve cualquier miembro de la organización; lo ajeno no se distingue de lo inexistente. */
  async find(
    actorId: string,
    scope: ProjectScope,
    snapshotId: string,
  ): Promise<WorksheetCatalogSnapshot | null> {
    const rows = await this.prisma.$queryRaw<WorksheetCatalogSnapshot[]>(
      Prisma.sql`
        SELECT ${SNAPSHOT_COLUMNS}
        FROM estadistica_forms.worksheet_catalog_snapshots c
        WHERE c.snapshot_id = ${snapshotId}
          AND c.organization_id = ${scope.organizationId}
          AND c.project_id = ${scope.projectId}
          AND EXISTS (
            SELECT 1
            FROM estadistica_forms.organization_members m
            WHERE m.organization_id = c.organization_id
              AND m.user_id = ${actorId}
          )
      `,
    );
    return rows[0] ?? null;
  }
}
