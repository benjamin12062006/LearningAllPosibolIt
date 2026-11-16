import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { OrganizationRole } from '../organizations/organization-roles.js';
import { orderSql } from '../worksheets/row-query-sql.js';
import type { StoredRow } from '../worksheets/worksheet-rows.repository.js';
import { WORKSHEET_LIMITS } from '../worksheets/worksheet-columns.js';
import { findColumnsIn } from '../worksheets/worksheets.repository.js';
import type { WorksheetColumn } from '../worksheets/worksheets.types.js';
import {
  REINDEX_PENDING,
  type CurrentSource,
  type SourceKey,
  type SyncedSource,
} from './knowledge.types.js';

// -----------------------------------------------------------------------------
// Filas de las lecturas que alimentan los documentos (D18).
// -----------------------------------------------------------------------------

export type ProjectFacts = {
  name: string;
  country: string | null;
  currency: string | null;
  channelProfile: string | null;
  organizationName: string;
  organizationArchived: boolean;
};

export type CatalogFacts = {
  originalName: string;
  idColumn: string;
  rowCount: number;
  importedAt: string;
  /** Fecha de la evaluación usada en las fichas; nula si no hay una del catálogo. */
  evaluatedAt: string | null;
};

export type CatalogProductRow = {
  sourceRow: number;
  externalId: string;
  originalValues: unknown;
  /** Nulos si la última evaluación no es de este catálogo o no terminó. */
  outcome: string | null;
  problems: unknown;
  inFeed: boolean;
};

export type EvaluationFacts = {
  id: string;
  status: string;
  totalCount: number | null;
  validCount: number | null;
  invalidCount: number | null;
  excludedCount: number | null;
  createdAt: string;
  finishedAt: string | null;
  catalogName: string;
  error: unknown;
};

export type ProblemCount = { attribute: string; code: string; count: number };

export type RulesetFacts = {
  revision: number;
  mapping: unknown;
  rules: unknown;
  createdAt: string;
};

export type FeedFacts = {
  generation: number;
  publishedRowCount: number | null;
  publishedAt: string | null;
  publishedBy: string | null;
  hasSource: boolean;
  refreshEnabled: boolean;
  refreshTime: string | null;
  timeZone: string | null;
  policyRulesetRevision: number | null;
  lastRefreshStatus: string | null;
  lastRefreshOutcome: string | null;
  lastRefreshError: unknown;
  lastRefreshAt: string | null;
};

export type OrganizationFacts = {
  name: string;
  archived: boolean;
  projectCount: number;
  memberCounts: Partial<Record<OrganizationRole, number>>;
};

export type WorkbookFacts = {
  name: string;
  archived: boolean;
  worksheets: Array<{ name: string; archived: boolean }>;
};

export type WorksheetFacts = {
  name: string;
  mode: string;
  workbookName: string;
  archived: boolean;
  revisionId: string;
  sequence: number;
  schemaVersion: number;
  rowCount: number;
};

export type ChangesetFacts = {
  title: string;
  worksheetId: string;
  worksheetName: string;
  status: string;
  baseSequence: number;
  operationCounts: Record<string, number>;
  decision: 'accept' | 'reject' | null;
};

export type WorksheetImportFacts = {
  worksheetId: string;
  worksheetName: string;
  format: string;
  createdAt: string;
  rowCount: number;
  insertedCount: number;
  updatedCount: number;
  unchangedCount: number;
  excludedCount: number;
  invalidCount: number;
  newColumnCount: number;
  problemCounts: Record<string, number>;
};

const OPEN_CHANGESETS = Prisma.sql`c.status IN ('draft', 'pending_review', 'approved')`;
const WORKSHEET_KNOWLEDGE_PAGE_SIZE = 100;
type WorksheetPageRow = StoredRow & { sortKey: string };

/**
 * La huella de cada fuente (D15). `json_build_array` y no `concat_ws`: este se
 * salta los nulos y daría la misma huella a `(ES, null)` que a `(null, ES)`.
 * Una pasada sin cambios solo hace esta consulta y la del estado guardado.
 */
