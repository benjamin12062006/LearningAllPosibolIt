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
import { ArtifactStore } from '../artifacts/artifact.store.js';
import { OutboxRelay } from '../outbox/outbox.relay.js';
import { UsersService } from '../users/users.service.js';
import {
  CatalogImportRepository,
  type AcceptanceRecorder,
} from './catalog-import.repository.js';
import { CatalogImportWorker } from './catalog-import.worker.js';
import type {
  Acceptance,
  DeletedImport,
  ImportDelimiter,
  StoredUpload,
} from './import.types.js';

type AcceptedUpload = StoredUpload & { originalname: string };
type ImportFields = { idColumn: string; delimiter: ImportDelimiter };

/**
 * Ids que quien llama ya guardó antes de aceptar (la actualización del feed, D9
 * de feeds&publications): si su proceso cae entre medias, al reintentar ve que
 * el snapshot existe y no lo acepta dos veces.
 */
export type PlannedImportIds = { snapshotId: string; jobId: string };

const MAX_ORIGINAL_NAME_LENGTH = 180;

@Injectable()
export class CatalogImportService {
  private readonly logger = new Logger(CatalogImportService.name);

  constructor(
    private readonly repository: CatalogImportRepository,
    private readonly store: ArtifactStore,
    private readonly worker: CatalogImportWorker,
    private readonly users: UsersService,
    private readonly outbox: OutboxRelay,
  ) {}

  /**
   * Acepta un CSV ya recibido: lo guarda como artefacto, registra el snapshot y
   * su trabajo en cola y avisa al worker. El procesamiento es asíncrono. Sin
   * `plannedIds`, los ids se generan aquí. `recordSource` guarda algo más en la
   * misma transacción (la procedencia de un snapshot que viene de una hoja).
   */
  async accept(
    ownerId: string,
    projectId: string,
    upload: AcceptedUpload,
    fields: ImportFields,
    requestId: string,
    plannedIds?: PlannedImportIds,
    recordSource?: AcceptanceRecorder,
  ) {
    const acceptance = buildAcceptance(
      ownerId,
      projectId,
      upload,
      fields,
      requestId,
      plannedIds,
    );

    await this.moveToArtifacts(upload, acceptance);
    await this.recordAcceptance(acceptance, recordSource);
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

  /**
   * Borra una importación terminada. La misma transacción deja sus archivos en
   * el outbox; después se entregan (plan jobs&files, D9).
   */
  async deleteImport(
    identity: AuthenticatedIdentity,
    projectId: string,
    snapshotId: string,
  ) {
    const owner = await this.users.findCurrent(identity);
    await this.repository.deleteSnapshot(owner.id, projectId, snapshotId);
    await this.deliverDeletedFiles();
  }

  /**
   * Borra el proyecto con todas sus importaciones y su feed. La misma
   * transacción deja sus archivos en el outbox; después se entregan.
   */
  async deleteProject(identity: AuthenticatedIdentity, projectId: string) {
    const owner = await this.users.findCurrent(identity);
    await this.repository.deleteProject(owner.id, projectId);
    await this.deliverDeletedFiles();
  }

  private async moveToArtifacts(upload: StoredUpload, acceptance: Acceptance) {
    try {
      await this.store.finalize(upload.filename, acceptance.artifactKey);
    } catch {
      throw apiError(ErrorCodes.IMPORT_STORAGE_UNAVAILABLE);
    }
  }

  private async recordAcceptance(
    acceptance: Acceptance,
    recordSource?: AcceptanceRecorder,
  ) {
    try {
      await (recordSource
        ? this.repository.accept(acceptance, recordSource)
        : this.repository.accept(acceptance));
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
   * El borrado ya está confirmado y sus archivos, en el outbox. Normalmente se
   * borran aquí, antes de responder; si falla, el borrado no se deshace: el
   * evento sigue pendiente y el relay lo reintenta en sus pasadas.
   */
  private async deliverDeletedFiles() {
    try {
      await this.outbox.deliverNow();
    } catch {
      this.logger.error({ code: 'OUTBOX_DELIVERY_DEFERRED' });
    }
  }

  /** Si el archivo no se puede borrar, queda sin referencia y se registra. */
  private async removeArtifactOrLog(
    item: Pick<DeletedImport, 'snapshotId' | 'artifactKey'>,
  ) {
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
  plannedIds: PlannedImportIds = {
    snapshotId: randomUUID(),
    jobId: randomUUID(),
  },
): Acceptance {
  return {
    snapshotId: plannedIds.snapshotId,
    jobId: plannedIds.jobId,
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
