import { Injectable } from '@nestjs/common';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { enqueueArtifactsDelete } from '../outbox/outbox-events.js';
import type { ImportDelimiter } from '../catalog-import/import.types.js';
import type { FeedSchedule } from './feed-schedule.js';
import type { PublicError } from '../common/http/public-error.js';
import type { PageRequest } from '../common/http/pagination.js';
import type {
  DeliveryFile,
  ExportToPublish,
  FeedPolicy,
  FeedSource,
  FeedVersionView,
  FeedView,
  LastRefreshView,
  NewFeed,
  NewFeedVersion,
  PublicationConfirmation,
  PublishedBy,
  RefreshOutcome,
  RefreshStage,
  RefreshStatus,
} from './feeds.types.js';

/** El feed y, si existe, su versión publicada (LEFT JOIN): todo nulo si no. */
type FeedRow = {
  id: string;
  generation: number;
  deliveryEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  sourceUrl: string | null;
  sourceIdColumn: string | null;
  sourceDelimiter: ImportDelimiter | null;
  policyRulesetRevision: number | null;
  policyMaxInvalid: number | null;
  policyMaxExcluded: number | null;
  policyMaxDropPercent: number | null;
  policyEngineVersion: string | null;
  policyProfileVersion: string | null;
  policyApprovedAt: string | null;
  refreshEnabled: boolean;
  refreshTime: string | null;
  timeZone: string | null;
  lastRefreshId: string | null;
  lastRefreshStatus: RefreshStatus | null;
  lastRefreshStage: RefreshStage | null;
  lastRefreshOutcome: RefreshOutcome | null;
  lastRefreshError: PublicError | null;
  lastRefreshScheduledFor: string | null;
  lastRefreshCreatedAt: string | null;
  lastRefreshFinishedAt: string | null;
  versionId: string | null;
  exportId: string | null;
  evaluationId: string | null;
  rowCount: number | null;
  byteSize: number | null;
  tsvChecksum: string | null;
  publishedBy: PublishedBy | null;
  publishedAt: string | null;
};

/** Un feed publicado: la base exige puntero y generación juntos (CHECK de `feeds`). */
type PublishedFeedRow = FeedRow & {
  versionId: string;
  rowCount: number;
  byteSize: number;
  tsvChecksum: string;
  publishedBy: PublishedBy;
  publishedAt: string;
};

type IdRow = { id: string };

type ArtifactKeyRow = { artifactKey: string };

const FEED_COLUMNS = Prisma.sql`
  f.id,
  f.generation,
  f.delivery_token_hash IS NOT NULL AS "deliveryEnabled",
  f.created_at AS "createdAt",
  f.updated_at AS "updatedAt",
  f.source_url AS "sourceUrl",
  f.source_id_column AS "sourceIdColumn",
  f.source_delimiter AS "sourceDelimiter",
  f.policy_ruleset_revision AS "policyRulesetRevision",
  f.policy_max_invalid AS "policyMaxInvalid",
  f.policy_max_excluded AS "policyMaxExcluded",
  f.policy_max_drop_percent AS "policyMaxDropPercent",
  f.policy_engine_version AS "policyEngineVersion",
  f.policy_profile_version AS "policyProfileVersion",
  f.policy_approved_at AS "policyApprovedAt",
  f.refresh_enabled AS "refreshEnabled",
  f.refresh_time AS "refreshTime",
  f.time_zone AS "timeZone",
  lr.id AS "lastRefreshId",
  lr.status AS "lastRefreshStatus",
  lr.stage AS "lastRefreshStage",
  lr.outcome AS "lastRefreshOutcome",
  lr.error AS "lastRefreshError",
  lr.scheduled_for AS "lastRefreshScheduledFor",
  lr.created_at AS "lastRefreshCreatedAt",
  lr.finished_at AS "lastRefreshFinishedAt",
  v.id AS "versionId",
  v.export_id AS "exportId",
  v.evaluation_id AS "evaluationId",
  v.row_count AS "rowCount",
  v.byte_size AS "byteSize",
  v.tsv_checksum AS "tsvChecksum",
  v.published_by AS "publishedBy",
  v.created_at AS "publishedAt"
`;

