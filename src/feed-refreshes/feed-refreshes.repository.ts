import { Injectable } from '@nestjs/common';
import type { ImportDelimiter } from '../catalog-import/import.types.js';
import { ErrorCodes, type ErrorCode } from '../common/http/error-codes.js';
import { publicError, type PublicError } from '../common/http/public-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { isProjectMember } from '../projects/project-access.js';
import {
  claimIsCurrent,
  newExecutionToken,
  nowPlus,
} from '../jobs/lease-sql.js';
import {
  decideRefreshRecovery,
  type RefreshRetryOptions,
} from '../jobs/refresh-retry.js';
import type { FeedPolicy } from '../feeds/feeds.types.js';
import {
  LostClaimError,
  type ClaimedRefresh,
  type PlannedIds,
  type RefreshOutcome,
  type RefreshStage,
  type RefreshView,
} from './feed-refreshes.types.js';

type IdRow = { id: string };

type FeedForRefreshRow = { id: string; hasSource: boolean; hasPolicy: boolean };

/** Una actualización reclamada tal como sale de la base, con su feed y proyecto. */
type ClaimedRow = Omit<ClaimedRefresh, 'token' | 'source' | 'policy'> & {
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
};

/** Una evaluación terminada bien, con lo que miran la política y la exportación. */
export type EvaluationResult = Readonly<{
  engineVersion: string;
  profileVersion: string;
  valid: number;
  invalid: number;
  excluded: number;
  resultChecksum: string;
}>;

type RefreshRow = Omit<RefreshView, 'runAfter'> & { runAfter: Date };

type ExpiredRow = { id: string; attempts: number };

/** Un feed con la actualización diaria activa, fuente y política. */
export type ScheduledFeed = Readonly<{
  feedId: string;
  refreshTime: string;
  timeZone: string;
}>;

/** Estado de una importación o una evaluación que la actualización espera. */
export type AwaitedJob = Readonly<{ status: string; errorCode: string | null }>;

const REFRESH_COLUMNS = Prisma.sql`
  r.id,
  r.feed_id AS "feedId",
  r.status,
  r.stage,
  r.attempts,
  r.outcome,
  r.snapshot_id AS "snapshotId",
  r.evaluation_id AS "evaluationId",
  r.run_after AS "runAfter",
  r.error,
  r.scheduled_for AS "scheduledFor",
  r.created_at AS "createdAt",
  r.finished_at AS "finishedAt"
`;

/** Columna de cada id previsto; nombres fijos, nunca datos del cliente. */
const PLANNED_ID_COLUMNS = [
  ['snapshotId', 'snapshot_id'],
  ['importJobId', 'import_job_id'],
  ['evaluationId', 'evaluation_id'],
] as const;

