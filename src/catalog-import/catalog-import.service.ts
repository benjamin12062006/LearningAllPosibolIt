import { ErrorCodes } from '../common/http/error-codes.js';
import { HttpException, Injectable, Logger } from '@nestjs/common';
import { apiError } from '../common/http/api-error.js';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import {
  fetchWindow,
  resolvePage,
  toPage,
  type PageRequest,
} from '../common/http/pagination.js';
import { UsersService } from '../users/users.service.js';
import { ArtifactStore } from './artifact.store.js';
import { CatalogImportRepository } from './catalog-import.repository.js';
import { CatalogImportWorker } from './catalog-import.worker.js';
import type { Acceptance, StoredUpload } from './import.types.js';

@Injectable()
export class CatalogImportService {
  private readonly logger = new Logger(CatalogImportService.name);
  constructor(
    private readonly repository: CatalogImportRepository,
    private readonly store: ArtifactStore,
    private readonly worker: CatalogImportWorker,
    private readonly users: UsersService,
  ) {}

  async accept(
    ownerId: string,
    projectId: string,
    upload: StoredUpload & { originalname: string },
    fields: { idColumn: string; delimiter: 'comma' | 'semicolon' },
    requestId: string,
  ) {
    const input: Acceptance = {
      snapshotId: randomUUID(),
      jobId: randomUUID(),
      artifactKey: `${randomUUID()}.csv`,
      ownerId,
      projectId,
      sourceHash: upload.hash,
      byteSize: upload.size,
      originalName: Array.from(upload.originalname, (character) =>
        character.charCodeAt(0) < 32 ||
        character.charCodeAt(0) === 127 ||
        character === '/' ||
        character === '\\'
          ? '_'
          : character,
      )
        .slice(0, 180)
        .join(''),
      ...fields,
      requestId,
    };
    try {
      await this.store.finalize(upload.filename, input.artifactKey);
    } catch {
      throw apiError(ErrorCodes.IMPORT_STORAGE_UNAVAILABLE);
    }
    try {
      await this.repository.accept(input);
    } catch (error) {
      let accepted: boolean;
      try {
        accepted = await this.repository.acceptanceExists(input);
      } catch {
        this.logger.error({
          code: ErrorCodes.IMPORT_ACCEPTANCE_UNCERTAIN,
          snapshotId: input.snapshotId,
          jobId: input.jobId,
        });
        throw apiError(ErrorCodes.IMPORT_ACCEPTANCE_UNCERTAIN);
      }
      if (!accepted) {
        try {
          await this.store.removeArtifact(input.artifactKey);
        } catch {
          this.logger.error({
            code: 'IMPORT_ORPHAN_RETAINED',
            snapshotId: input.snapshotId,
          });
        }
        if (error instanceof HttpException) throw error;
        throw apiError(ErrorCodes.IMPORT_DATABASE_UNAVAILABLE);
      }
    }
    this.worker.wake();
    return {
      snapshotId: input.snapshotId,
      jobId: input.jobId,
      status: 'queued' as const,
      statusUrl: `/api/v1/projects/${projectId}/jobs/${input.jobId}`,
    };
  }

  async list(
    identity: AuthenticatedIdentity,
    projectId: string,
    query?: Partial<PageRequest>,
  ) {
    const owner = await this.users.findCurrent(identity);
    const page = resolvePage(query);
    const rows = await this.repository.listSnapshots(
      owner.id,
      projectId,
      fetchWindow(page),
    );
    const { items, page: info } = toPage(rows, page);
    return { imports: items, page: info };
  }

  async findJob(
    identity: AuthenticatedIdentity,
    projectId: string,
    id: string,
  ) {
    const owner = await this.users.findCurrent(identity);
    return { job: await this.repository.findJob(owner.id, projectId, id) };
  }

  async findSnapshot(
    identity: AuthenticatedIdentity,
    projectId: string,
    id: string,
  ) {
    const owner = await this.users.findCurrent(identity);
    return this.repository.findSnapshot(owner.id, projectId, id);
  }
}
