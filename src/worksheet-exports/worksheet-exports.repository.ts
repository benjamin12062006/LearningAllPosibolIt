import { Injectable } from '@nestjs/common';
import { recordAuditEvent } from '../audit/audit-trail.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { ProjectScope } from '../worksheets/worksheets.types.js';
import type { WorksheetExport } from './worksheet-exports.types.js';

/** La revisión que se exporta y el nombre de su hoja, que da nombre a la hoja del XLSX. */
export type RevisionToExport = Readonly<{
  id: string;
  sequence: number;
  schemaVersion: number;
  worksheetName: string;
}>;

/** Una exportación lista para guardar: el archivo ya está escrito y verificado. */
export type NewWorksheetExport = Omit<WorksheetExport, 'createdAt'> &
  Readonly<{ artifactKey: string }>;

/** El archivo de una exportación: solo lo ve el servidor. */
export type WorksheetExportFile = Readonly<{
  format: WorksheetExport['format'];
  artifactKey: string;
  byteSize: number;
}>;

const EXPORT_COLUMNS = Prisma.sql`
  x.id,
  x.worksheet_id AS "worksheetId",
  x.revision_id AS "revisionId",
  x.revision_sequence AS "revisionSequence",
  x.created_by AS "createdBy",
  x.format,
  x.options,
  x.query,
  x.serializer_version AS "serializerVersion",
  x.row_count AS "rowCount",
  x.column_count AS "columnCount",
  x.problem_cell_count AS "problemCellCount",
  x.byte_size AS "byteSize",
  x.checksum,
  x.created_at AS "createdAt"
`;

/** Claves por consulta en la limpieza: el mismo lote que las otras limpiezas. */
const ARTIFACT_KEYS_PER_QUERY = 500;

/**
 * Exportaciones de hojas (E5.3). Como en el resto de hojas, cada lectura
 * filtra por organización, proyecto y membresía de quien pregunta: lo ajeno no
 * se distingue de lo inexistente.
 */
@Injectable()
export class WorksheetExportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** La revisión pedida o, sin ID, la actual; `null` si no es de esta hoja o es ajena. */
  async findRevision(
    actorId: string,
    scope: ProjectScope,
    worksheetId: string,
    revisionId: string | null,
  ): Promise<RevisionToExport | null> {
    const revision = revisionId
      ? Prisma.sql`r.id = ${revisionId}`
      : Prisma.sql`r.id = w.head_revision_id`;
    const rows = await this.prisma.$queryRaw<RevisionToExport[]>(Prisma.sql`
      SELECT
        r.id,
        r.sequence,
        r.schema_version AS "schemaVersion",
        w.name AS "worksheetName"
      FROM estadistica_forms.worksheets w
      JOIN estadistica_forms.worksheet_revisions r ON r.worksheet_id = w.id
      WHERE w.id = ${worksheetId}
        AND w.organization_id = ${scope.organizationId}
        AND w.project_id = ${scope.projectId}
        AND ${revision}
        AND ${isMember(actorId, Prisma.sql`w.organization_id`)}
    `);
    return rows[0] ?? null;
  }

  /**
   * La exportación y su evento de auditoría, juntos (D20). Exportar es una
   * lectura: no bloquea la organización ni exige permiso de escritura, y la
   * clave foránea de la revisión asegura que sigue siendo de esa hoja.
   */
  async insert(
    actorId: string,
    scope: ProjectScope,
    record: NewWorksheetExport,
  ): Promise<WorksheetExport> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date().toISOString();
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO estadistica_forms.worksheet_exports
          (id, organization_id, project_id, worksheet_id, revision_id,
           revision_sequence, created_by, format, options, query,
           serializer_version, row_count, column_count, problem_cell_count,
           byte_size, checksum, artifact_key, created_at)
        VALUES (
          ${record.id}, ${scope.organizationId}, ${scope.projectId},
          ${record.worksheetId}, ${record.revisionId}, ${record.revisionSequence},
          ${actorId}, ${record.format},
          ${JSON.stringify(record.options)}::jsonb,
          ${JSON.stringify(record.query)}::jsonb,
          ${record.serializerVersion}, ${record.rowCount}, ${record.columnCount},
          ${record.problemCellCount}, ${record.byteSize}, ${record.checksum},
          ${record.artifactKey}, ${now}
        )
      `);
      await recordAuditEvent(tx, {
        organizationId: scope.organizationId,
        actorId,
        action: 'worksheet.export.created',
        resourceType: 'worksheet_export',
        resourceId: record.id,
        details: {
          worksheetId: record.worksheetId,
          revisionId: record.revisionId,
          format: record.format,
          checksum: record.checksum,
        },
        now,
      });

      const created = await findExportIn(tx, actorId, scope, record.id);
      if (!created) {
        throw apiError(ErrorCodes.INTERNAL_ERROR);
      }
      return created;
    });
  }

  find(
    actorId: string,
    scope: ProjectScope,
    exportId: string,
  ): Promise<WorksheetExport | null> {
    return findExportIn(this.prisma, actorId, scope, exportId);
  }

  async findFile(
    actorId: string,
    scope: ProjectScope,
    exportId: string,
  ): Promise<WorksheetExportFile | null> {
    const rows = await this.prisma.$queryRaw<WorksheetExportFile[]>(Prisma.sql`
      SELECT
        x.format,
        x.artifact_key AS "artifactKey",
        x.byte_size AS "byteSize"
      FROM estadistica_forms.worksheet_exports x
      WHERE ${isVisibleExport(actorId, scope, exportId)}
    `);
    return rows[0] ?? null;
  }

  /** De las claves dadas, las que alguna exportación sigue usando. */
  async findReferencedArtifactKeys(keys: string[]): Promise<Set<string>> {
    const referenced = new Set<string>();
    for (let start = 0; start < keys.length; start += ARTIFACT_KEYS_PER_QUERY) {
      const batch = keys.slice(start, start + ARTIFACT_KEYS_PER_QUERY);
      const rows = await this.prisma.$queryRaw<{ artifactKey: string }[]>(
        Prisma.sql`
          SELECT artifact_key AS "artifactKey"
          FROM estadistica_forms.worksheet_exports
          WHERE artifact_key IN (${Prisma.join(batch)})
        `,
      );
      for (const row of rows) {
        referenced.add(row.artifactKey);
      }
    }
    return referenced;
  }
}

async function findExportIn(
  client: Prisma.TransactionClient,
  actorId: string,
  scope: ProjectScope,
  exportId: string,
): Promise<WorksheetExport | null> {
  const rows = await client.$queryRaw<WorksheetExport[]>(Prisma.sql`
    SELECT ${EXPORT_COLUMNS}
    FROM estadistica_forms.worksheet_exports x
    WHERE ${isVisibleExport(actorId, scope, exportId)}
  `);
  return rows[0] ?? null;
}

function isVisibleExport(
  actorId: string,
  scope: ProjectScope,
  exportId: string,
) {
  return Prisma.sql`
    x.id = ${exportId}
    AND x.organization_id = ${scope.organizationId}
    AND x.project_id = ${scope.projectId}
    AND ${isMember(actorId, Prisma.sql`x.organization_id`)}
  `;
}

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