function currentSourcesOf(projects: Prisma.Sql) {
  return Prisma.sql`
    WITH chosen_projects AS (
      SELECT
        p.id,
        p.organization_id,
        p.name,
        p.country,
        p.currency,
        p.channel_profile
      FROM estadistica_forms.projects p
      WHERE ${projects}
    ),
    chosen_organizations AS (
      SELECT DISTINCT organization_id FROM chosen_projects
    ),
    organization_summaries AS (
      SELECT
        o.id,
        o.name,
        o.archived_at IS NOT NULL AS archived,
        ${organizationProjectCount()} AS project_count,
        ${organizationMemberCounts()} AS member_counts
      FROM chosen_organizations co
      JOIN estadistica_forms.organizations o ON o.id = co.organization_id
    ),
    chosen_workbooks AS (
      SELECT b.id, b.organization_id, b.project_id, b.name, b.archived_at
      FROM chosen_projects cp
      JOIN estadistica_forms.workbooks b
        ON b.organization_id = cp.organization_id AND b.project_id = cp.id
    ),
    chosen_worksheets AS (
      SELECT
        w.id, w.organization_id, w.project_id, w.workbook_id, w.name, w.mode,
        w.archived_at, w.head_revision_id, b.name AS workbook_name,
        b.archived_at AS workbook_archived_at
      FROM chosen_workbooks b
      JOIN estadistica_forms.worksheets w
        ON w.organization_id = b.organization_id
        AND w.project_id = b.project_id
        AND w.workbook_id = b.id
    ),
    latest_snapshots AS (
      SELECT DISTINCT ON (s.project_id)
        s.project_id,
        s.id
      FROM estadistica_forms.catalog_snapshots s
      JOIN chosen_projects cp ON cp.id = s.project_id
      WHERE s.status = 'ready'
      ORDER BY s.project_id, s.created_at DESC, s.id DESC
    ),
    latest_evaluations AS (
      SELECT DISTINCT ON (e.project_id)
        e.project_id,
        e.id,
        e.status
      FROM estadistica_forms.evaluations e
      JOIN chosen_projects cp ON cp.id = e.project_id
      ORDER BY e.project_id, e.created_at DESC, e.id DESC
    ),
    latest_rulesets AS (
      SELECT
        r.project_id,
        max(r.revision) AS revision
      FROM estadistica_forms.ruleset_versions r
      JOIN chosen_projects cp ON cp.id = r.project_id
      GROUP BY r.project_id
    ),
    project_feeds AS (
      SELECT
        f.project_id,
        f.generation,
        f.updated_at,
        f.published_version_id,
        lr.id AS refresh_id,
        lr.status AS refresh_status
      FROM estadistica_forms.feeds f
      JOIN chosen_projects cp ON cp.id = f.project_id
      LEFT JOIN LATERAL (
        SELECT r.id, r.status
        FROM estadistica_forms.feed_refreshes r
        WHERE r.feed_id = f.id
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT 1
      ) lr ON true
    )
    SELECT
      cp.organization_id AS "organizationId",
      cp.id AS "projectId",
      'project' AS "sourceType",
      cp.id AS "sourceId",
      md5(json_build_array(
        cp.name, cp.country, cp.currency, cp.channel_profile,
        o.name, o.archived
      )::text) AS fingerprint
    FROM chosen_projects cp
    JOIN organization_summaries o ON o.id = cp.organization_id
    UNION ALL
    SELECT
      cp.organization_id,
      cp.id,
      'catalog',
      cp.id,
      md5(json_build_array(
        ls.id, le.id, le.status, pf.published_version_id
      )::text)
    FROM chosen_projects cp
    JOIN latest_snapshots ls ON ls.project_id = cp.id
    LEFT JOIN latest_evaluations le ON le.project_id = cp.id
    LEFT JOIN project_feeds pf ON pf.project_id = cp.id
    UNION ALL
    SELECT
      cp.organization_id,
      cp.id,
      'evaluation',
      cp.id,
      md5(json_build_array(le.id, le.status)::text)
    FROM chosen_projects cp
    JOIN latest_evaluations le ON le.project_id = cp.id
    UNION ALL
    SELECT
      cp.organization_id,
      cp.id,
      'ruleset',
      cp.id,
      md5(json_build_array(lr.revision)::text)
    FROM chosen_projects cp
    JOIN latest_rulesets lr ON lr.project_id = cp.id
    UNION ALL
    SELECT
      cp.organization_id,
      cp.id,
      'feed',
      cp.id,
      md5(json_build_array(
        pf.generation, pf.updated_at, pf.published_version_id,
        pf.refresh_id, pf.refresh_status
      )::text)
    FROM chosen_projects cp
    JOIN project_feeds pf ON pf.project_id = cp.id
    UNION ALL
    SELECT
      cp.organization_id,
      cp.id,
      'organization',
      o.id,
      md5(json_build_array(o.name, o.archived, o.project_count, o.member_counts)::text)
    FROM chosen_projects cp
    JOIN organization_summaries o ON o.id = cp.organization_id
    UNION ALL
    SELECT
      b.organization_id,
      b.project_id,
      'workbook',
      b.id,
      md5(json_build_array(
        b.name, b.archived_at IS NOT NULL, ${workbookWorksheets()}
      )::text)
    FROM chosen_workbooks b
    UNION ALL
    SELECT
      w.organization_id,
      w.project_id,
      'worksheet',
      w.id,
      md5(json_build_array(
        w.name, w.mode, w.workbook_name,
        (w.archived_at IS NOT NULL OR w.workbook_archived_at IS NOT NULL),
        w.head_revision_id
      )::text)
    FROM chosen_worksheets w
    WHERE w.head_revision_id IS NOT NULL
    UNION ALL
    SELECT
      w.organization_id,
      w.project_id,
      'changeset',
      c.id,
      md5(json_build_array(
        w.name, c.title, c.status, c.draft_version, c.base_sequence, d.id
      )::text)
    FROM chosen_worksheets w
    JOIN estadistica_forms.worksheet_changesets c
      ON c.organization_id = w.organization_id
      AND c.project_id = w.project_id
      AND c.worksheet_id = w.id
    LEFT JOIN LATERAL (${currentChangesetDecision()}) d ON true
    WHERE ${OPEN_CHANGESETS}
    UNION ALL
    SELECT
      w.organization_id,
      w.project_id,
      'worksheet_import',
      i.id,
      md5(json_build_array(w.name, i.id)::text)
    FROM chosen_worksheets w
    JOIN LATERAL (${latestWorksheetImport()}) i ON true
    ORDER BY 2, 3, 4`;
}

