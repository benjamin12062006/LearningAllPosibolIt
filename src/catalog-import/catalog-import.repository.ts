import { Injectable } from '@nestjs/common';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import type { PageRequest } from '../common/http/pagination.js';
import {
  localizeStoredError,
  publicError,
} from '../common/http/public-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  claimIsCurrent,
  LostClaimError,
  newExecutionToken,
  nowPlus,
  type JobClaim,
} from '../jobs/lease-sql.js';
import { retryDelay, type RetryOptions } from '../jobs/retry-delay.js';
import { enqueueArtifactsDelete } from '../outbox/outbox-events.js';
import {
  assertProjectPermission,
  isProjectMember,
  joinProjectAccess,
  PROJECT_ACCESS_COLUMNS,
  type ProjectMemberAccess,
} from '../projects/project-access.js';
import {
  hasCompleteConfiguration,
  type ChannelProfile,
} from '../projects/projects.types.js';
import {
  IMPORT_JOB_DEFAULTS,
  IMPORT_LIMITS,
  ImportFailure,
  type Acceptance,
  type ClaimedImport,
  type DeletedImport,
  type DeletedProject,
  type ImportError,
  type ImportRow,
} from './import.types.js';

type ProjectConfigurationRow = {
  country: string | null;
  currency: string | null;
  channelProfile: ChannelProfile | null;
};

/** El proyecto que acepta una importación y el acceso de quien la acepta. */
type AcceptingProjectRow = ProjectConfigurationRow & ProjectMemberAccess;

type IdRow = { id: string };

type ListedImportRow = {
  id: string;
  projectId: string;
  idColumn: string;
  delimiter: string;
  byteSize: number;
  originalName: string;
  status: string;
  rowCount: number | null;
  createdAt: string;
  finishedAt: string | null;
  error: unknown;
  jobId: string | null;
  jobStatus: string | null;
  processedRows: number | null;
};

type JobRow = {
  id: string;
  projectId: string;
  snapshotId: string;
  status: string;
  processedRows: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: unknown;
};

type SnapshotRow = {
  id: string;
  projectId: string;
  idColumn: string;
  delimiter: string;
  headers: string[] | null;
  sourceHash: string;
  byteSize: number;
  originalName: string;
  status: string;
  rowCount: number | null;
  createdAt: string;
  finishedAt: string | null;
  error: unknown;
};

/** Un trabajo `running` con el lease vencido, a punto de recuperarse. */
type ExpiredJobRow = {
  id: string;
  snapshotId: string;
  requestId: string;
  attempts: number;
};

/** Un trabajo listo para reclamar, con lo que el worker necesita de su snapshot. */
type ReadyJobRow = Omit<ClaimedImport, 'token' | 'leaseMs'>;

type DeletedSnapshotRow = { snapshotId: string; artifactKey: string };

type DeletableSnapshotRow = DeletedSnapshotRow & {
  jobStatus: string | null;
} & ProjectMemberAccess;

type ExportKeyRow = { snapshotId: string; artifactKey: string };

type ArtifactKeyRow = { artifactKey: string };

type ParsedFile = {
  headers: string[];
  count: number;
  hash: string;
  bytes: number;
};

/**
 * Lo que quien acepta guarda junto al snapshot, dentro de la misma transacción:
 * el puente desde una hoja guarda así su procedencia (plan imports&exports 01,
 * D22). Si lanza, no se crea nada.
 */
export type AcceptanceRecorder = (
  tx: Prisma.TransactionClient,
) => Promise<void>;

/** Un trabajo está activo mientras espera en la cola o se está procesando. */
const ACTIVE_JOB_STATUSES = ['queued', 'running'];

const ARTIFACT_KEYS_PER_QUERY = 500;

