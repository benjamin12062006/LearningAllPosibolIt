import { ErrorCodes } from '../common/http/error-codes.js';
import { Injectable } from '@nestjs/common';
import { apiError } from '../common/http/api-error.js';
import {
  localizeStoredError,
  publicError,
} from '../common/http/public-error.js';
import type { PageRequest } from '../common/http/pagination.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  IMPORT_LIMITS,
  ImportFailure,
  type Acceptance,
  type ClaimedImport,
  type ImportError,
  type ImportRow,
} from './import.types.js';

@Injectable()
export class CatalogImportRepository {
  constructor(private readonly prisma: PrismaService) {}

  accept(input: Acceptance) {
    return this.prisma.$transaction(async (tx) => {
      const projects = await tx.$queryRaw<
        {
          country: string | null;
          currency: string | null;
          channelProfile: string | null;
        }[]
      >`
        SELECT country,currency,channel_profile AS "channelProfile" FROM estadistica_forms.projects
        WHERE id=${input.projectId} AND owner_id=${input.ownerId} FOR UPDATE`;
      const project = projects[0];
      if (!project) throw apiError(ErrorCodes.PROJECT_NOT_FOUND);
      if (!project.country || !project.currency || !project.channelProfile)
        throw apiError(ErrorCodes.PROJECT_CONFIGURATION_REQUIRED);
      // La fila del proyecto está bloqueada (FOR UPDATE): dos peticiones
      // simultáneas no pueden pasar esta comprobación a la vez.
      const active = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM estadistica_forms.catalog_import_jobs
        WHERE project_id=${input.projectId} AND status IN ('queued','running') LIMIT 1`;
      if (active[0]) throw apiError(ErrorCodes.IMPORT_ALREADY_ACTIVE);
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

  async hasActiveJob(ownerId: string, projectId: string) {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT j.id FROM estadistica_forms.catalog_import_jobs j
      JOIN estadistica_forms.projects p ON p.id=j.project_id
      WHERE p.id=${projectId} AND p.owner_id=${ownerId} AND j.status IN ('queued','running') LIMIT 1`;
    return rows.length > 0;
  }

  /** Metadatos y estado del trabajo de cada importación; sin la muestra de filas. */
  async listSnapshots(ownerId: string, projectId: string, window: PageRequest) {
    const owned = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM estadistica_forms.projects WHERE id=${projectId} AND owner_id=${ownerId}`;
    if (!owned[0]) throw apiError(ErrorCodes.PROJECT_NOT_FOUND);
    const rows = await this.prisma.$queryRaw<
      {
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
      }[]
    >`SELECT s.id,s.project_id AS "projectId",s.id_column AS "idColumn",s.delimiter,s.byte_size AS "byteSize",
      s.original_name AS "originalName",s.status,s.row_count AS "rowCount",s.created_at AS "createdAt",
      s.finished_at AS "finishedAt",s.error,j.id AS "jobId",j.status AS "jobStatus",j.processed_rows AS "processedRows"
      FROM estadistica_forms.catalog_snapshots s
      LEFT JOIN estadistica_forms.catalog_import_jobs j ON j.snapshot_id=s.id
      WHERE s.project_id=${projectId}
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT ${window.limit} OFFSET ${window.offset}`;
    return rows.map(
      ({ jobId, jobStatus, processedRows, error, ...snapshot }) => ({
        ...snapshot,
        error: localizeStoredError(error),
        job: jobId
          ? { id: jobId, status: jobStatus, processedRows: processedRows ?? 0 }
          : null,
      }),
    );
  }

  async acceptanceExists(input: Acceptance) {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT j.id FROM estadistica_forms.catalog_import_jobs j
      JOIN estadistica_forms.catalog_snapshots s ON s.id=j.snapshot_id AND s.project_id=j.project_id
      JOIN estadistica_forms.projects p ON p.id=s.project_id
      WHERE j.id=${input.jobId} AND s.id=${input.snapshotId} AND p.id=${input.projectId}
        AND p.owner_id=${input.ownerId} AND s.artifact_key=${input.artifactKey}`;
    return rows.length === 1;
  }

  claim(): Promise<ClaimedImport | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<ClaimedImport[]>`
        SELECT j.id,j.snapshot_id AS "snapshotId",j.project_id AS "projectId",j.request_id AS "requestId",
          s.artifact_key AS "artifactKey",s.source_hash AS "sourceHash",s.byte_size AS "byteSize",
          s.id_column AS "idColumn",s.delimiter
        FROM estadistica_forms.catalog_import_jobs j JOIN estadistica_forms.catalog_snapshots s ON s.id=j.snapshot_id
        WHERE j.status='queued' AND s.status='pending' ORDER BY j.created_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`;
      const job = rows[0];
      if (!job) return null;
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

  complete(
    job: ClaimedImport,
    result: { headers: string[]; count: number; hash: string; bytes: number },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockRunning(tx, job.id);
      const count = await tx.catalogRow.count({
        where: { snapshotId: job.snapshotId },
      });
      if (
        count !== result.count ||
        count < 1 ||
        result.hash !== job.sourceHash ||
        result.bytes !== job.byteSize
      )
        throw new ImportFailure(ErrorCodes.IMPORT_INTEGRITY_FAILED);
      const finishedAt = new Date().toISOString();
      await tx.catalogSnapshot.update({
        where: { id: job.snapshotId },
        data: {
          status: 'ready',
          headers: result.headers,
          rowCount: count,
          finishedAt,
        },
      });
      await tx.catalogImportJob.update({
        where: { id: job.id },
        data: { status: 'succeeded', processedRows: count, finishedAt },
      });
    });
  }