/** Claves por consulta en la limpieza: el mismo lote que la de exportaciones. */
const ARTIFACT_KEYS_PER_QUERY = 500;

/** Feeds con su versión publicada, filtrados por el propietario del proyecto. */
/**
 * La última actualización se lee con un `LATERAL`: una fila por feed sin
 * agrupar. Es la única lectura de `feed_refreshes` desde este módulo (D12); el
 * de actualizaciones es el que las escribe.
 */
const OWNED_FEEDS = Prisma.sql`
  FROM estadistica_forms.feeds f
  JOIN estadistica_forms.projects p ON p.id = f.project_id
  LEFT JOIN estadistica_forms.feed_versions v
    ON v.feed_id = f.id AND v.id = f.published_version_id
  LEFT JOIN LATERAL (
    SELECT *
    FROM estadistica_forms.feed_refreshes r
    WHERE r.feed_id = f.id
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT 1
  ) lr ON true
`;

/** Columnas de una versión del historial. */
const VERSION_COLUMNS = Prisma.sql`
  v.id,
  v.export_id AS "exportId",
  v.evaluation_id AS "evaluationId",
  v.row_count AS "rowCount",
  v.byte_size AS "byteSize",
  v.tsv_checksum AS "tsvChecksum",
  v.published_by AS "publishedBy",
  v.created_at AS "publishedAt",
  v.id = f.published_version_id AS "current",
  v.artifact_key IS NOT NULL AS "fileRetained"
`;