@Injectable()
export class CatalogImportRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Peticiones del propietario: aceptar, listar y consultar.
  // ---------------------------------------------------------------------------

  /** Registra el snapshot y su trabajo en cola, o rechaza la importación. */
  accept(input: Acceptance, recordSource?: AcceptanceRecorder) {
    return this.prisma.$transaction(async (tx) => {
      // FOR UPDATE OF p bloquea la fila del proyecto: dos peticiones simultáneas
      // no pueden pasar a la vez la comprobación de importación activa. El
      // acceso se comprueba aquí y no solo en el guard: la actualización
      // programada del feed acepta en nombre de quien la configuró, y si ya no
      // puede, no se importa nada (C6, «revalidar al aceptar un trabajo», [11]).
      const projects = await tx.$queryRaw<AcceptingProjectRow[]>`
        SELECT
          p.country,
          p.currency,
          p.channel_profile AS "channelProfile",
          ${PROJECT_ACCESS_COLUMNS}
        FROM estadistica_forms.projects p
        ${joinProjectAccess(input.ownerId)}
        WHERE p.id = ${input.projectId}
        FOR UPDATE OF p`;
      const accepting = projects[0] ?? null;
      assertProjectPermission(accepting, 'worksheet.write');
      const project: ProjectConfigurationRow = {
        country: accepting.country,
        currency: accepting.currency,
        channelProfile: accepting.channelProfile,
      };
      if (!hasCompleteConfiguration(project)) {
        throw apiError(ErrorCodes.PROJECT_CONFIGURATION_REQUIRED);
      }

      if (await this.hasActiveJobLocked(tx, input.projectId)) {
        throw apiError(ErrorCodes.IMPORT_ALREADY_ACTIVE);
      }

      const now = new Date().toISOString();
      await tx.catalogSnapshot.create({
        data: {
          id: input.snapshotId,
          projectId: input.projectId,
          idColumn: input.idColumn,
          delimiter: input.delimiter,
          sourceHash: input.sourceHash,
          artifactKey: input.artifactKey,
          byteSize: input.byteSize,
          originalName: input.originalName,
          projectConfiguration: project,
          status: 'pending',
          createdAt: now,
        },
      });
      await tx.catalogImportJob.create({
        data: {
          id: input.jobId,
          projectId: input.projectId,
          snapshotId: input.snapshotId,
          requestId: input.requestId,
          status: 'queued',
          createdAt: now,
        },
      });
      await recordSource?.(tx);
    });
  }

  /** Comprobación temprana del guard; la definitiva está en `accept`. */
  async hasActiveJob(ownerId: string, projectId: string) {
    const rows = await this.prisma.$queryRaw<IdRow[]>`
      SELECT j.id
      FROM estadistica_forms.catalog_import_jobs j
      JOIN estadistica_forms.projects p ON p.id = j.project_id
      WHERE p.id = ${projectId}
        AND ${isProjectMember(ownerId)}
        AND j.status IN ('queued', 'running')
      LIMIT 1`;
    return rows.length > 0;
  }

  /**
   * Tras un fallo al confirmar `accept`, comprueba si la base sí guardó la
   * aceptación (por ejemplo, si se perdió la respuesta del commit).
   */
  async acceptanceExists(input: Acceptance) {
    const rows = await this.prisma.$queryRaw<IdRow[]>`
      SELECT j.id
      FROM estadistica_forms.catalog_import_jobs j
      JOIN estadistica_forms.catalog_snapshots s
        ON s.id = j.snapshot_id AND s.project_id = j.project_id
      JOIN estadistica_forms.projects p ON p.id = s.project_id
      WHERE j.id = ${input.jobId}
        AND s.id = ${input.snapshotId}
        AND p.id = ${input.projectId}
        AND ${isProjectMember(input.ownerId)}
        AND s.artifact_key = ${input.artifactKey}`;
    return rows.length === 1;
  }

  /** Metadatos y estado del trabajo de cada importación; sin la muestra de filas. */
  async listSnapshots(ownerId: string, projectId: string, window: PageRequest) {
    const owned = await this.prisma.$queryRaw<IdRow[]>`
      SELECT id
      FROM estadistica_forms.projects p
      WHERE p.id = ${projectId} AND ${isProjectMember(ownerId)}`;
    if (!owned[0]) {
      throw apiError(ErrorCodes.PROJECT_NOT_FOUND);
    }

    const rows = await this.prisma.$queryRaw<ListedImportRow[]>`
      SELECT
        s.id,
        s.project_id AS "projectId",
        s.id_column AS "idColumn",
        s.delimiter,
        s.byte_size AS "byteSize",
        s.original_name AS "originalName",
        s.status,
        s.row_count AS "rowCount",
        s.created_at AS "createdAt",
        s.finished_at AS "finishedAt",
        s.error,
        j.id AS "jobId",
        j.status AS "jobStatus",
        j.processed_rows AS "processedRows"
      FROM estadistica_forms.catalog_snapshots s
      LEFT JOIN estadistica_forms.catalog_import_jobs j ON j.snapshot_id = s.id
      WHERE s.project_id = ${projectId}
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT ${window.limit} OFFSET ${window.offset}`;
    return rows.map(toListedImport);
  }

  async findJob(ownerId: string, projectId: string, id: string) {
    const rows = await this.prisma.$queryRaw<JobRow[]>`
      SELECT
        j.id,
        j.project_id AS "projectId",
        j.snapshot_id AS "snapshotId",
        j.status,
        j.processed_rows AS "processedRows",
        j.created_at AS "createdAt",
        j.started_at AS "startedAt",
        j.finished_at AS "finishedAt",
        j.error
      FROM estadistica_forms.catalog_import_jobs j
      JOIN estadistica_forms.projects p ON p.id = j.project_id
      WHERE j.id = ${id}
        AND p.id = ${projectId}
        AND ${isProjectMember(ownerId)}`;
    const job = rows[0];
    if (!job) {
      throw apiError(ErrorCodes.IMPORT_NOT_FOUND);
    }
    return { ...job, error: localizeStoredError(job.error) };
  }

  /** El snapshot y, solo si está listo, una muestra de sus primeras filas. */
  async findSnapshot(ownerId: string, projectId: string, id: string) {
    const rows = await this.prisma.$queryRaw<SnapshotRow[]>`
      SELECT
        s.id,
        s.project_id AS "projectId",
        s.id_column AS "idColumn",
        s.delimiter,
        s.headers,
        s.source_hash AS "sourceHash",
        s.byte_size AS "byteSize",
        s.original_name AS "originalName",
        s.status,
        s.row_count AS "rowCount",
        s.created_at AS "createdAt",
        s.finished_at AS "finishedAt",
        s.error
      FROM estadistica_forms.catalog_snapshots s
      JOIN estadistica_forms.projects p ON p.id = s.project_id
      WHERE s.id = ${id}
        AND p.id = ${projectId}
        AND ${isProjectMember(ownerId)}`;
    const snapshot = rows[0];
    if (!snapshot) {
      throw apiError(ErrorCodes.IMPORT_NOT_FOUND);
    }

    const sample = snapshot.status === 'ready' ? await this.readSample(id) : [];
    return {
      snapshot: { ...snapshot, error: localizeStoredError(snapshot.error) },
      sample,
    };
  }

  /**
   * Borra una importación terminada; sus filas y su trabajo se borran en
   * cascada. Sus archivos (CSV y TSV de sus exportaciones) quedan en el outbox
   * en esta misma transacción (plan jobs&files, D9).
   */
  deleteSnapshot(
    ownerId: string,
    projectId: string,
    snapshotId: string,
  ): Promise<DeletedImport> {
    return this.prisma.$transaction(async (tx) => {
      // FOR UPDATE OF s: el worker no puede tocar el snapshot mientras se decide.
      const rows = await tx.$queryRaw<DeletableSnapshotRow[]>`
        SELECT
          s.id AS "snapshotId",
          s.artifact_key AS "artifactKey",
          j.status AS "jobStatus",
          ${PROJECT_ACCESS_COLUMNS}
        FROM estadistica_forms.catalog_snapshots s
        JOIN estadistica_forms.projects p ON p.id = s.project_id
        ${joinProjectAccess(ownerId)}
        LEFT JOIN estadistica_forms.catalog_import_jobs j ON j.snapshot_id = s.id
        WHERE s.id = ${snapshotId}
          AND p.id = ${projectId}
        FOR UPDATE OF s`;
      const snapshot = rows[0];
      if (!snapshot) {
        throw apiError(ErrorCodes.IMPORT_NOT_FOUND);
      }
      // Borrar una importación prepara trabajo, como importarla (C6).
      assertProjectPermission(snapshot, 'worksheet.write');
      if (isActiveStatus(snapshot.jobStatus)) {
        throw apiError(ErrorCodes.IMPORT_IN_PROGRESS);
      }
      if (await hasActiveEvaluation(tx, { projectId, snapshotId })) {
        throw apiError(ErrorCodes.EVALUATION_IN_PROGRESS);
      }

      const exportKeys = await findExportKeys(tx, [snapshotId]);
      await tx.$executeRaw`
        DELETE FROM estadistica_forms.catalog_snapshots
        WHERE id = ${snapshotId}`;
      const deleted: DeletedImport = {
        snapshotId: snapshot.snapshotId,
        artifactKey: snapshot.artifactKey,
        exportArtifactKeys: exportKeys.get(snapshotId) ?? [],
      };
      await enqueueImportFiles(tx, [deleted]);
      return deleted;
    });
  }

  /**
   * Borra el proyecto y todas sus importaciones. Sus archivos (CSV, TSV y
   * versiones del feed) quedan en el outbox en esta misma transacción (D9).
   */
  deleteProject(ownerId: string, projectId: string): Promise<DeletedProject> {
    return this.prisma.$transaction(async (tx) => {
      // Mismo bloqueo que `accept`: no puede entrar una importación nueva
      // mientras se borra el proyecto.
      const projects = await tx.$queryRaw<ProjectMemberAccess[]>`
        SELECT ${PROJECT_ACCESS_COLUMNS}
        FROM estadistica_forms.projects p
        ${joinProjectAccess(ownerId)}
        WHERE p.id = ${projectId}
        FOR UPDATE OF p`;
      // Borrar el proyecto entero: Admin u Owner (C6).
      assertProjectPermission(projects[0] ?? null, 'members.manage');
      if (await this.hasActiveJobLocked(tx, projectId)) {
        throw apiError(ErrorCodes.IMPORT_IN_PROGRESS);
      }
      if (await hasActiveEvaluation(tx, { projectId })) {
        throw apiError(ErrorCodes.EVALUATION_IN_PROGRESS);
      }
      if (await hasWorkbooks(tx, projectId)) {
        throw apiError(ErrorCodes.PROJECT_HAS_WORKBOOKS);
      }

      // El proyecto bloqueado no detiene una exportación en curso, que bloquea
      // su snapshot con FOR SHARE: bloquear aquí los snapshots espera a que
      // termine, y así su TSV aparece entre las claves que se retiran.
      const snapshots = await tx.$queryRaw<IdRow[]>`
        SELECT id
        FROM estadistica_forms.catalog_snapshots
        WHERE project_id = ${projectId}
        FOR UPDATE`;
      const exportKeys = await findExportKeys(
        tx,
        snapshots.map((snapshot) => snapshot.id),
      );
      const feedArtifactKeys = await findFeedKeysLocked(tx, projectId);

      const deleted = await tx.$queryRaw<DeletedSnapshotRow[]>`
        DELETE FROM estadistica_forms.catalog_snapshots
        WHERE project_id = ${projectId}
        RETURNING id AS "snapshotId", artifact_key AS "artifactKey"`;
      await tx.$executeRaw`
        DELETE FROM estadistica_forms.projects
        WHERE id = ${projectId}`;
      const imports = deleted.map((snapshot) => ({
        ...snapshot,
        exportArtifactKeys: exportKeys.get(snapshot.snapshotId) ?? [],
      }));
      await enqueueImportFiles(tx, imports);
      await enqueueArtifactsDelete(tx, 'feeds', feedArtifactKeys);
      return {
        imports,
        feedArtifactKeys,
      };
    });
  }

  /** De las claves dadas, las que todavía usa algún snapshot. */
  async findReferencedArtifactKeys(keys: string[]): Promise<Set<string>> {
    const referenced = new Set<string>();
    for (let start = 0; start < keys.length; start += ARTIFACT_KEYS_PER_QUERY) {
      const chunk = keys.slice(start, start + ARTIFACT_KEYS_PER_QUERY);
      const rows = await this.prisma.$queryRaw<ArtifactKeyRow[]>`
        SELECT artifact_key AS "artifactKey"
        FROM estadistica_forms.catalog_snapshots
        WHERE artifact_key IN (${Prisma.join(chunk)})`;
      for (const row of rows) {
        referenced.add(row.artifactKey);
      }
    }
    return referenced;
  }

  // ---------------------------------------------------------------------------
  // Trabajo del worker: reclamar, guardar lotes y cerrar el trabajo.
  // ---------------------------------------------------------------------------

  /**
   * Los trabajos `running` con el lease vencido no pueden seguir: su proceso
   * cayó o se quedó colgado. Cuenta como un fallo temporal (plan jobs&files,
   * D4 y D6): vuelven a la cola desde cero o, sin intentos, fallan con
   * `IMPORT_INTERRUPTED`. Su token deja de valer.
   */
  recoverExpiredLeases(retry: RetryOptions): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const expired = await tx.$queryRaw<ExpiredJobRow[]>`
        SELECT
          id,
          snapshot_id AS "snapshotId",
          request_id AS "requestId",
          attempts
        FROM estadistica_forms.catalog_import_jobs
        WHERE status = 'running'
          AND lease_until <= now()
        FOR UPDATE SKIP LOCKED`;
      for (const job of expired) {
        const attempts = job.attempts + 1;
        if (attempts >= retry.maxAttempts) {
          await failLocked(
            tx,
            job,
            attempts,
            publicError(ErrorCodes.IMPORT_INTERRUPTED),
          );
        } else {
          await requeueLocked(tx, job, attempts, retryDelay(attempts, retry));
        }
      }
      return expired.length;
    });
  }

  /**
   * Toma el trabajo listo más antiguo y lo marca `running` con un token nuevo y
   * su lease. SKIP LOCKED evita que dos workers reclamen el mismo trabajo.
   * `skip`: los que este worker ya atendió en la pasada actual.
   */
  claim(
    leaseMs: number = IMPORT_JOB_DEFAULTS.leaseMs,
    skip: readonly string[] = [],
  ): Promise<ClaimedImport | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<ReadyJobRow[]>`
        SELECT
          j.id,
          j.snapshot_id AS "snapshotId",
          j.project_id AS "projectId",
          j.request_id AS "requestId",
          j.attempts,
          s.artifact_key AS "artifactKey",
          s.source_hash AS "sourceHash",
          s.byte_size AS "byteSize",
          s.id_column AS "idColumn",
          s.delimiter
        FROM estadistica_forms.catalog_import_jobs j
        JOIN estadistica_forms.catalog_snapshots s ON s.id = j.snapshot_id
        WHERE j.status = 'queued'
          AND (j.run_after IS NULL OR j.run_after <= now())
          AND s.status = 'pending'
          AND j.id <> ALL(${[...skip]}::text[])
        ORDER BY j.created_at, j.id
        LIMIT 1
        FOR UPDATE OF j SKIP LOCKED`;
      const job = rows[0];
      if (!job) {
        return null;
      }

      const token = newExecutionToken();
      await tx.$executeRaw`
        UPDATE estadistica_forms.catalog_import_jobs
        SET
          status = 'running',
          started_at = ${new Date().toISOString()},
          lease_until = ${nowPlus(leaseMs)},
          execution_token = ${token}
        WHERE id = ${job.id}`;
      await tx.catalogSnapshot.update({
        where: { id: job.snapshotId },
        data: { status: 'importing' },
      });
      return { ...job, token, leaseMs };
    });
  }

  /** Guarda un lote y renueva el lease; sin el reclamo vigente, no guarda nada. */
  appendBatch(job: ClaimedImport, rows: ImportRow[]) {
    return this.prisma.$transaction(async (tx) => {
      const renewed = await tx.$queryRaw<IdRow[]>`
        UPDATE estadistica_forms.catalog_import_jobs
        SET
          processed_rows = processed_rows + ${rows.length},
          lease_until = ${nowPlus(job.leaseMs)}
        WHERE ${claimIsCurrent(job)}
        RETURNING id`;
      if (renewed.length !== 1) {
        throw new LostClaimError();
      }
      await tx.catalogRow.createMany({
        data: rows.map((row) => ({ snapshotId: job.snapshotId, ...row })),
      });
    });
  }

  /** Marca el snapshot como listo si lo guardado coincide con el archivo leído. */
  complete(job: ClaimedImport, parsed: ParsedFile) {
    return this.prisma.$transaction(async (tx) => {
      await lockCurrentClaim(tx, job);
      const storedRows = await tx.catalogRow.count({
        where: { snapshotId: job.snapshotId },
      });
      if (!matchesParsedFile(job, parsed, storedRows)) {
        throw new ImportFailure(ErrorCodes.IMPORT_INTEGRITY_FAILED);
      }

      const finishedAt = new Date().toISOString();
      await tx.catalogSnapshot.update({
        where: { id: job.snapshotId },
        data: {
          status: 'ready',
          headers: parsed.headers,
          rowCount: storedRows,
          finishedAt,
        },
      });
      await tx.$executeRaw`
        UPDATE estadistica_forms.catalog_import_jobs
        SET
          status = 'succeeded',
          processed_rows = ${storedRows},
          finished_at = ${finishedAt},
          lease_until = NULL,
          execution_token = NULL
        WHERE id = ${job.id}`;
    });
  }

  /**
   * Termina con el error público. Devuelve `false` sin tocar nada si el
   * reclamo ya no es el vigente (otro proceso lo lleva o ya terminó).
   */
  fail(job: ClaimedImport, error: ImportError, attempts = job.attempts) {
    return this.whileClaimed(job, (tx) => failLocked(tx, job, attempts, error));
  }

  /** Fallo temporal: vuelve a la cola desde cero dentro de `delayMs`. */
  retryLater(job: ClaimedImport, attempts: number, delayMs: number) {
    return this.whileClaimed(job, (tx) =>
      requeueLocked(tx, job, attempts, delayMs),
    );
  }

  /** Al apagar: vuelve a la cola ya, sin gastar un intento (D6). */
  release(job: ClaimedImport) {
    return this.whileClaimed(job, (tx) =>
      requeueLocked(tx, job, job.attempts, 0),
    );
  }

  private readSample(snapshotId: string) {
    return this.prisma.$queryRaw<ImportRow[]>`
      SELECT
        source_row AS "sourceRow",
        external_id AS "externalId",
        original_values AS "originalValues"
      FROM estadistica_forms.catalog_rows
      WHERE snapshot_id = ${snapshotId}
      ORDER BY source_row
      LIMIT ${IMPORT_LIMITS.sampleRows}`;
  }

  /** Solo es fiable con la fila del proyecto bloqueada (FOR UPDATE) en `tx`. */
  private async hasActiveJobLocked(
    tx: Prisma.TransactionClient,
    projectId: string,
  ) {
    const activeJobs = await tx.$queryRaw<IdRow[]>`
      SELECT id
      FROM estadistica_forms.catalog_import_jobs
      WHERE project_id = ${projectId}
        AND status IN ('queued', 'running')
      LIMIT 1`;
    return activeJobs.length > 0;
  }

  /** Ejecuta `write` con el reclamo bloqueado; `false` si ya no es el vigente. */
  private whileClaimed(
    job: ClaimedImport,
    write: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await holdsCurrentClaim(tx, job))) {
        return false;
      }
      await write(tx);
      return true;
    });
  }
}

