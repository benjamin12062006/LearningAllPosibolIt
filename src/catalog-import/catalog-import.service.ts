import { HttpException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
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
import type {
  Acceptance,
  DeletedImport,
  ImportDelimiter,
  StoredUpload,
} from './import.types.js';

type AcceptedUpload = StoredUpload & { originalname: string };
type ImportFields = { idColumn: string; delimiter: ImportDelimiter };

const MAX_ORIGINAL_NAME_LENGTH = 180;

@Injectable()
export class CatalogImportService {
  private readonly logger = new Logger(CatalogImportService.name);

  constructor(
    private readonly repository: CatalogImportRepository,
    private readonly store: ArtifactStore,
    private readonly worker: CatalogImportWorker,
    private readonly users: UsersService,
  ) {}

  /**
   * Acepta un CSV ya recibido: lo guarda como artefacto, registra el snapshot y
   * su trabajo en cola y avisa al worker. El procesamiento es asíncrono.
   */
  async accept(
    ownerId: string,
    projectId: string,
    upload: AcceptedUpload,
    fields: ImportFields,
    requestId: string,
  ) {
    const acceptance = buildAcceptance(
      ownerId,
      projectId,
      upload,
      fields,
      requestId,
    );

    await this.moveToArtifacts(upload, acceptance);
    await this.recordAcceptance(acceptance);
    this.worker.wake();

    return {
      snapshotId: acceptance.snapshotId,
      jobId: acceptance.jobId,
      status: 'queued' as const,
      statusUrl: `/api/v1/projects/${projectId}/jobs/${acceptance.jobId}`,
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
    const { items, page: pageInfo } = toPage(rows, page);
    return { imports: items, page: pageInfo };
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

  /** Borra una importación terminada y después su archivo. */
  async deleteImport(
    identity: AuthenticatedIdentity,
    projectId: string,
    snapshotId: string,
  ) {
    const owner = await this.users.findCurrent(identity);
    const deleted = await this.repository.deleteSnapshot(
      owner.id,
      projectId,
      snapshotId,
    );
    await this.removeDeletedArtifacts([deleted]);
  }

  /** Borra el proyecto con todas sus importaciones y después sus archivos. */
  async deleteProject(identity: AuthenticatedIdentity, projectId: string) {
    const owner = await this.users.findCurrent(identity);
    const deleted = await this.repository.deleteProject(owner.id, projectId);
    await this.removeDeletedArtifacts(deleted);
  }

  private async moveToArtifacts(upload: StoredUpload, acceptance: Acceptance) {
    try {
      await this.store.finalize(upload.filename, acceptance.artifactKey);
    } catch {
      throw apiError(ErrorCodes.IMPORT_STORAGE_UNAVAILABLE);
    }
  }

  private async recordAcceptance(acceptance: Acceptance) {
    try {
      await this.repository.accept(acceptance);
    } catch (error) {
      await this.recoverFromFailedAcceptance(acceptance, error);
    }
  }

  /**
   * Un error al confirmar no garantiza que la base no guardara la aceptación
   * (la respuesta del commit puede perderse). Solo si es seguro que no existe, se
   * retira el artefacto y se informa del error.
   */
  private async recoverFromFailedAcceptance(
    acceptance: Acceptance,
    error: unknown,
  ) {
    const accepted = await this.checkAcceptanceExists(acceptance);
    if (accepted) {
      return;
    }

    await this.removeArtifactOrLog(acceptance);
    if (error instanceof HttpException) {
      throw error;
    }
    throw apiError(ErrorCodes.IMPORT_DATABASE_UNAVAILABLE);
  }

  private async checkAcceptanceExists(acceptance: Acceptance) {
    try {
      return await this.repository.acceptanceExists(acceptance);
    } catch {
      this.logger.error({
        code: ErrorCodes.IMPORT_ACCEPTANCE_UNCERTAIN,
        snapshotId: acceptance.snapshotId,
        jobId: acceptance.jobId,
      });
      throw apiError(ErrorCodes.IMPORT_ACCEPTANCE_UNCERTAIN);
    }
  }

  /**
   * La base ya confirmó el borrado. Si un archivo no se puede retirar, el
   * borrado no se deshace: el archivo queda sin referencia y lo retira
   * `ArtifactCleanupService` en el siguiente arranque.
   */
  private async removeDeletedArtifacts(deleted: DeletedImport[]) {
    for (const item of deleted) {
      await this.removeArtifactOrLog(item);
    }
  }

  /** Si el archivo no se puede borrar, queda sin referencia y se registra. */
  private async removeArtifactOrLog(item: DeletedImport) {
    try {
      await this.store.removeArtifact(item.artifactKey);
    } catch {
      this.logger.error({
        code: 'IMPORT_ORPHAN_RETAINED',
        snapshotId: item.snapshotId,
      });
    }
  }
}

function buildAcceptance(
  ownerId: string,
  projectId: string,
  upload: AcceptedUpload,
  fields: ImportFields,
  requestId: string,
): Acceptance {
  return {
    snapshotId: randomUUID(),
    jobId: randomUUID(),
    artifactKey: `${randomUUID()}.csv`,
    ownerId,
    projectId,
    sourceHash: upload.hash,
    byteSize: upload.size,
    originalName: safeOriginalName(upload.originalname),
    ...fields,
    requestId,
  };
}

/** Nombre del archivo apto para mostrar: sin caracteres de control ni barras. */
function safeOriginalName(name: string) {
  const characters = Array.from(name, (character) =>
    isUnsafeFileNameCharacter(character) ? '_' : character,
  );
  return characters.slice(0, MAX_ORIGINAL_NAME_LENGTH).join('');
}

function isUnsafeFileNameCharacter(character: string) {
  const code = character.charCodeAt(0);
  const isControlCharacter = code < 32 || code === 127;
  return isControlCharacter || character === '/' || character === '\\';
}
