import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type {
  CurrentSource,
  SourceKey,
  SyncedSource,
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
        o.name, o.archived_at IS NOT NULL
      )::text) AS fingerprint
    FROM chosen_projects cp
    JOIN estadistica_forms.organizations o ON o.id = cp.organization_id
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
 * Lecturas del conocimiento (plan E6, D14). Lee las tablas de proyectos,
 * catálogo, evaluaciones, reglas y feeds con su propio SQL, como `exports` lee
 * las de evaluaciones: ninguno de esos módulos depende de este.
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

  /** Olvidar un proyecto: la pasada siguiente lo manda entero (reindexar). */
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