function toListedImport(row: ListedImportRow) {
  const { jobId, jobStatus, processedRows, error, ...snapshot } = row;
  const job = jobId
    ? { id: jobId, status: jobStatus, processedRows: processedRows ?? 0 }
    : null;
  return { ...snapshot, error: localizeStoredError(error), job };
}

function isActiveStatus(status: string | null) {
  return status !== null && ACTIVE_JOB_STATUSES.includes(status);
}

/**
 * Una evaluación en cola o en curso lee las filas del snapshot: no se borra
 * hasta que termine (plan rulesets&evaluations, D8). La tabla es del módulo
 * `evaluations`, pero la comprobación vive aquí porque el borrado es de este
 * módulo. Solo es fiable con el proyecto o el snapshot bloqueados en `tx`.
 */
async function hasActiveEvaluation(
  tx: Prisma.TransactionClient,
  where: { projectId: string; snapshotId?: string },
) {
  const active = await tx.evaluation.findFirst({
    where: { ...where, status: { in: ACTIVE_JOB_STATUSES } },
    select: { id: true },
  });
  return active !== null;
}

/**
 * Claves de los TSV de las exportaciones que se borrarán en cascada con estos
 * snapshots, agrupadas por snapshot (plan reviews&exports, D11). La tabla es del
 * módulo `exports`, pero la lectura vive aquí porque el borrado es de este
 * módulo. Los snapshots deben estar bloqueados con FOR UPDATE en `tx`.
 */