  fail(
    job: Pick<ClaimedImport, 'id' | 'snapshotId' | 'requestId'>,
    error: ImportError,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { status: string }[]
      >`SELECT status FROM estadistica_forms.catalog_import_jobs WHERE id=${job.id} FOR UPDATE`;
      if (!rows[0] || !['queued', 'running'].includes(rows[0].status)) return;
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

  interruptRunning() {
    return this.prisma.$transaction(async (tx) => {
      const jobs = await tx.$queryRaw<
        { id: string; snapshotId: string; requestId: string }[]
      >`SELECT id,snapshot_id AS "snapshotId",request_id AS "requestId" FROM estadistica_forms.catalog_import_jobs WHERE status='running' FOR UPDATE`;
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

  async findJob(ownerId: string, projectId: string, id: string) {
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        projectId: string;
        snapshotId: string;
        status: string;
        processedRows: number;
        createdAt: string;
        startedAt: string | null;
        finishedAt: string | null;
        error: unknown;
      }[]
    >`SELECT j.id,j.project_id AS "projectId",j.snapshot_id AS "snapshotId",j.status,j.processed_rows AS "processedRows",
      j.created_at AS "createdAt",j.started_at AS "startedAt",j.finished_at AS "finishedAt",j.error
      FROM estadistica_forms.catalog_import_jobs j JOIN estadistica_forms.projects p ON p.id=j.project_id
      WHERE j.id=${id} AND p.id=${projectId} AND p.owner_id=${ownerId}`;
    if (!rows[0]) throw apiError(ErrorCodes.IMPORT_NOT_FOUND);
    return { ...rows[0], error: localizeStoredError(rows[0].error) };
  }

  async findSnapshot(ownerId: string, projectId: string, id: string) {
    const rows = await this.prisma.$queryRaw<
      {
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
      }[]
    >`SELECT s.id,s.project_id AS "projectId",s.id_column AS "idColumn",s.delimiter,s.headers,
      s.source_hash AS "sourceHash",s.byte_size AS "byteSize",s.original_name AS "originalName",s.status,
      s.row_count AS "rowCount",s.created_at AS "createdAt",s.finished_at AS "finishedAt",s.error
      FROM estadistica_forms.catalog_snapshots s JOIN estadistica_forms.projects p ON p.id=s.project_id
      WHERE s.id=${id} AND p.id=${projectId} AND p.owner_id=${ownerId}`;
    const snapshot = rows[0];
    if (!snapshot) throw apiError(ErrorCodes.IMPORT_NOT_FOUND);
    const sample =
      snapshot.status === 'ready'
        ? await this.prisma.$queryRaw<ImportRow[]>`
      SELECT source_row AS "sourceRow",external_id AS "externalId",original_values AS "originalValues"
      FROM estadistica_forms.catalog_rows WHERE snapshot_id=${id} ORDER BY source_row LIMIT ${IMPORT_LIMITS.sampleRows}`
        : [];
    return {
      snapshot: { ...snapshot, error: localizeStoredError(snapshot.error) },
      sample,
    };
  }

  private async lockRunning(tx: Prisma.TransactionClient, id: string) {
    const rows = await tx.$queryRaw<
      { status: string }[]
    >`SELECT status FROM estadistica_forms.catalog_import_jobs WHERE id=${id} FOR UPDATE`;
    if (rows[0]?.status !== 'running')
      throw new ImportFailure(ErrorCodes.IMPORT_INTERRUPTED);
  }
}