@Injectable()
export class FeedRefreshesRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Disparar y consultar, por el propietario del proyecto.
  // ---------------------------------------------------------------------------

  async findFeedForRefresh(
    ownerId: string,
    projectId: string,
    feedId: string,
  ): Promise<FeedForRefreshRow | null> {
    const rows = await this.prisma.$queryRaw<FeedForRefreshRow[]>`
      SELECT
        f.id,
        f.source_url IS NOT NULL AS "hasSource",
        f.policy_ruleset_revision IS NOT NULL AS "hasPolicy"
      FROM estadistica_forms.feeds f
      JOIN estadistica_forms.projects p ON p.id = f.project_id
      WHERE f.id = ${feedId}
        AND p.id = ${projectId}
        AND ${isProjectMember(ownerId)}`;
    return rows[0] ?? null;
  }

  /**
   * Encola una actualización en el paso `fetch`. Devuelve `null` si el feed ya
   * tiene una activa (índice único parcial, D10).
   */
  async create(record: {
    id: string;
    feedId: string;
    createdAt: string;
  }): Promise<RefreshView | null> {
    try {
      // SQL y no `feedRefresh.create`: Prisma calcularía `run_after` en el
      // cliente y lo enviaría sin zona horaria; con una sesión que no esté en
      // UTC quedaría horas en el futuro y nadie lo reclamaría (comprobado en
      // E4). Así lo pone la base con su reloj (D2).
      // La generación se lee en la misma sentencia: es la que había al disparar.
      await this.prisma.$executeRaw`
        INSERT INTO estadistica_forms.feed_refreshes
          (id, feed_id, status, stage, created_at, expected_generation)
        SELECT ${record.id}, f.id, 'queued', 'fetch', ${record.createdAt}, f.generation
        FROM estadistica_forms.feeds f
        WHERE f.id = ${record.feedId}`;
    } catch (error) {
      if (isUniqueViolation(error)) {
        return null;
      }
      throw error;
    }
    return this.requireById(record.id);
  }

  /**
   * Feeds con la actualización diaria activa y todo lo necesario para hacerla:
   * fuente y política. Los que no, no se programan (D10).
   */
  findScheduledFeeds(): Promise<ScheduledFeed[]> {
    return this.prisma.$queryRaw<ScheduledFeed[]>`
      SELECT
        id AS "feedId",
        refresh_time AS "refreshTime",
        time_zone AS "timeZone"
      FROM estadistica_forms.feeds
      WHERE refresh_enabled
        AND source_url IS NOT NULL
        AND policy_ruleset_revision IS NOT NULL`;
  }

  /**
   * Encola la actualización programada de un feed para una fecha local. Si ya
   * existe la de esa fecha, o el feed tiene otra activa, no hace nada y
   * devuelve `false`: varias instancias pueden intentarlo a la vez (D10, F15).
   */
  async enqueueScheduled(target: {
    id: string;
    feedId: string;
    scheduledFor: string;
    createdAt: string;
  }): Promise<boolean> {
    const inserted = await this.prisma.$queryRaw<IdRow[]>`
      INSERT INTO estadistica_forms.feed_refreshes
        (id, feed_id, status, stage, created_at, expected_generation, scheduled_for)
      SELECT
        ${target.id}, f.id, 'queued', 'fetch', ${target.createdAt},
        f.generation, ${target.scheduledFor}
      FROM estadistica_forms.feeds f
      WHERE f.id = ${target.feedId}
      ON CONFLICT DO NOTHING
      RETURNING id`;
    return inserted.length === 1;
  }

  async findByOwner(target: {
    ownerId: string;
    projectId: string;
    feedId: string;
    refreshId: string;
  }): Promise<RefreshView | null> {
    const rows = await this.prisma.$queryRaw<RefreshRow[]>`
      SELECT ${REFRESH_COLUMNS}
      FROM estadistica_forms.feed_refreshes r
      JOIN estadistica_forms.feeds f ON f.id = r.feed_id
      JOIN estadistica_forms.projects p ON p.id = f.project_id
      WHERE r.id = ${target.refreshId}
        AND f.id = ${target.feedId}
        AND p.id = ${target.projectId}
        AND ${isProjectMember(target.ownerId)}`;
    return rows[0] ? toRefreshView(rows[0]) : null;
  }

  // ---------------------------------------------------------------------------
  // Worker: recuperar leases vencidos y reclamar.
  // ---------------------------------------------------------------------------

  /**
   * Los trabajos `running` con el lease vencido no pueden seguir: su worker
   * cayó o se quedó colgado. Cuenta como fallo temporal (D3, D4): espera con
   * `retry_wait` o, si se agotaron los intentos, falla. Su token deja de valer.
   */
  recoverExpiredLeases(retry: RefreshRetryOptions): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const expired = await tx.$queryRaw<ExpiredRow[]>`
        SELECT id, attempts
        FROM estadistica_forms.feed_refreshes
        WHERE status = 'running'
          AND lease_until <= now()
        FOR UPDATE SKIP LOCKED`;
      for (const row of expired) {
        await applyRecovery(tx, row, retry);
      }
      return expired.length;
    });
  }

  /**
   * Toma la actualización lista más antigua y la marca `running` con un token
   * nuevo y su lease. SKIP LOCKED evita que dos workers tomen la misma (F17).
   * `skip`: las que este worker ya atendió en la pasada actual.
   */
  claim(
    leaseMs: number,
    skip: readonly string[] = [],
  ): Promise<ClaimedRefresh | null> {
    return this.prisma.$transaction(async (tx) => {
      const ready = await tx.$queryRaw<IdRow[]>`
        SELECT id
        FROM estadistica_forms.feed_refreshes
        WHERE status IN ('queued', 'retry_wait')
          AND run_after <= now()
          AND id <> ALL(${[...skip]}::text[])
        ORDER BY run_after, id
        LIMIT 1
        FOR UPDATE SKIP LOCKED`;
      if (!ready[0]) {
        return null;
      }

      const token = newExecutionToken();
      await tx.$executeRaw`
        UPDATE estadistica_forms.feed_refreshes
        SET
          status = 'running',
          lease_until = ${nowPlus(leaseMs)},
          execution_token = ${token}
        WHERE id = ${ready[0].id}`;
      return readClaimed(tx, ready[0].id, token);
    });
  }

  // ---------------------------------------------------------------------------
  // Worker: escrituras condicionadas al reclamo vigente. Todas devuelven `false`
  // si el reclamo ya no es el vigente y entonces no cambian nada.
  // ---------------------------------------------------------------------------

  /** Guarda ids previstos (o los borra con `null`) sin soltar el reclamo. */
  async savePlannedIds(claim: ClaimedRefresh, ids: PlannedIds) {
    const changed = await this.prisma.$queryRaw<IdRow[]>`
      UPDATE estadistica_forms.feed_refreshes
      SET ${Prisma.join(plannedIdAssignments(ids), ', ')}
      WHERE ${claimIsCurrent(claim)}
      RETURNING id`;
    return changed.length === 1;
  }

  /** Pasa al paso siguiente sin soltar el reclamo. */
  async advance(claim: ClaimedRefresh, stage: RefreshStage) {
    const changed = await this.prisma.$queryRaw<IdRow[]>`
      UPDATE estadistica_forms.feed_refreshes
      SET stage = ${stage}
      WHERE ${claimIsCurrent(claim)}
      RETURNING id`;
    return changed.length === 1;
  }

  /**
   * Suelta el reclamo y vuelve a la cola dentro de `delayMs`, en el mismo paso:
   * esperar no gasta intentos. También al apagar, con `delayMs` 0.
   */
  async requeue(claim: ClaimedRefresh, delayMs: number) {
    const changed = await this.prisma.$queryRaw<IdRow[]>`
      UPDATE estadistica_forms.feed_refreshes
      SET
        status = 'queued',
        run_after = ${nowPlus(delayMs)},
        lease_until = NULL,
        execution_token = NULL
      WHERE ${claimIsCurrent(claim)}
      RETURNING id`;
    return changed.length === 1;
  }

  /**
   * Fallo temporal: guarda el error, el intento consumido y los ids que haya
   * que olvidar (por ejemplo, el snapshot de una importación interrumpida), y
   * espera `delayMs` en `retry_wait`.
   */
  async retryLater(
    claim: ClaimedRefresh,
    failure: {
      attempts: number;
      delayMs: number;
      error: PublicError;
      stage: RefreshStage;
      forget: PlannedIds;
    },
  ) {
    const changed = await this.prisma.$queryRaw<IdRow[]>`
      UPDATE estadistica_forms.feed_refreshes
      SET
        status = 'retry_wait',
        stage = ${failure.stage},
        attempts = ${failure.attempts},
        run_after = ${nowPlus(failure.delayMs)},
        ${Prisma.join(
          [
            Prisma.sql`error = ${JSON.stringify(failure.error)}::jsonb`,
            Prisma.sql`lease_until = NULL`,
            Prisma.sql`execution_token = NULL`,
            ...plannedIdAssignments(failure.forget),
          ],
          ', ',
        )}
      WHERE ${claimIsCurrent(claim)}
      RETURNING id`;
    return changed.length === 1;
  }

  async fail(
    claim: ClaimedRefresh,
    failure: { attempts: number; error: PublicError },
  ) {
    const changed = await this.prisma.$queryRaw<IdRow[]>`
      UPDATE estadistica_forms.feed_refreshes
      SET
        status = 'failed',
        attempts = ${failure.attempts},
        error = ${JSON.stringify(failure.error)}::jsonb,
        finished_at = ${new Date().toISOString()},
        lease_until = NULL,
        execution_token = NULL
      WHERE ${claimIsCurrent(claim)}
      RETURNING id`;
    return changed.length === 1;
  }

  /**
   * Termina con un resultado. `reason` es el motivo de `needs_review` o
   * `conflict`; queda en `error` para que el operador lo vea (D12).
   */
  async succeed(
    claim: ClaimedRefresh,
    outcome: RefreshOutcome,
    reason?: ErrorCode,
  ) {
    const changed = await this.prisma.$queryRaw<IdRow[]>`
      UPDATE estadistica_forms.feed_refreshes
      SET ${succeededAssignments(outcome, reason)}
      WHERE ${claimIsCurrent(claim)}
      RETURNING id`;
    return changed.length === 1;
  }

  /**
   * Termina como `published` dentro de la transacción que publica (D3): si el
   * reclamo ya no es el vigente, lanza y la versión no se publica.
   */
  async finishPublished(tx: Prisma.TransactionClient, claim: ClaimedRefresh) {
    const changed = await tx.$queryRaw<IdRow[]>`
      UPDATE estadistica_forms.feed_refreshes
      SET ${succeededAssignments('published')}
      WHERE ${claimIsCurrent(claim)}
      RETURNING id`;
    if (changed.length !== 1) {
      throw new LostClaimError();
    }
  }

  // ---------------------------------------------------------------------------
  // Lecturas de los pasos: lo que la actualización creó o espera.
  // ---------------------------------------------------------------------------

  async snapshotExists(projectId: string, snapshotId: string) {
    const rows = await this.prisma.$queryRaw<IdRow[]>`
      SELECT id
      FROM estadistica_forms.catalog_snapshots
      WHERE id = ${snapshotId}
        AND project_id = ${projectId}`;
    return rows.length === 1;
  }

  async findImportJob(
    projectId: string,
    jobId: string,
  ): Promise<AwaitedJob | null> {
    const rows = await this.prisma.$queryRaw<AwaitedJob[]>`
      SELECT
        status,
        error ->> 'code' AS "errorCode"
      FROM estadistica_forms.catalog_import_jobs
      WHERE id = ${jobId}
        AND project_id = ${projectId}`;
    return rows[0] ?? null;
  }

  async findEvaluation(
    projectId: string,
    evaluationId: string,
  ): Promise<AwaitedJob | null> {
    const rows = await this.prisma.$queryRaw<AwaitedJob[]>`
      SELECT
        status,
        error ->> 'code' AS "errorCode"
      FROM estadistica_forms.evaluations
      WHERE id = ${evaluationId}
        AND project_id = ${projectId}`;
    return rows[0] ?? null;
  }

  /** `null` si la evaluación no existe o no terminó bien. */
  async findEvaluationResult(
    projectId: string,
    evaluationId: string,
  ): Promise<EvaluationResult | null> {
    const rows = await this.prisma.$queryRaw<EvaluationResult[]>`
      SELECT
        engine_version AS "engineVersion",
        profile_version AS "profileVersion",
        valid_count AS "valid",
        invalid_count AS "invalid",
        excluded_count AS "excluded",
        result_checksum AS "resultChecksum"
      FROM estadistica_forms.evaluations
      WHERE id = ${evaluationId}
        AND project_id = ${projectId}
        AND status = 'succeeded'`;
    return rows[0] ?? null;
  }

  /** Productos de la versión publicada ahora, o `null` si no hay ninguna. */
  async findPublishedRowCount(feedId: string): Promise<number | null> {
    const rows = await this.prisma.$queryRaw<{ rowCount: number }[]>`
      SELECT v.row_count AS "rowCount"
      FROM estadistica_forms.feeds f
      JOIN estadistica_forms.feed_versions v
        ON v.feed_id = f.id AND v.id = f.published_version_id
      WHERE f.id = ${feedId}`;
    return rows[0]?.rowCount ?? null;
  }

  private async requireById(refreshId: string) {
    const rows = await this.prisma.$queryRaw<RefreshRow[]>`
      SELECT ${REFRESH_COLUMNS}
      FROM estadistica_forms.feed_refreshes r
      WHERE r.id = ${refreshId}`;
    if (!rows[0]) {
      throw new Error('La actualización recién guardada no se encuentra.');
    }
    return toRefreshView(rows[0]);
  }
}