/**
 * Las revisiones de hojas no se borran desde proyectos (plan worksheets 01,
 * W11): la FK de `workbooks` es `RESTRICT`. Sin esta comprobación, borrar el
 * proyecto fallaría con un error de clave foránea (500) en lugar de un 409.
 */
async function hasWorkbooks(tx: Prisma.TransactionClient, projectId: string) {
  const rows = await tx.$queryRaw<IdRow[]>`
    SELECT id
    FROM estadistica_forms.workbooks
    WHERE project_id = ${projectId}
    LIMIT 1`;
  return rows.length > 0;
}

async function findExportKeys(
  tx: Prisma.TransactionClient,
  snapshotIds: string[],
): Promise<Map<string, string[]>> {
  const keys = new Map<string, string[]>();
  if (snapshotIds.length === 0) {
    return keys;
  }
  const rows = await tx.$queryRaw<ExportKeyRow[]>`
    SELECT
      e.snapshot_id AS "snapshotId",
      x.artifact_key AS "artifactKey"
    FROM estadistica_forms.exports x
    JOIN estadistica_forms.evaluations e
      ON e.project_id = x.project_id AND e.id = x.evaluation_id
    WHERE e.snapshot_id IN (${Prisma.join(snapshotIds)})`;
  for (const row of rows) {
    const snapshotKeys = keys.get(row.snapshotId) ?? [];
    snapshotKeys.push(row.artifactKey);
    keys.set(row.snapshotId, snapshotKeys);
  }
  return keys;
}

