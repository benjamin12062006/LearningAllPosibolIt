import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { recordAuditEvent } from '../audit/audit-trail.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import type {
  Operation,
  RowValues,
} from '../changesets/changeset-operations.js';
import {
  insertDraft,
  readChangeset,
} from '../changesets/changesets.repository.js';
import type {
  Changeset,
  RevisionPointer,
} from '../changesets/changesets.types.js';
import { PrismaService } from '../database/prisma.service.js';
import { LONG_TRANSACTION } from '../database/transaction-timeouts.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  findColumnsIn,
  lockProjectFor,
} from '../worksheets/worksheets.repository.js';
import type {
  ProjectScope,
  WorksheetColumn,
} from '../worksheets/worksheets.types.js';
import type { WorksheetImport } from './worksheet-imports.types.js';

const IMPORT_COLUMNS = Prisma.sql`
  i.id,
  i.worksheet_id AS "worksheetId",
  i.changeset_id AS "changesetId",
  i.created_by AS "createdBy",
  i.format,
  i.file_hash AS "fileHash",
  i.file_bytes AS "fileBytes",
  i.options,
  i.report,
  i.excluded_rows AS "excludedRows",
  i.included_hash AS "includedHash",
  i.created_at AS "createdAt"
`;

export type NewImport = Readonly<{
  worksheetId: string;
  head: RevisionPointer;
  title: string;
  operations: readonly Operation[];
  record: Omit<
    WorksheetImport,
    'id' | 'worksheetId' | 'changesetId' | 'createdBy' | 'createdAt'
  >;
}>;

/** Importaciones de CSV a borradores de hoja (E5.1). */
@Injectable()
export class WorksheetImportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Revisión actual de una hoja del ámbito; `null` si no existe o es ajena. */
  async findHead(
    actorId: string,
    scope: ProjectScope,
    worksheetId: string,
  ): Promise<RevisionPointer | null> {
    const rows = await this.prisma.$queryRaw<RevisionPointer[]>(Prisma.sql`
      SELECT
        r.id,
        r.sequence,
        r.schema_version AS "schemaVersion",
        r.row_count AS "rowCount"
      FROM estadistica_forms.worksheets w
      JOIN estadistica_forms.worksheet_revisions r
        ON r.worksheet_id = w.id AND r.id = w.head_revision_id
      WHERE w.id = ${worksheetId}
        AND w.organization_id = ${scope.organizationId}
        AND w.project_id = ${scope.projectId}
        AND ${isMember(actorId, Prisma.sql`w.organization_id`)}
    `);
    return rows[0] ?? null;
  }

  findColumns(
    scope: ProjectScope,
    worksheetId: string,
    schemaVersion: number,
  ): Promise<WorksheetColumn[]> {
    return findColumnsIn(this.prisma, scope, worksheetId, schemaVersion);
  }

  /** Todas las filas vivas de una revisión (como mucho 5.000), para `upsert`. */
  async findAllRowsAt(
    scope: ProjectScope,
    worksheetId: string,
    sequence: number,
  ): Promise<RowValues> {
    const rows = await this.prisma.$queryRaw<
      { rowId: string; cellValues: Record<string, unknown> }[]
    >(Prisma.sql`
      SELECT row_id AS "rowId", cell_values AS "cellValues"
      FROM estadistica_forms.worksheet_row_versions
      WHERE worksheet_id = ${worksheetId}
        AND organization_id = ${scope.organizationId}
        AND from_sequence <= ${sequence}
        AND (to_sequence IS NULL OR to_sequence > ${sequence})
        AND NOT is_deleted
    `);
    return new Map(rows.map((row) => [row.rowId, row.cellValues]));
  }

  /**
   * La importación, su borrador y su evento de auditoría, en una transacción
   * (D7). Si el head cambió desde que se leyó, 409 y no queda nada.
   */
  async create(
    actorId: string,
    scope: ProjectScope,
    input: NewImport,
  ): Promise<{ import: WorksheetImport; changeset: Changeset }> {
    return this.prisma.$transaction(async (tx) => {
      await lockProjectFor(tx, actorId, scope, 'worksheet.write');
      const changesetId = await insertDraft(tx, actorId, scope, {
        worksheetId: input.worksheetId,
        title: input.title,
        source: 'import',
        base: input.head,
        operations: input.operations,
      });

      const id = randomUUID();
      const now = new Date().toISOString();
      const { record } = input;
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO estadistica_forms.worksheet_imports
          (id, organization_id, project_id, worksheet_id, changeset_id,
           created_by, format, file_hash, file_bytes, options, report,
           excluded_rows, included_hash, created_at)
        VALUES (
          ${id}, ${scope.organizationId}, ${scope.projectId},
          ${input.worksheetId}, ${changesetId}, ${actorId}, ${record.format},
          ${record.fileHash}, ${record.fileBytes},
          ${JSON.stringify(record.options)}::jsonb,
          ${JSON.stringify(record.report)}::jsonb,
          ${JSON.stringify(record.excludedRows)}::jsonb,
          ${record.includedHash}, ${now}
        )
      `);
      await recordAuditEvent(tx, {
        organizationId: scope.organizationId,
        actorId,
        action: 'worksheet.import.created',
        resourceType: 'worksheet_import',
        resourceId: id,
        details: { changesetId, fileHash: record.fileHash },
        now,
      });

      const created = await findImportIn(tx, actorId, scope, id);
      if (!created) {
        throw apiError(ErrorCodes.INTERNAL_ERROR);
      }
      return {
        import: created,
        changeset: await readChangeset(tx, actorId, scope, changesetId),
      };
    }, LONG_TRANSACTION);
  }

  find(
    actorId: string,
    scope: ProjectScope,
    importId: string,
  ): Promise<WorksheetImport | null> {
    return findImportIn(this.prisma, actorId, scope, importId);
  }
}

async function findImportIn(
  client: Prisma.TransactionClient,
  actorId: string,
  scope: ProjectScope,
  importId: string,
): Promise<WorksheetImport | null> {
  const rows = await client.$queryRaw<WorksheetImport[]>(Prisma.sql`
    SELECT ${IMPORT_COLUMNS}
    FROM estadistica_forms.worksheet_imports i
    WHERE i.id = ${importId}
      AND i.organization_id = ${scope.organizationId}
      AND i.project_id = ${scope.projectId}
      AND ${isMember(actorId, Prisma.sql`i.organization_id`)}
  `);
  return rows[0] ?? null;
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