/** Recuperar un lease vencido es un fallo temporal más (D4). */
async function applyRecovery(
  tx: Prisma.TransactionClient,
  row: ExpiredRow,
  retry: RefreshRetryOptions,
) {
  const attempts = row.attempts + 1;
  const error = publicError(ErrorCodes.REFRESH_LEASE_EXPIRED);
  const decision = decideRefreshRecovery({ code: error.code }, attempts, retry);

  if (decision.status === 'failed') {
    await tx.$executeRaw`
      UPDATE estadistica_forms.feed_refreshes
      SET
        status = 'failed',
        attempts = ${attempts},
        error = ${JSON.stringify(error)}::jsonb,
        finished_at = ${new Date().toISOString()},
        lease_until = NULL,
        execution_token = NULL
      WHERE id = ${row.id}`;
    return;
  }
  await tx.$executeRaw`
    UPDATE estadistica_forms.feed_refreshes
    SET
      status = 'retry_wait',
      attempts = ${attempts},
      run_after = ${nowPlus(decision.delayMs)},
      error = ${JSON.stringify(error)}::jsonb,
      lease_until = NULL,
      execution_token = NULL
    WHERE id = ${row.id}`;
}

async function readClaimed(
  tx: Prisma.TransactionClient,
  refreshId: string,
  token: string,
): Promise<ClaimedRefresh> {
  const rows = await tx.$queryRaw<ClaimedRow[]>`
    SELECT
      r.id,
      r.feed_id AS "feedId",
      f.project_id AS "projectId",
      -- La actualización automática actúa en nombre de quien creó el proyecto
      -- (procedencia); aceptar la importación revalida su acceso (C6).
      p.owner_id AS "ownerId",
      r.stage,
      r.attempts,
      r.snapshot_id AS "snapshotId",
      r.import_job_id AS "importJobId",
      r.evaluation_id AS "evaluationId",
      r.expected_generation AS "expectedGeneration",
      f.source_url AS "sourceUrl",
      f.source_id_column AS "sourceIdColumn",
      f.source_delimiter AS "sourceDelimiter",
      f.policy_ruleset_revision AS "policyRulesetRevision",
      f.policy_max_invalid AS "policyMaxInvalid",
      f.policy_max_excluded AS "policyMaxExcluded",
      f.policy_max_drop_percent AS "policyMaxDropPercent",
      f.policy_engine_version AS "policyEngineVersion",
      f.policy_profile_version AS "policyProfileVersion",
      f.policy_approved_at AS "policyApprovedAt"
    FROM estadistica_forms.feed_refreshes r
    JOIN estadistica_forms.feeds f ON f.id = r.feed_id
    JOIN estadistica_forms.projects p ON p.id = f.project_id
    WHERE r.id = ${refreshId}`;
  const row = rows[0];
  if (!row) {
    throw new Error('La actualización reclamada no se encuentra.');
  }
  return toClaimed(row, token);
}