/**
 * Archivos de las versiones del feed del proyecto, que se borran en cascada con
 * él. Borrar el proyecto cruza dos módulos y vive aquí, como las claves de las
 * exportaciones. Una publicación en curso bloquea su feed con FOR UPDATE:
 * esperar aquí hace que su versión nueva aparezca entre las claves.
 */
async function findFeedKeysLocked(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<string[]> {
  await tx.$queryRaw<IdRow[]>`
    SELECT id
    FROM estadistica_forms.feeds
    WHERE project_id = ${projectId}
    FOR UPDATE`;
  const rows = await tx.$queryRaw<ArtifactKeyRow[]>`
    SELECT v.artifact_key AS "artifactKey"
    FROM estadistica_forms.feed_versions v
    JOIN estadistica_forms.feeds f ON f.id = v.feed_id
    WHERE f.project_id = ${projectId}
      AND v.artifact_key IS NOT NULL`;
  return rows.map((row) => row.artifactKey);
}

/** Las filas guardadas, el hash y el tamaño deben coincidir con el archivo aceptado. */
function matchesParsedFile(
  job: ClaimedImport,
  parsed: ParsedFile,
  storedRows: number,
) {
  return (
    storedRows >= 1 &&
    storedRows === parsed.count &&
    parsed.hash === job.sourceHash &&
    parsed.bytes === job.byteSize
  );
}

/** Bloquea el trabajo si el reclamo sigue siendo el vigente. */
async function holdsCurrentClaim(
  tx: Prisma.TransactionClient,
  claim: JobClaim,
) {
  const rows = await tx.$queryRaw<IdRow[]>`
    SELECT id
    FROM estadistica_forms.catalog_import_jobs
    WHERE ${claimIsCurrent(claim)}
    FOR UPDATE`;
  return rows.length === 1;
}

async function lockCurrentClaim(tx: Prisma.TransactionClient, claim: JobClaim) {
  if (!(await holdsCurrentClaim(tx, claim))) {
    throw new LostClaimError();
  }
}

/**
 * Vuelve a empezar desde cero (D4): sin filas parciales, sin progreso y con el
 * snapshot otra vez `pending`, para que el siguiente intento lea el archivo
 * completo. Quien llama ya tiene el trabajo bloqueado.
 */
async function requeueLocked(
  tx: Prisma.TransactionClient,
  job: Pick<ClaimedImport, 'id' | 'snapshotId'>,
  attempts: number,
  delayMs: number,
) {
  await tx.catalogRow.deleteMany({ where: { snapshotId: job.snapshotId } });
  await tx.$executeRaw`
    UPDATE estadistica_forms.catalog_import_jobs
    SET
      status = 'queued',
      attempts = ${attempts},
      run_after = ${nowPlus(delayMs)},
      processed_rows = 0,
      started_at = NULL,
      lease_until = NULL,
      execution_token = NULL
    WHERE id = ${job.id}`;
  await tx.catalogSnapshot.update({
    where: { id: job.snapshotId },
    data: { status: 'pending' },
  });
}

/** Cierra el trabajo y su snapshot como fallidos. Quien llama ya lo tiene bloqueado. */
async function failLocked(
  tx: Prisma.TransactionClient,
  job: Pick<ClaimedImport, 'id' | 'snapshotId' | 'requestId'>,
  attempts: number,
  error: ImportError,
) {
  const finishedAt = new Date().toISOString();
  const detail = { ...error, requestId: job.requestId };
  await tx.catalogSnapshot.update({
    where: { id: job.snapshotId },
    data: { status: 'failed', rowCount: null, finishedAt, error: detail },
  });
  await tx.$executeRaw`
    UPDATE estadistica_forms.catalog_import_jobs
    SET
      status = 'failed',
      attempts = ${attempts},
      finished_at = ${finishedAt},
      error = ${JSON.stringify(detail)}::jsonb,
      lease_until = NULL,
      execution_token = NULL
    WHERE id = ${job.id}`;
}

/** El CSV de cada importación borrada y los TSV de sus exportaciones. */
async function enqueueImportFiles(
  tx: Prisma.TransactionClient,
  imports: readonly DeletedImport[],
) {
  await enqueueArtifactsDelete(
    tx,
    'artifacts',
    imports.map((item) => item.artifactKey),
  );
  await enqueueArtifactsDelete(
    tx,
    'exports',
    imports.flatMap((item) => item.exportArtifactKeys),
  );
}