const SYNCED_COLUMNS = Prisma.sql`
  organization_id AS "organizationId",
  project_id AS "projectId",
  source_type AS "sourceType",
  source_id AS "sourceId",
  fingerprint,
  synced_at AS "syncedAt"
`;

/**
 * Lecturas del conocimiento (plan E6, D14). Lee el estado compartido de los
 * proyectos con su propio SQL, como `exports` lee las evaluaciones.
 */
@Injectable()
export class KnowledgeRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Qué hay y qué se mandó (D15–D16).
  // ---------------------------------------------------------------------------

  findCurrentSources(): Promise<CurrentSource[]> {
    return this.prisma.$queryRaw<CurrentSource[]>(
      currentSourcesOf(Prisma.sql`true`),
    );
  }

  findCurrentSourcesOfProject(projectId: string): Promise<CurrentSource[]> {
    return this.prisma.$queryRaw<CurrentSource[]>(
      currentSourcesOf(Prisma.sql`p.id = ${projectId}`),
    );
  }

  findSyncedSources(): Promise<SyncedSource[]> {
    return this.prisma.$queryRaw<SyncedSource[]>`
      SELECT ${SYNCED_COLUMNS}
      FROM estadistica_forms.knowledge_sync_state
      ORDER BY project_id, source_type, source_id`;
  }

  findSyncedSourcesOfProject(projectId: string): Promise<SyncedSource[]> {
    return this.prisma.$queryRaw<SyncedSource[]>`
      SELECT ${SYNCED_COLUMNS}
      FROM estadistica_forms.knowledge_sync_state
      WHERE project_id = ${projectId}
      ORDER BY source_type, source_id`;
  }

  /** Solo después de que el servicio de IA confirmó (D15). */
  async remember(source: CurrentSource, syncedAt: string): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO estadistica_forms.knowledge_sync_state (
        project_id,
        source_type,
        source_id,
        organization_id,
        fingerprint,
        synced_at
      )
      VALUES (
        ${source.projectId},
        ${source.sourceType},
        ${source.sourceId},
        ${source.organizationId},
        ${source.fingerprint},
        ${syncedAt}
      )
      ON CONFLICT (project_id, source_type, source_id) DO UPDATE
      SET organization_id = EXCLUDED.organization_id,
          fingerprint = EXCLUDED.fingerprint,
          synced_at = EXCLUDED.synced_at`;
  }

  async forgetSource(key: SourceKey): Promise<void> {
    await this.prisma.$executeRaw`
      DELETE FROM estadistica_forms.knowledge_sync_state
      WHERE project_id = ${key.projectId}
        AND source_type = ${key.sourceType}
        AND source_id = ${key.sourceId}`;
  }

  async requestReindex(projectId: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE estadistica_forms.knowledge_sync_state
      SET synced_at = ${REINDEX_PENDING}
      WHERE project_id = ${projectId}`;
  }

  /** Solo tras retirar todo el proyecto del índice. */
  async forgetProject(projectId: string): Promise<void> {
    await this.prisma.$executeRaw`
      DELETE FROM estadistica_forms.knowledge_sync_state
      WHERE project_id = ${projectId}`;
  }

  // ---------------------------------------------------------------------------
  // Datos de cada fuente para escribir sus documentos (D18).
  // ---------------------------------------------------------------------------

  async findProjectFacts(projectId: string): Promise<ProjectFacts | null> {
    const rows = await this.prisma.$queryRaw<ProjectFacts[]>`
      SELECT
        p.name,
        p.country,
        p.currency,
        p.channel_profile AS "channelProfile",
        o.name AS "organizationName",
        o.archived_at IS NOT NULL AS "organizationArchived"
      FROM estadistica_forms.projects p
      JOIN estadistica_forms.organizations o ON o.id = p.organization_id
      WHERE p.id = ${projectId}`;
    return rows[0] ?? null;
  }

  async findCatalogFacts(projectId: string): Promise<CatalogFacts | null> {
    const rows = await this.prisma.$queryRaw<CatalogFacts[]>`
      WITH latest_snapshot AS (
        SELECT s.id, s.original_name, s.id_column, s.row_count, s.created_at
        FROM estadistica_forms.catalog_snapshots s
        WHERE s.project_id = ${projectId}
          AND s.status = 'ready'
        ORDER BY s.created_at DESC, s.id DESC
        LIMIT 1
      )
      SELECT
        ls.original_name AS "originalName",
        ls.id_column AS "idColumn",
        ls.row_count AS "rowCount",
        ls.created_at AS "importedAt",
        ${evaluatedAtOfLatestSnapshot(projectId)} AS "evaluatedAt"
      FROM latest_snapshot ls`;
    return rows[0] ?? null;
  }

  /**
   * Los productos del último catálogo, con el resultado de la última
   * evaluación si es de ese catálogo y terminó, y si están en el feed
   * publicado. «En el feed» se calcula con un JOIN y no un `EXISTS` por fila:
   * con 5.000 productos serían 5.000 búsquedas.
   */
  findCatalogProducts(projectId: string): Promise<CatalogProductRow[]> {
    return this.prisma.$queryRaw<CatalogProductRow[]>`
      WITH latest_snapshot AS (
        SELECT s.id
        FROM estadistica_forms.catalog_snapshots s
        WHERE s.project_id = ${projectId}
          AND s.status = 'ready'
        ORDER BY s.created_at DESC, s.id DESC
        LIMIT 1
      ),
      catalog_evaluation AS (
        SELECT e.id
        FROM estadistica_forms.evaluations e
        JOIN latest_snapshot ls ON ls.id = e.snapshot_id
        WHERE e.status = 'succeeded'
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT 1
      ),
      published_products AS (
        SELECT DISTINCT pr.external_id
        FROM estadistica_forms.feeds f
        JOIN estadistica_forms.feed_versions v ON v.id = f.published_version_id
        JOIN estadistica_forms.evaluation_rows pr ON pr.evaluation_id = v.evaluation_id
        WHERE f.project_id = ${projectId}
          AND pr.outcome = 'valid'
      )
      SELECT
        c.source_row AS "sourceRow",
        c.external_id AS "externalId",
        c.original_values AS "originalValues",
        er.outcome,
        er.problems,
        pp.external_id IS NOT NULL AS "inFeed"
      FROM latest_snapshot ls
      JOIN estadistica_forms.catalog_rows c ON c.snapshot_id = ls.id
      LEFT JOIN catalog_evaluation ce ON true
      LEFT JOIN estadistica_forms.evaluation_rows er
        ON er.evaluation_id = ce.id AND er.source_row = c.source_row
      LEFT JOIN published_products pp ON pp.external_id = c.external_id
      ORDER BY c.source_row`;
  }

  async findLatestEvaluation(
    projectId: string,
  ): Promise<EvaluationFacts | null> {
    const rows = await this.prisma.$queryRaw<EvaluationFacts[]>`
      SELECT
        e.id,
        e.status,
        e.total_count AS "totalCount",
        e.valid_count AS "validCount",
        e.invalid_count AS "invalidCount",
        e.excluded_count AS "excludedCount",
        e.created_at AS "createdAt",
        e.finished_at AS "finishedAt",
        s.original_name AS "catalogName",
        e.error
      FROM estadistica_forms.evaluations e
      JOIN estadistica_forms.catalog_snapshots s ON s.id = e.snapshot_id
      WHERE e.project_id = ${projectId}
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT 1`;
    return rows[0] ?? null;
  }

  /** Los problemas más frecuentes de una evaluación, para su resumen. */
  findProblemCounts(
    evaluationId: string,
    limit: number,
  ): Promise<ProblemCount[]> {
    return this.prisma.$queryRaw<ProblemCount[]>`
      SELECT
        problem->>'attribute' AS attribute,
        problem->>'code' AS code,
        count(*)::int AS count
      FROM estadistica_forms.evaluation_rows r
      CROSS JOIN LATERAL jsonb_array_elements(r.problems) AS problem
      WHERE r.evaluation_id = ${evaluationId}
      GROUP BY 1, 2
      ORDER BY count DESC, code, attribute
      LIMIT ${limit}`;
  }

  async findLatestRuleset(projectId: string): Promise<RulesetFacts | null> {
    const rows = await this.prisma.$queryRaw<RulesetFacts[]>`
      SELECT
        r.revision,
        r.mapping,
        r.rules,
        r.created_at AS "createdAt"
      FROM estadistica_forms.ruleset_versions r
      WHERE r.project_id = ${projectId}
      ORDER BY r.revision DESC
      LIMIT 1`;
    return rows[0] ?? null;
  }

  /** Sin la URL de la fuente ni el token de entrega: pueden llevar secretos. */
  async findFeedFacts(projectId: string): Promise<FeedFacts | null> {
    const rows = await this.prisma.$queryRaw<FeedFacts[]>`
      SELECT
        f.generation,
        v.row_count AS "publishedRowCount",
        v.created_at AS "publishedAt",
        v.published_by AS "publishedBy",
        f.source_url IS NOT NULL AS "hasSource",
        f.refresh_enabled AS "refreshEnabled",
        f.refresh_time AS "refreshTime",
        f.time_zone AS "timeZone",
        f.policy_ruleset_revision AS "policyRulesetRevision",
        lr.status AS "lastRefreshStatus",
        lr.outcome AS "lastRefreshOutcome",
        lr.error AS "lastRefreshError",
        lr.created_at AS "lastRefreshAt"
      FROM estadistica_forms.feeds f
      LEFT JOIN estadistica_forms.feed_versions v ON v.id = f.published_version_id
      LEFT JOIN LATERAL (
        SELECT r.status, r.outcome, r.error, r.created_at
        FROM estadistica_forms.feed_refreshes r
        WHERE r.feed_id = f.id
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT 1
      ) lr ON true
      WHERE f.project_id = ${projectId}`;
    return rows[0] ?? null;
  }

  async findOrganizationFacts(
    scope: SourceKey,
  ): Promise<OrganizationFacts | null> {
    const rows = await this.prisma.$queryRaw<OrganizationFacts[]>`
      SELECT
        o.name,
        o.archived_at IS NOT NULL AS archived,
        ${organizationProjectCount()} AS "projectCount",
        ${organizationMemberCounts()} AS "memberCounts"
      FROM estadistica_forms.organizations o
      JOIN estadistica_forms.projects p ON p.organization_id = o.id
      WHERE o.id = ${scope.sourceId}
        AND o.id = ${scope.organizationId}
        AND p.id = ${scope.projectId}`;
    return rows[0] ?? null;
  }

  async findWorkbookFacts(scope: SourceKey): Promise<WorkbookFacts | null> {
    const rows = await this.prisma.$queryRaw<WorkbookFacts[]>`
      SELECT
        b.name,
        b.archived_at IS NOT NULL AS archived,
        ${workbookWorksheets()} AS worksheets
      FROM estadistica_forms.workbooks b
      WHERE b.id = ${scope.sourceId}
        AND b.organization_id = ${scope.organizationId}
        AND b.project_id = ${scope.projectId}`;
    return rows[0] ?? null;
  }

  async findWorksheetFacts(scope: SourceKey): Promise<WorksheetFacts | null> {
    const rows = await this.prisma.$queryRaw<WorksheetFacts[]>`
      SELECT
        w.name,
        w.mode,
        b.name AS "workbookName",
        w.archived_at IS NOT NULL OR b.archived_at IS NOT NULL AS archived,
        r.id AS "revisionId",
        r.sequence,
        r.schema_version AS "schemaVersion",
        r.row_count AS "rowCount"
      FROM estadistica_forms.worksheets w
      JOIN estadistica_forms.workbooks b
        ON b.organization_id = w.organization_id
        AND b.project_id = w.project_id
        AND b.id = w.workbook_id
      JOIN estadistica_forms.worksheet_revisions r
        ON r.organization_id = w.organization_id
        AND r.worksheet_id = w.id
        AND r.id = w.head_revision_id
      WHERE w.id = ${scope.sourceId}
        AND w.organization_id = ${scope.organizationId}
        AND w.project_id = ${scope.projectId}`;
    return rows[0] ?? null;
  }

  findWorksheetColumns(
    scope: SourceKey,
    schemaVersion: number,
  ): Promise<WorksheetColumn[]> {
    return findColumnsIn(this.prisma, scope, scope.sourceId, schemaVersion);
  }

  /**
   * Fija la secuencia antes de paginar. Las filas de esa revisión siguen
   * siendo las mismas aunque alguien aplique un borrador durante la lectura.
   */
  async *worksheetRowsAt(
    scope: SourceKey,
    sequence: number,
  ): AsyncGenerator<StoredRow> {
    const { rowsPerWorksheet } = WORKSHEET_LIMITS;
    let remaining = rowsPerWorksheet;
    let cursor: WorksheetPageRow | undefined;
    while (remaining > 0) {
      const limit = Math.min(WORKSHEET_KNOWLEDGE_PAGE_SIZE, remaining);
      const after = cursor
        ? Prisma.sql`AND (r.sort_key, r.row_id) > (${cursor.sortKey}, ${cursor.rowId})`
        : Prisma.empty;
      const rows = await this.prisma.$queryRaw<WorksheetPageRow[]>`
        SELECT
          r.row_id AS "rowId",
          r.cell_values AS "cellValues",
          r.sort_key AS "sortKey"
        FROM estadistica_forms.worksheet_row_versions r
        JOIN estadistica_forms.worksheets w
          ON w.organization_id = r.organization_id AND w.id = r.worksheet_id
        WHERE r.worksheet_id = ${scope.sourceId}
          AND r.organization_id = ${scope.organizationId}
          AND w.project_id = ${scope.projectId}
          AND r.from_sequence <= ${sequence}
          AND (r.to_sequence IS NULL OR r.to_sequence > ${sequence})
          AND NOT r.is_deleted
          ${after}
        ORDER BY ${orderSql([])}
        LIMIT ${limit}`;
      yield* rows;
      if (rows.length < limit) {
        return;
      }
      cursor = rows.at(-1);
      remaining -= rows.length;
    }
  }

  async findChangesetFacts(scope: SourceKey): Promise<ChangesetFacts | null> {
    const rows = await this.prisma.$queryRaw<ChangesetFacts[]>`
      SELECT
        c.title,
        w.id AS "worksheetId",
        w.name AS "worksheetName",
        c.status,
        c.base_sequence AS "baseSequence",
        (
          SELECT coalesce(jsonb_object_agg(kind, total), '{}'::jsonb)
          FROM (
            SELECT operation->>'type' AS kind, count(*)::int AS total
            FROM jsonb_array_elements(c.operations) AS operation
            WHERE operation->>'type' IS NOT NULL
            GROUP BY 1
          ) counts
        ) AS "operationCounts",
        d.decision
      FROM estadistica_forms.worksheet_changesets c
      JOIN estadistica_forms.worksheets w
        ON w.organization_id = c.organization_id
        AND w.project_id = c.project_id
        AND w.id = c.worksheet_id
      LEFT JOIN LATERAL (${currentChangesetDecision()}) d ON true
      WHERE c.id = ${scope.sourceId}
        AND c.organization_id = ${scope.organizationId}
        AND c.project_id = ${scope.projectId}
        AND ${OPEN_CHANGESETS}`;
    return rows[0] ?? null;
  }

  async findWorksheetImportFacts(
    scope: SourceKey,
  ): Promise<WorksheetImportFacts | null> {
    const rows = await this.prisma.$queryRaw<WorksheetImportFacts[]>`
      SELECT
        w.id AS "worksheetId",
        w.name AS "worksheetName",
        i.format,
        i.created_at AS "createdAt",
        coalesce((i.report->>'rows')::int, 0) AS "rowCount",
        coalesce((i.report->>'inserted')::int, 0) AS "insertedCount",
        coalesce((i.report->>'updated')::int, 0) AS "updatedCount",
        coalesce((i.report->>'unchanged')::int, 0) AS "unchangedCount",
        jsonb_array_length(i.excluded_rows) AS "excludedCount",
        coalesce((i.report->>'invalid')::int, 0) AS "invalidCount",
        coalesce((i.report->>'newColumns')::int, 0) AS "newColumnCount",
        (
          SELECT coalesce(jsonb_object_agg(code, total), '{}'::jsonb)
          FROM (
            SELECT code, count(*)::int AS total
            FROM jsonb_array_elements(i.excluded_rows) AS excluded
            CROSS JOIN LATERAL jsonb_array_elements_text(excluded->'codes') AS code
            WHERE code IS NOT NULL
            GROUP BY code
          ) counts
        ) AS "problemCounts"
      FROM estadistica_forms.worksheet_imports i
      JOIN estadistica_forms.worksheets w
        ON w.organization_id = i.organization_id
        AND w.project_id = i.project_id
        AND w.id = i.worksheet_id
      WHERE i.id = ${scope.sourceId}
        AND i.organization_id = ${scope.organizationId}
        AND i.project_id = ${scope.projectId}
        AND i.id = (${latestWorksheetImport()})`;
    return rows[0] ?? null;
  }
}