function toClaimed(row: ClaimedRow, token: string): ClaimedRefresh {
  return {
    id: row.id,
    feedId: row.feedId,
    projectId: row.projectId,
    ownerId: row.ownerId,
    token,
    stage: row.stage,
    attempts: row.attempts,
    source: sourceOf(row),
    snapshotId: row.snapshotId,
    importJobId: row.importJobId,
    evaluationId: row.evaluationId,
    expectedGeneration: row.expectedGeneration,
    policy: policyOf(row),
  };
}

/** La base exige las columnas de la fuente juntas o ninguna. */
function sourceOf(row: ClaimedRow) {
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

/** La base exige las columnas de la política juntas o ninguna. */
function policyOf(row: ClaimedRow): FeedPolicy | null {
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

/** Terminar bien: con resultado, el motivo si lo hay, y sin lease ni token. */
function succeededAssignments(outcome: RefreshOutcome, reason?: ErrorCode) {
  const error = reason ? JSON.stringify(publicError(reason)) : null;
  return Prisma.sql`
    status = 'succeeded',
    outcome = ${outcome},
    error = ${error}::jsonb,
    finished_at = ${new Date().toISOString()},
    lease_until = NULL,
    execution_token = NULL
  `;
}

/**
 * Asignaciones de los ids indicados, con su valor o `null` para olvidarlo. Los
 * que no se indican no se tocan.
 */
function plannedIdAssignments(ids: PlannedIds): Prisma.Sql[] {
  return PLANNED_ID_COLUMNS.filter(([key]) => key in ids).map(
    ([key, column]) => Prisma.sql`${Prisma.raw(column)} = ${ids[key] ?? null}`,
  );
}

function toRefreshView(row: RefreshRow): RefreshView {
  return { ...row, runAfter: row.runAfter.toISOString() };
}

/** Con SQL directo, el índice único llega como P2010 con el código 23505. */
function isUniqueViolation(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2010' &&
    JSON.stringify(error.meta ?? {}).includes('23505')
  );
}
