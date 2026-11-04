import { Injectable, Logger } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { ArtifactStore, isMissingFile } from '../artifacts/artifact.store.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { hashDeliveryToken } from './delivery-token.js';
import {
  entityTagOf,
  isNotModified,
  tokenFromFileName,
} from './feed-delivery.js';
import { FeedsRepository } from './feeds.repository.js';
import type { DeliveryFile } from './feeds.types.js';

/** Lo que responde la URL pública: el TSV ya abierto, o `304` sin cuerpo. */
export type FeedDelivery =
  | Readonly<{ status: 'not-modified'; entityTag: string }>
  | Readonly<{
      status: 'file';
      entityTag: string;
      content: Readable;
      byteSize: number;
    }>;

/**
 * Entrega pública del TSV publicado, sin sesión (D7, D8). El token es la única
 * protección: nunca se registra y todos los «no» responden el mismo 404.
 */
@Injectable()
export class FeedDeliveryService {
  private readonly logger = new Logger(FeedDeliveryService.name);

  constructor(
    private readonly repository: FeedsRepository,
    private readonly store: ArtifactStore,
  ) {}

  async open(
    fileName: string,
    ifNoneMatch: string | undefined,
  ): Promise<FeedDelivery> {
    const file = await this.findDeliveryFile(fileName);
    const entityTag = entityTagOf(file.tsvChecksum);

    if (isNotModified(ifNoneMatch, entityTag)) {
      return { status: 'not-modified', entityTag };
    }
    return {
      status: 'file',
      entityTag,
      content: await this.openFile(file),
      byteSize: file.byteSize,
    };
  }

  /** Nombre mal formado, token desconocido, entrega desactivada o sin publicar: 404. */
  private async findDeliveryFile(fileName: string) {
    const token = tokenFromFileName(fileName);
    const file = token
      ? await this.repository.findDeliveryFile(hashDeliveryToken(token))
      : null;
    if (!file) {
      throw apiError(ErrorCodes.FEED_NOT_FOUND);
    }
    return file;
  }

  /**
   * Abre antes de responder (como la descarga de la exportación). Si el archivo
   * de la versión publicada falta, es un fallo del almacenamiento: `503`, con
   * registro del feed y sin el token.
   */
  private async openFile(file: DeliveryFile) {
    if (file.artifactKey) {
      try {
        return await this.store.openFeedVersion(file.artifactKey);
      } catch (error) {
        if (!isMissingFile(error)) {
          throw error;
        }
      }
    }
    this.logger.error({ code: 'FEED_FILE_MISSING', feedId: file.feedId });
    throw apiError(ErrorCodes.FEED_FILE_UNAVAILABLE);
  }
}
