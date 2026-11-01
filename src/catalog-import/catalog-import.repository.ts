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
  hasCompleteConfiguration,
  type ChannelProfile,
} from '../projects/projects.types.js';
import {
  IMPORT_LIMITS,
  ImportFailure,
  type Acceptance,
  type ClaimedImport,
  type DeletedImport,
  type ImportError,
  type ImportRow,
} from './import.types.js';

type ProjectConfigurationRow = {
  country: string | null;
  currency: string | null;
  channelProfile: ChannelProfile | null;
};

type JobStatusRow = { status: string };

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

type RunningJobRow = { id: string; snapshotId: string; requestId: string };

type DeletableSnapshotRow = DeletedImport & { jobStatus: string | null };

type ArtifactKeyRow = { artifactKey: string };

type ParsedFile = {
  headers: string[];
  count: number;
  hash: string;
  bytes: number;
};

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
  accept(input: Acceptance) {
    return this.prisma.$transaction(async (tx) => {
      // FOR UPDATE bloquea la fila del proyecto: dos peticiones simultáneas no
      // pueden pasar a la vez la comprobación de importación activa.
      const projects = await tx.$queryRaw<ProjectConfigurationRow[]>`
        SELECT country, currency, channel_profile AS "channelProfile"
        FROM estadistica_forms.projects
        WHERE id = ${input.projectId} AND owner_id = ${input.ownerId}
        FOR UPDATE`;
      const project = projects[0];
      if (!project) {
        throw apiError(ErrorCodes.PROJECT_NOT_FOUND);
      }
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
    });
  }

  /** Comprobación temprana del guard; la definitiva está en `accept`. */
  async hasActiveJob(ownerId: string, projectId: string) {
    const rows = await this.prisma.$queryRaw<IdRow[]>`
      SELECT j.id
      FROM estadistica_forms.catalog_import_jobs j
      JOIN estadistica_forms.projects p ON p.id = j.project_id
      WHERE p.id = ${projectId}
        AND p.owner_id = ${ownerId}
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
        AND p.owner_id = ${input.ownerId}
        AND s.artifact_key = ${input.artifactKey}`;
    return rows.length === 1;
  }

  /** Metadatos y estado del trabajo de cada importación; sin la muestra de filas. */
  async listSnapshots(ownerId: string, projectId: string, window: PageRequest) {
    const owned = await this.prisma.$queryRaw<IdRow[]>`
      SELECT id
      FROM estadistica_forms.projects
      WHERE id = ${projectId} AND owner_id = ${ownerId}`;
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
        AND p.owner_id = ${ownerId}`;
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
        AND p.owner_id = ${ownerId}`;
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
   * cascada. Devuelve el archivo que hay que retirar después del commit.
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
          j.status AS "jobStatus"
        FROM estadistica_forms.catalog_snapshots s
        JOIN estadistica_forms.projects p ON p.id = s.project_id
        LEFT JOIN estadistica_forms.catalog_import_jobs j ON j.snapshot_id = s.id
        WHERE s.id = ${snapshotId}
          AND p.id = ${projectId}
          AND p.owner_id = ${ownerId}
        FOR UPDATE OF s`;
      const snapshot = rows[0];
      if (!snapshot) {
        throw apiError(ErrorCodes.IMPORT_NOT_FOUND);
      }
      if (isActiveStatus(snapshot.jobStatus)) {
        throw apiError(ErrorCodes.IMPORT_IN_PROGRESS);
      }

      await tx.$executeRaw`
        DELETE FROM estadistica_forms.catalog_snapshots
        WHERE id = ${snapshotId}`;
      return {
        snapshotId: snapshot.snapshotId,
        artifactKey: snapshot.artifactKey,
      };
    });
  }

  /**
   * Borra el proyecto y todas sus importaciones. Devuelve los archivos que hay
   * que retirar después del commit.
   */
  deleteProject(ownerId: string, projectId: string): Promise<DeletedImport[]> {
    return this.prisma.$transaction(async (tx) => {
      // Mismo bloqueo que `accept`: no puede entrar una importación nueva
      // mientras se borra el proyecto.
      const projects = await tx.$queryRaw<IdRow[]>`
        SELECT id
        FROM estadistica_forms.projects
        WHERE id = ${projectId} AND owner_id = ${ownerId}
        FOR UPDATE`;
      if (!projects[0]) {
        throw apiError(ErrorCodes.PROJECT_NOT_FOUND);
      }
      if (await this.hasActiveJobLocked(tx, projectId)) {
        throw apiError(ErrorCodes.IMPORT_IN_PROGRESS);
      }

      const deleted = await tx.$queryRaw<DeletedImport[]>`
        DELETE FROM estadistica_forms.catalog_snapshots
        WHERE project_id = ${projectId}
        RETURNING id AS "snapshotId", artifact_key AS "artifactKey"`;
      await tx.$executeRaw`
        DELETE FROM estadistica_forms.projects
        WHERE id = ${projectId} AND owner_id = ${ownerId}`;
      return deleted;
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
   * Toma el trabajo en cola más antiguo y lo marca como `running`.
   * SKIP LOCKED evita que dos workers reclamen el mismo trabajo.
   */
  claim(): Promise<ClaimedImport | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<ClaimedImport[]>`
        SELECT
          j.id,
          j.snapshot_id AS "snapshotId",
          j.project_id AS "projectId",
          j.request_id AS "requestId",
          s.artifact_key AS "artifactKey",
          s.source_hash AS "sourceHash",
          s.byte_size AS "byteSize",
          s.id_column AS "idColumn",
          s.delimiter
        FROM estadistica_forms.catalog_import_jobs j
        JOIN estadistica_forms.catalog_snapshots s ON s.id = j.snapshot_id
        WHERE j.status = 'queued' AND s.status = 'pending'
        ORDER BY j.created_at, j.id
        LIMIT 1
        FOR UPDATE OF j SKIP LOCKED`;
      const job = rows[0];
      if (!job) {
        return null;
      }

      await tx.catalogImportJob.update({
        where: { id: job.id },
        data: { status: 'running', startedAt: new Date().toISOString() },
      });
      await tx.catalogSnapshot.update({
        where: { id: job.snapshotId },
        data: { status: 'importing' },
      });
      return job;
    });
  }

  appendBatch(job: ClaimedImport, rows: ImportRow[]) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockRunning(tx, job.id);
      await tx.catalogRow.createMany({
        data: rows.map((row) => ({ snapshotId: job.snapshotId, ...row })),
      });
      await tx.catalogImportJob.update({
        where: { id: job.id },
        data: { processedRows: { increment: rows.length } },
      });
    });
  }

  /** Marca el snapshot como listo si lo guardado coincide con el archivo leído. */
  complete(job: ClaimedImport, parsed: ParsedFile) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockRunning(tx, job.id);
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
      await tx.catalogImportJob.update({
        where: { id: job.id },
        data: { status: 'succeeded', processedRows: storedRows, finishedAt },
      });
    });
  }

  /** Guarda el error público; no toca un trabajo que ya terminó. */
  fail(
    job: Pick<ClaimedImport, 'id' | 'snapshotId' | 'requestId'>,
    error: ImportError,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<JobStatusRow[]>`
        SELECT status
        FROM estadistica_forms.catalog_import_jobs
        WHERE id = ${job.id}
        FOR UPDATE`;
      if (!isActiveJob(rows[0])) {
        return;
      }

      const finishedAt = new Date().toISOString();
      const detail = { ...error, requestId: job.requestId };
      await tx.catalogSnapshot.update({
        where: { id: job.snapshotId },
        data: { status: 'failed', rowCount: null, finishedAt, error: detail },
      });
      await tx.catalogImportJob.update({
        where: { id: job.id },
        data: { status: 'failed', finishedAt, error: detail },
      });
    });
  }

  /** Al arrancar o al apagar: los trabajos `running` no pueden continuar. */
  interruptRunning() {
    return this.prisma.$transaction(async (tx) => {
      const jobs = await tx.$queryRaw<RunningJobRow[]>`
        SELECT id, snapshot_id AS "snapshotId", request_id AS "requestId"
        FROM estadistica_forms.catalog_import_jobs
        WHERE status = 'running'
        FOR UPDATE`;

      const finishedAt = new Date().toISOString();
      for (const job of jobs) {
        const error = publicError(ErrorCodes.IMPORT_INTERRUPTED, {
          requestId: job.requestId,
        });
        await tx.catalogSnapshot.update({
          where: { id: job.snapshotId },
          data: { status: 'failed', rowCount: null, finishedAt, error },
        });
        await tx.catalogImportJob.update({
          where: { id: job.id },
          data: { status: 'failed', finishedAt, error },
        });
      }
      return jobs.length;
    });
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

  /** Bloquea el trabajo y falla si ya no está `running` (por ejemplo, interrumpido). */
  private async lockRunning(tx: Prisma.TransactionClient, id: string) {
    const rows = await tx.$queryRaw<JobStatusRow[]>`
      SELECT status
      FROM estadistica_forms.catalog_import_jobs
      WHERE id = ${id}
      FOR UPDATE`;
    if (rows[0]?.status !== 'running') {
      throw new ImportFailure(ErrorCodes.IMPORT_INTERRUPTED);
    }
  }
}

function toListedImport(row: ListedImportRow) {
  const { jobId, jobStatus, processedRows, error, ...snapshot } = row;
  const job = jobId
    ? { id: jobId, status: jobStatus, processedRows: processedRows ?? 0 }
    : null;
  return { ...snapshot, error: localizeStoredError(error), job };
}

function isActiveJob(row: JobStatusRow | undefined) {
  return row !== undefined && isActiveStatus(row.status);
}

function isActiveStatus(status: string | null) {
  return status !== null && ACTIVE_JOB_STATUSES.includes(status);
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
