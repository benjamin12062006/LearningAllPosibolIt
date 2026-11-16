import { Injectable } from '@nestjs/common';
import type { PageRequest } from '../common/http/pagination.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { RowAtBothRevisions } from './revision-comparison.js';
import { findColumnsIn } from './worksheets.repository.js';
import type { ProjectScope, WorksheetColumn } from './worksheets.types.js';

/** Revisión que se lee: su número fija las filas y su esquema, las columnas. */
export type ReadableRevision = Readonly<{
  id: string;
  sequence: number;
  schemaVersion: number;
}>;

export type StoredRow = Readonly<{
  rowId: string;
  cellValues: Record<string, unknown>;
}>;

export type RowsAtRevision = Readonly<{
  scope: ProjectScope;
  worksheetId: string;
  sequence: number;
  where: Prisma.Sql;
  order: Prisma.Sql;
  page: PageRequest;
}>;

export type RowsBetweenRevisions = Readonly<{
  scope: ProjectScope;
  worksheetId: string;
  fromSequence: number;
  toSequence: number;
}>;

/** Todas las filas de una revisión que cumplen la consulta, leídas por páginas. */
export type AllRowsAtRevision = Omit<RowsAtRevision, 'page'> &
  Readonly<{ pageSize: number }>;

/**
 * Lecturas de filas por revisión (E3.2). Como en el resto del módulo, cada
 * consulta filtra por organización, proyecto y membresía de quien pregunta.
 */
@Injectable()
export class WorksheetRowsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * La revisión pedida o, sin ID, la actual. `null` si no es de esta hoja o la
   * hoja no está al alcance del usuario.
   */
  async findRevision(
    actorId: string,
    scope: ProjectScope,
    worksheetId: string,
    revisionId: string | null,
  ): Promise<ReadableRevision | null> {
    const revision = revisionId
      ? Prisma.sql`r.id = ${revisionId}`
      : Prisma.sql`r.id = w.head_revision_id`;
    const rows = await this.prisma.$queryRaw<ReadableRevision[]>(Prisma.sql`
      SELECT
        r.id,
        r.sequence,
        r.schema_version AS "schemaVersion"
      FROM estadistica_forms.worksheets w
      JOIN estadistica_forms.worksheet_revisions r ON r.worksheet_id = w.id
      WHERE w.id = ${worksheetId}
        AND w.organization_id = ${scope.organizationId}
        AND w.project_id = ${scope.projectId}
        AND ${revision}
        AND EXISTS (
          SELECT 1
          FROM estadistica_forms.organization_members m
          WHERE m.organization_id = w.organization_id
            AND m.user_id = ${actorId}
        )
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

  /**
   * Filas vivas en la revisión: versiones con `from <= N < to` que no son
   * tombstones (H8, H9).
   */
  /**
   * Las filas por páginas, para quien las recorre todas (exportar, llevar al
   * catálogo) sin tenerlas en memoria a la vez. `order` debe ser total (el de
   * `orderSql`): las versiones de fila de una revisión no cambian, así que
   * paginar por desplazamiento no salta ni repite filas.
   */
  async *pagesAt(
    request: AllRowsAtRevision,
  ): AsyncGenerator<readonly StoredRow[]> {
    const { pageSize: limit, ...rows } = request;
    for (let offset = 0; ; offset += limit) {
      const page = await this.findRows({ ...rows, page: { limit, offset } });
      if (page.length > 0) {
        yield page;
      }
      if (page.length < limit) {
        return;
      }
    }
  }

  /**
   * Cada fila que tuvo una versión nueva entre las dos revisiones, con su
   * estado en una y en otra (`null` si no vivía). Toda escritura de fila,
   * también un borrado, abre una versión con `from_sequence` en ese tramo:
   * por eso basta buscar ahí. Sirve en los dos sentidos.
   */
  async findRowsChangedBetween(
    request: RowsBetweenRevisions,
  ): Promise<RowAtBothRevisions[]> {
    const { scope, worksheetId, fromSequence, toSequence } = request;
    const lower = Math.min(fromSequence, toSequence);
    const upper = Math.max(fromSequence, toSequence);
    return this.prisma.$queryRaw<RowAtBothRevisions[]>(Prisma.sql`
      WITH changed AS (
        SELECT DISTINCT v.row_id
        FROM estadistica_forms.worksheet_row_versions v
        WHERE v.worksheet_id = ${worksheetId}
          AND v.organization_id = ${scope.organizationId}
          AND v.from_sequence > ${lower}
          AND v.from_sequence <= ${upper}
      )
      SELECT
        c.row_id AS "rowId",
        b.cell_values AS "before",
        a.cell_values AS "after"
      FROM changed c
      LEFT JOIN estadistica_forms.worksheet_row_versions b
        ON ${liveVersionAt('b', worksheetId, fromSequence)}
      LEFT JOIN estadistica_forms.worksheet_row_versions a
        ON ${liveVersionAt('a', worksheetId, toSequence)}
      ORDER BY COALESCE(a.sort_key, b.sort_key), c.row_id
    `);
  }

  async findRows(request: RowsAtRevision): Promise<StoredRow[]> {
    return this.prisma.$queryRaw<StoredRow[]>(Prisma.sql`
      SELECT
        r.row_id AS "rowId",
        r.cell_values AS "cellValues"
      FROM estadistica_forms.worksheet_row_versions r
      WHERE r.worksheet_id = ${request.worksheetId}
        AND r.organization_id = ${request.scope.organizationId}
        AND r.from_sequence <= ${request.sequence}
        AND (r.to_sequence IS NULL OR r.to_sequence > ${request.sequence})
        AND NOT r.is_deleted
        AND ${request.where}
      ORDER BY ${request.order}
      LIMIT ${request.page.limit} OFFSET ${request.page.offset}
    `);
  }
}

/**
 * La versión viva de la fila de `changed` en una revisión, con el mismo
 * criterio que `findRows`. `alias` es siempre una letra fija de esta consulta.
 */
function liveVersionAt(
  alias: 'a' | 'b',
  worksheetId: string,
  sequence: number,
) {
  const v = Prisma.raw(alias);
  return Prisma.sql`
    ${v}.worksheet_id = ${worksheetId}
    AND ${v}.row_id = c.row_id
    AND ${v}.from_sequence <= ${sequence}
    AND (${v}.to_sequence IS NULL OR ${v}.to_sequence > ${sequence})
    AND NOT ${v}.is_deleted
  `;
}