function organizationProjectCount() {
  return Prisma.sql`(
    SELECT count(*)::int
    FROM estadistica_forms.projects p
    WHERE p.organization_id = o.id
  )`;
}

function organizationMemberCounts() {
  return Prisma.sql`(
    SELECT coalesce(jsonb_object_agg(role, total), '{}'::jsonb)
    FROM (
      SELECT m.role, count(*)::int AS total
      FROM estadistica_forms.organization_members m
      WHERE m.organization_id = o.id
      GROUP BY m.role
    ) counts
  )`;
}

function workbookWorksheets() {
  return Prisma.sql`(
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object('name', w.name, 'archived', w.archived_at IS NOT NULL)
        ORDER BY w.name, w.id
      ),
      '[]'::jsonb
    )
    FROM estadistica_forms.worksheets w
    WHERE w.workbook_id = b.id
      AND w.organization_id = b.organization_id
      AND w.project_id = b.project_id
  )`;
}

/** Tras reabrir un borrador, la decisión sobre la versión anterior queda invalidada. */
function currentChangesetDecision() {
  return Prisma.sql`
    SELECT d.id, d.decision
    FROM estadistica_forms.worksheet_changeset_decisions d
    WHERE d.organization_id = c.organization_id
      AND d.changeset_id = c.id
      AND d.draft_version = c.draft_version
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT 1`;
}

function latestWorksheetImport() {
  return Prisma.sql`
    SELECT i.id
    FROM estadistica_forms.worksheet_imports i
    WHERE i.organization_id = w.organization_id
      AND i.project_id = w.project_id
      AND i.worksheet_id = w.id
    ORDER BY i.created_at DESC, i.id DESC
    LIMIT 1`;
}

/** Fecha de la última evaluación terminada del último catálogo, si la hay. */
function evaluatedAtOfLatestSnapshot(projectId: string) {
  return Prisma.sql`(
    SELECT e.finished_at
    FROM estadistica_forms.evaluations e
    WHERE e.project_id = ${projectId}
      AND e.snapshot_id = ls.id
      AND e.status = 'succeeded'
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT 1
  )`;
}