@Injectable()
export class FeedsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Crear y consultar el feed de un proyecto del propietario.
  // ---------------------------------------------------------------------------

  /**
   * Devuelve `null` si el proyecto ya tiene feed (índice único de `project_id`).
   * El hash del token también es único, pero 256 bits aleatorios no chocan.
   */
  async create(record: NewFeed): Promise<FeedView | null> {
    try {
      // Con la API del modelo, el índice único llega como P2002.
      await this.prisma.feed.create({
        data: {
          id: record.id,
          projectId: record.projectId,
          deliveryTokenHash: record.deliveryTokenHash,
          createdAt: record.createdAt,
          updatedAt: record.createdAt,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return null;
      }
      throw error;
    }
    return requireFeed(this.prisma, record.id);
  }

  /** Como mucho uno: un feed por proyecto. */
  async findAllByOwner(
    ownerId: string,
    projectId: string,
  ): Promise<FeedView[]> {
    const rows = await this.prisma.$queryRaw<FeedRow[]>`
      SELECT ${FEED_COLUMNS}
      ${OWNED_FEEDS}
      WHERE p.id = ${projectId}
        AND p.owner_id = ${ownerId}
      ORDER BY f.created_at, f.id`;
    return rows.map(toFeedView);
  }

  async findByOwner(
    ownerId: string,
    projectId: string,
    feedId: string,
  ): Promise<FeedView | null> {
    const rows = await this.prisma.$queryRaw<FeedRow[]>`
      SELECT ${FEED_COLUMNS}
      ${OWNED_FEEDS}
      WHERE f.id = ${feedId}
        AND p.id = ${projectId}
        AND p.owner_id = ${ownerId}`;
    return rows[0] ? toFeedView(rows[0]) : null;
  }

  /**
   * Historial de versiones del feed, de la más reciente a la más antigua (D12).
   * `window` ya trae una fila de más para saber si hay otra página.
   */
  listVersions(
    feedId: string,
    window: PageRequest,
  ): Promise<FeedVersionView[]> {
    return this.prisma.$queryRaw<FeedVersionView[]>`
      SELECT ${VERSION_COLUMNS}
      FROM estadistica_forms.feed_versions v
      JOIN estadistica_forms.feeds f ON f.id = v.feed_id
      WHERE v.feed_id = ${feedId}
      ORDER BY v.created_at DESC, v.id DESC
      LIMIT ${window.limit} OFFSET ${window.offset}`;
  }

  // ---------------------------------------------------------------------------
  // Publicar una exportación del mismo proyecto.
  // ---------------------------------------------------------------------------

  async findExportToPublish(
    ownerId: string,
    projectId: string,
    exportId: string,
  ): Promise<ExportToPublish | null> {
    const rows = await this.prisma.$queryRaw<ExportToPublish[]>`
      SELECT
        x.id,
        x.evaluation_id AS "evaluationId",
        x.artifact_key AS "artifactKey",
        x.row_count AS "rowCount",
        x.byte_size AS "byteSize",
        x.tsv_checksum AS "tsvChecksum"
      FROM estadistica_forms.exports x
      JOIN estadistica_forms.projects p ON p.id = x.project_id
      WHERE x.id = ${exportId}
        AND p.id = ${projectId}
        AND p.owner_id = ${ownerId}`;
    return rows[0] ?? null;
  }

  /**
   * Guarda la versión y mueve el puntero en una transacción (D6). El archivo ya
   * está enlazado y verificado: queda fuera de la transacción (invariante 5).
   */
  publish(
    record: NewFeedVersion,
    confirm?: PublicationConfirmation,
  ): Promise<FeedView> {
    return this.prisma.$transaction(async (tx) => {
      await lockFeed(tx, record.feedId);
      await lockExport(tx, record);

      await tx.feedVersion.create({
        data: {
          id: record.id,
          feedId: record.feedId,
          evaluationId: record.source.evaluationId,
          exportId: record.source.id,
          artifactKey: record.file.key,
          tsvChecksum: record.file.checksum,
          byteSize: record.file.byteSize,
          rowCount: record.source.rowCount,
          publishedBy: record.publishedBy,
          createdAt: record.createdAt,
        },
      });
      await movePublishedPointer(tx, record);
      await confirm?.(tx);

      return requireFeed(tx, record.feedId);
    });
  }

  /**
   * Retira de la fila los archivos de las versiones antiguas: se conservan el
   * publicado y los más recientes hasta `retained` (D14). Devuelve las claves
   * retiradas para borrar los archivos después del commit; el historial de
   * versiones se queda.
   */
  retireOldFiles(feedId: string, retained: number): Promise<string[]> {
    return this.prisma.$transaction(async (tx) => {
      await lockFeed(tx, feedId);
      const rows = await tx.$queryRaw<ArtifactKeyRow[]>`
        WITH retired AS (
          SELECT v.id, v.artifact_key
          FROM estadistica_forms.feed_versions v
          JOIN estadistica_forms.feeds f ON f.id = v.feed_id
          WHERE v.feed_id = ${feedId}
            AND v.artifact_key IS NOT NULL
            AND v.id IS DISTINCT FROM f.published_version_id
          ORDER BY v.created_at DESC, v.id DESC
          OFFSET ${retained - 1}
        )
        UPDATE estadistica_forms.feed_versions v
        SET artifact_key = NULL
        FROM retired
        WHERE v.id = retired.id
        RETURNING retired.artifact_key AS "artifactKey"`;
      const keys = rows.map((row) => row.artifactKey);
      // Los archivos se borran después del commit, desde el outbox (jobs&files, D9).
      await enqueueArtifactsDelete(tx, 'feeds', keys);
      return keys;
    });
  }

  // ---------------------------------------------------------------------------
  // Entrega: el token de la URL pública.
  // ---------------------------------------------------------------------------

  /** Guarda la política aprobada. Devuelve `null` si el feed no es del propietario. */
  async setPolicy(target: {
    ownerId: string;
    projectId: string;
    feedId: string;
    policy: FeedPolicy;
  }): Promise<FeedView | null> {
    const { policy } = target;
    const updated = await this.prisma.$queryRaw<IdRow[]>`
      UPDATE estadistica_forms.feeds f
      SET
        policy_ruleset_revision = ${policy.rulesetRevision},
        policy_max_invalid = ${policy.maxInvalid},
        policy_max_excluded = ${policy.maxExcluded},
        policy_max_drop_percent = ${policy.maxDropPercent},
        policy_engine_version = ${policy.engineVersion},
        policy_profile_version = ${policy.profileVersion},
        policy_approved_at = ${policy.approvedAt},
        updated_at = ${policy.approvedAt}
      FROM estadistica_forms.projects p
      WHERE f.id = ${target.feedId}
        AND p.id = f.project_id
        AND p.id = ${target.projectId}
        AND p.owner_id = ${target.ownerId}
      RETURNING f.id`;
    return updated[0] ? requireFeed(this.prisma, target.feedId) : null;
  }

  /** Guarda la programación diaria. Devuelve `null` si el feed no es del propietario. */
  async setSchedule(target: {
    ownerId: string;
    projectId: string;
    feedId: string;
    schedule: FeedSchedule;
    updatedAt: string;
  }): Promise<FeedView | null> {
    const updated = await this.prisma.$queryRaw<IdRow[]>`
      UPDATE estadistica_forms.feeds f
      SET
        refresh_enabled = ${target.schedule.enabled},
        refresh_time = ${target.schedule.refreshTime},
        time_zone = ${target.schedule.timeZone},
        updated_at = ${target.updatedAt}
      FROM estadistica_forms.projects p
      WHERE f.id = ${target.feedId}
        AND p.id = f.project_id
        AND p.id = ${target.projectId}
        AND p.owner_id = ${target.ownerId}
      RETURNING f.id`;
    return updated[0] ? requireFeed(this.prisma, target.feedId) : null;
  }

  /** La revisión de reglas existe en el proyecto (la política la referencia). */
  async rulesetRevisionExists(projectId: string, revision: number) {
    const rows = await this.prisma.$queryRaw<IdRow[]>`
      SELECT id
      FROM estadistica_forms.ruleset_versions
      WHERE project_id = ${projectId}
        AND revision = ${revision}`;
    return rows.length === 1;
  }

  /** Guarda la fuente remota. Devuelve `null` si el feed no es del propietario. */
  async setSource(target: {
    ownerId: string;
    projectId: string;
    feedId: string;
    source: FeedSource;
    updatedAt: string;
  }): Promise<FeedView | null> {
    const updated = await this.prisma.$queryRaw<IdRow[]>`
      UPDATE estadistica_forms.feeds f
      SET
        source_url = ${target.source.url},
        source_id_column = ${target.source.idColumn},
        source_delimiter = ${target.source.delimiter},
        updated_at = ${target.updatedAt}
      FROM estadistica_forms.projects p
      WHERE f.id = ${target.feedId}
        AND p.id = f.project_id
        AND p.id = ${target.projectId}
        AND p.owner_id = ${target.ownerId}
      RETURNING f.id`;
    return updated[0] ? requireFeed(this.prisma, target.feedId) : null;
  }

  /**
   * Guarda el hash de un token nuevo (el anterior deja de valer) o, con `null`,
   * desactiva la entrega. Devuelve `null` si el feed no es del propietario.
   */
  async setDeliveryTokenHash(target: {
    ownerId: string;
    projectId: string;
    feedId: string;
    tokenHash: string | null;
    updatedAt: string;
  }): Promise<FeedView | null> {
    const updated = await this.prisma.$queryRaw<IdRow[]>`
      UPDATE estadistica_forms.feeds f
      SET
        delivery_token_hash = ${target.tokenHash},
        updated_at = ${target.updatedAt}
      FROM estadistica_forms.projects p
      WHERE f.id = ${target.feedId}
        AND p.id = f.project_id
        AND p.id = ${target.projectId}
        AND p.owner_id = ${target.ownerId}
      RETURNING f.id`;
    return updated[0] ? requireFeed(this.prisma, target.feedId) : null;
  }

  /**
   * El archivo publicado del feed cuyo token tiene este hash. `null` si no hay
   * feed con ese token (inexistente o rotado), la entrega está desactivada o
   * todavía no se publicó nada: la URL pública responde igual en los tres casos.
   */
  async findDeliveryFile(tokenHash: string): Promise<DeliveryFile | null> {
    const rows = await this.prisma.$queryRaw<DeliveryFile[]>`
      SELECT
        f.id AS "feedId",
        v.artifact_key AS "artifactKey",
        v.byte_size AS "byteSize",
        v.tsv_checksum AS "tsvChecksum"
      FROM estadistica_forms.feeds f
      JOIN estadistica_forms.feed_versions v
        ON v.feed_id = f.id AND v.id = f.published_version_id
      WHERE f.delivery_token_hash = ${tokenHash}`;
    return rows[0] ?? null;
  }

  // ---------------------------------------------------------------------------
  // Limpieza de huérfanos al arrancar.
  // ---------------------------------------------------------------------------

  /** De las claves dadas, las que todavía usa alguna versión. */
  async findReferencedArtifactKeys(keys: string[]): Promise<Set<string>> {
    const referenced = new Set<string>();
    for (let start = 0; start < keys.length; start += ARTIFACT_KEYS_PER_QUERY) {
      const chunk = keys.slice(start, start + ARTIFACT_KEYS_PER_QUERY);
      const rows = await this.prisma.$queryRaw<ArtifactKeyRow[]>`
        SELECT artifact_key AS "artifactKey"
        FROM estadistica_forms.feed_versions
        WHERE artifact_key IN (${Prisma.join(chunk)})`;
      for (const row of rows) {
        referenced.add(row.artifactKey);
      }
    }
    return referenced;
  }
}

/**
 * FOR UPDATE: dos publicaciones del mismo feed se esperan en lugar de chocar al
 * insertar. Si el proyecto se borró entretanto, el feed ya no está.
 */
async function lockFeed(tx: Prisma.TransactionClient, feedId: string) {
  const rows = await tx.$queryRaw<IdRow[]>`
    SELECT id
    FROM estadistica_forms.feeds
    WHERE id = ${feedId}
    FOR UPDATE`;
  if (!rows[0]) {
    throw apiError(ErrorCodes.FEED_NOT_FOUND);
  }
}

/**
 * FOR SHARE sobre la exportación: borrar su importación la borra en cascada y
 * tiene que esperar a que la versión quede guardada, o esta lectura espera y ya
 * no la encuentra. La versión no depende de ella después (D5).
 */
async function lockExport(
  tx: Prisma.TransactionClient,
  record: NewFeedVersion,
) {
  const rows = await tx.$queryRaw<IdRow[]>`
    SELECT id
    FROM estadistica_forms.exports
    WHERE id = ${record.source.id}
      AND project_id = ${record.projectId}
    FOR SHARE`;
  if (!rows[0]) {
    throw apiError(ErrorCodes.EXPORT_NOT_FOUND);
  }
}

/**
 * Concurrencia optimista (RC1, F18): el puntero solo se mueve si la generación
 * sigue siendo la que vio el operador, y sube en la misma sentencia. Si no
 * cambia ninguna fila, alguien publicó antes y la transacción se deshace, con la
 * versión recién insertada.
 */
async function movePublishedPointer(
  tx: Prisma.TransactionClient,
  record: NewFeedVersion,
) {
  const updated = await tx.$queryRaw<IdRow[]>`
    UPDATE estadistica_forms.feeds
    SET
      generation = generation + 1,
      published_version_id = ${record.id},
      updated_at = ${record.createdAt}
    WHERE id = ${record.feedId}
      AND generation = ${record.expectedGeneration}
    RETURNING id`;
  if (!updated[0]) {
    throw apiError(ErrorCodes.FEED_GENERATION_CONFLICT);
  }
}

/** Solo se llama con un feed que acaba de crearse o de publicarse. */
async function requireFeed(client: Prisma.TransactionClient, feedId: string) {
  const rows = await client.$queryRaw<FeedRow[]>`
    SELECT ${FEED_COLUMNS}
    ${OWNED_FEEDS}
    WHERE f.id = ${feedId}`;
  if (!rows[0]) {
    throw new Error('El feed recién guardado no se encuentra.');
  }
  return toFeedView(rows[0]);
}

function toFeedView(row: FeedRow): FeedView {
  return {
    id: row.id,
    generation: row.generation,
    deliveryEnabled: row.deliveryEnabled,
    publishedVersion: hasPublishedVersion(row) ? toPublishedVersion(row) : null,
    source: toSource(row),
    policy: toPolicy(row),
    schedule: toSchedule(row),
    lastRefresh: toLastRefresh(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** La base exige las tres columnas de la fuente juntas o ninguna. */
function toSource(row: FeedRow): FeedSource | null {
  if (
    row.sourceUrl === null ||
    row.sourceIdColumn === null ||
    row.sourceDelimiter === null
  ) {
    return null;
  }
  return {
    url: row.sourceUrl,
    idColumn: row.sourceIdColumn,
    delimiter: row.sourceDelimiter,
  };
}

/** Sin actualizaciones, todas las columnas de `lr` llegan nulas. */
function toLastRefresh(row: FeedRow): LastRefreshView | null {
  if (
    row.lastRefreshId === null ||
    row.lastRefreshStatus === null ||
    row.lastRefreshStage === null ||
    row.lastRefreshCreatedAt === null
  ) {
    return null;
  }
  return {
    id: row.lastRefreshId,
    status: row.lastRefreshStatus,
    stage: row.lastRefreshStage,
    outcome: row.lastRefreshOutcome,
    error: row.lastRefreshError,
    scheduledFor: row.lastRefreshScheduledFor,
    createdAt: row.lastRefreshCreatedAt,
    finishedAt: row.lastRefreshFinishedAt,
  };
}

/** Hora y zona van juntas (CHECK de `feeds`); sin ellas, nunca se configuró. */
function toSchedule(row: FeedRow): FeedSchedule | null {
  if (row.refreshTime === null || row.timeZone === null) {
    return null;
  }
  return {
    enabled: row.refreshEnabled,
    refreshTime: row.refreshTime,
    timeZone: row.timeZone,
  };
}

/** La base exige las columnas de la política juntas o ninguna. */
function toPolicy(row: FeedRow): FeedPolicy | null {
  if (
    row.policyRulesetRevision === null ||
    row.policyMaxInvalid === null ||
    row.policyMaxExcluded === null ||
    row.policyMaxDropPercent === null ||
    row.policyEngineVersion === null ||
    row.policyProfileVersion === null ||
    row.policyApprovedAt === null
  ) {
    return null;
  }
  return {
    rulesetRevision: row.policyRulesetRevision,
    maxInvalid: row.policyMaxInvalid,
    maxExcluded: row.policyMaxExcluded,
    maxDropPercent: row.policyMaxDropPercent,
    engineVersion: row.policyEngineVersion,
    profileVersion: row.policyProfileVersion,
    approvedAt: row.policyApprovedAt,
  };
}

/** Sin publicar, todas las columnas de la versión llegan nulas. */
function hasPublishedVersion(row: FeedRow): row is PublishedFeedRow {
  return (
    row.versionId !== null &&
    row.rowCount !== null &&
    row.byteSize !== null &&
    row.tsvChecksum !== null &&
    row.publishedBy !== null &&
    row.publishedAt !== null
  );
}

function toPublishedVersion(row: PublishedFeedRow) {
  return {
    id: row.versionId,
    exportId: row.exportId,
    evaluationId: row.evaluationId,
    rowCount: row.rowCount,
    byteSize: row.byteSize,
    tsvChecksum: row.tsvChecksum,
    publishedBy: row.publishedBy,
    publishedAt: row.publishedAt,
  };
}

function isUniqueViolation(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
