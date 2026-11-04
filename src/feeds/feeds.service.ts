import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ArtifactStore, isMissingFile } from '../artifacts/artifact.store.js';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import {
  fetchWindow,
  resolvePage,
  toPage,
  type PageRequest,
} from '../common/http/pagination.js';
import { ProjectsService } from '../projects/projects.service.js';
import { UsersService } from '../users/users.service.js';
import { ENGINE_VERSION } from '../evaluations/engine/evaluate-row.js';
import { PROFILE_VERSION } from '../evaluations/engine/google-merchant.profile.js';
import { createDeliveryToken, deliveryUrlOf } from './delivery-token.js';
import type {
  ApproveFeedPolicyDto,
  PublishFeedDto,
  UpdateFeedScheduleDto,
  UpdateFeedSourceDto,
} from './feeds.dto.js';
import { FeedsRepository } from './feeds.repository.js';
import {
  FEED_OPTIONS,
  type ExportToPublish,
  type FeedOptions,
  type FeedView,
  type PublicationConfirmation,
  type PublishedBy,
} from './feeds.types.js';

type Publication = Readonly<{ feed: FeedView; published: boolean }>;

@Injectable()
export class FeedsService {
  private readonly logger = new Logger(FeedsService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly projectsService: ProjectsService,
    private readonly repository: FeedsRepository,
    private readonly store: ArtifactStore,
    @Inject(FEED_OPTIONS)
    private readonly options: FeedOptions,
  ) {}

  /**
   * Crea el feed del proyecto con la entrega activa. La URL con el token solo se
   * devuelve aquí: la base guarda su hash (D7).
   */
  async create(identity: AuthenticatedIdentity, projectId: string) {
    await this.ownerOf(identity, projectId);
    const delivery = createDeliveryToken();

    const feed = await this.repository.create({
      id: randomUUID(),
      projectId,
      deliveryTokenHash: delivery.hash,
      createdAt: new Date().toISOString(),
    });
    if (!feed) {
      throw apiError(ErrorCodes.FEED_ALREADY_EXISTS);
    }
    return { feed, deliveryUrl: deliveryUrlOf(delivery.token) };
  }

  async findAll(identity: AuthenticatedIdentity, projectId: string) {
    const ownerId = await this.ownerOf(identity, projectId);
    return this.repository.findAllByOwner(ownerId, projectId);
  }

  async findOne(
    identity: AuthenticatedIdentity,
    projectId: string,
    feedId: string,
  ) {
    const ownerId = await this.ownerOf(identity, projectId);
    return this.requireFeed(ownerId, projectId, feedId);
  }

  /** Historial de versiones publicadas, paginado (D12). */
  async listVersions(
    identity: AuthenticatedIdentity,
    projectId: string,
    feedId: string,
    query?: Partial<PageRequest>,
  ) {
    const ownerId = await this.ownerOf(identity, projectId);
    await this.requireFeed(ownerId, projectId, feedId);
    const page = resolvePage(query);
    const rows = await this.repository.listVersions(feedId, fetchWindow(page));
    const { items, page: pageInfo } = toPage(rows, page);
    return { versions: items, page: pageInfo };
  }

  /**
   * Publica una exportación del proyecto (D6). Si la generación ya no es la que
   * vio el operador, `409`. Si el TSV es el que ya está publicado, no crea otra
   * versión (`published: false`).
   */
  async publish(
    identity: AuthenticatedIdentity,
    projectId: string,
    feedId: string,
    input: PublishFeedDto,
  ): Promise<Publication> {
    const ownerId = await this.ownerOf(identity, projectId);
    const feed = await this.requireFeed(ownerId, projectId, feedId);
    const source = await this.requireExport(ownerId, projectId, input.exportId);

    if (feed.generation !== input.expectedGeneration) {
      throw apiError(ErrorCodes.FEED_GENERATION_CONFLICT);
    }
    if (isAlreadyPublished(feed, source)) {
      return { feed, published: false };
    }

    const published = await this.linkAndPublish({
      feedId,
      projectId,
      expectedGeneration: input.expectedGeneration,
      source,
      publishedBy: 'operator',
    });
    await this.retireOldFiles(feedId);
    return { feed: published, published: true };
  }

  /**
   * Publicación de la actualización automática (D11): las mismas reglas que la
   * del operador, con el propietario ya resuelto. `confirm` corre dentro de la
   * transacción que mueve el puntero: si el reclamo de la actualización ya no
   * es el vigente, no se publica (D3). Devuelve si publicó o si el TSV ya era el
   * publicado; una generación distinta lanza `FEED_GENERATION_CONFLICT`.
   */
  async publishForRefresh(target: {
    ownerId: string;
    projectId: string;
    feedId: string;
    exportId: string;
    expectedGeneration: number;
    confirm: PublicationConfirmation;
  }): Promise<'published' | 'unchanged'> {
    const { ownerId, projectId, feedId } = target;
    const feed = await this.requireFeed(ownerId, projectId, feedId);
    const source = await this.requireExport(
      ownerId,
      projectId,
      target.exportId,
    );

    if (feed.generation !== target.expectedGeneration) {
      throw apiError(ErrorCodes.FEED_GENERATION_CONFLICT);
    }
    if (isAlreadyPublished(feed, source)) {
      return 'unchanged';
    }

    await this.linkAndPublish(
      {
        feedId,
        projectId,
        expectedGeneration: target.expectedGeneration,
        source,
        publishedBy: 'refresh',
      },
      target.confirm,
    );
    await this.retireOldFiles(feedId);
    return 'published';
  }

  /** Programa la actualización diaria (D10); la encola el worker a su hora. */
  async setSchedule(
    identity: AuthenticatedIdentity,
    projectId: string,
    feedId: string,
    input: UpdateFeedScheduleDto,
  ) {
    const ownerId = await this.ownerOf(identity, projectId);
    const feed = await this.repository.setSchedule({
      ownerId,
      projectId,
      feedId,
      schedule: {
        enabled: input.enabled,
        refreshTime: input.refreshTime,
        timeZone: input.timeZone,
      },
      updatedAt: new Date().toISOString(),
    });
    if (!feed) {
      throw apiError(ErrorCodes.FEED_NOT_FOUND);
    }
    return feed;
  }

  /**
   * Aprueba la política de la actualización automática (D11). Las versiones
   * del motor y del perfil son las vigentes ahora: si cambian, la actualización
   * deja el resultado pendiente de revisión hasta que se reapruebe.
   */
  async approvePolicy(
    identity: AuthenticatedIdentity,
    projectId: string,
    feedId: string,
    input: ApproveFeedPolicyDto,
  ) {
    const ownerId = await this.ownerOf(identity, projectId);
    const revisionExists = await this.repository.rulesetRevisionExists(
      projectId,
      input.rulesetRevision,
    );
    if (!revisionExists) {
      throw apiError(ErrorCodes.RULESET_NOT_FOUND);
    }

    const feed = await this.repository.setPolicy({
      ownerId,
      projectId,
      feedId,
      policy: {
        rulesetRevision: input.rulesetRevision,
        maxInvalid: input.maxInvalid,
        maxExcluded: input.maxExcluded,
        maxDropPercent: input.maxDropPercent,
        engineVersion: ENGINE_VERSION,
        profileVersion: PROFILE_VERSION,
        approvedAt: new Date().toISOString(),
      },
    });
    if (!feed) {
      throw apiError(ErrorCodes.FEED_NOT_FOUND);
    }
    return feed;
  }

  /** Guarda de dónde descargará el feed su CSV (D9); la descarga llega con E4. */
  async setSource(
    identity: AuthenticatedIdentity,
    projectId: string,
    feedId: string,
    input: UpdateFeedSourceDto,
  ) {
    const ownerId = await this.ownerOf(identity, projectId);
    const feed = await this.repository.setSource({
      ownerId,
      projectId,
      feedId,
      source: {
        url: input.url,
        idColumn: input.idColumn,
        delimiter: input.delimiter,
      },
      updatedAt: new Date().toISOString(),
    });
    if (!feed) {
      throw apiError(ErrorCodes.FEED_NOT_FOUND);
    }
    return feed;
  }

  /** Token nuevo: el anterior deja de valer al instante. La URL solo se muestra aquí. */
  async rotateDeliveryToken(
    identity: AuthenticatedIdentity,
    projectId: string,
    feedId: string,
  ) {
    const ownerId = await this.ownerOf(identity, projectId);
    const delivery = createDeliveryToken();
    const feed = await this.setDeliveryTokenHash(
      ownerId,
      projectId,
      feedId,
      delivery.hash,
    );
    return { feed, deliveryUrl: deliveryUrlOf(delivery.token) };
  }

  /** La URL pública responde 404 hasta que se rote un token nuevo. */
  async disableDelivery(
    identity: AuthenticatedIdentity,
    projectId: string,
    feedId: string,
  ) {
    const ownerId = await this.ownerOf(identity, projectId);
    await this.setDeliveryTokenHash(ownerId, projectId, feedId, null);
  }

  /**
   * El usuario actual, después de comprobar que el proyecto es suyo: si no lo
   * es, `findOwned` responde 404 antes de buscar nada más.
   */
  private async ownerOf(identity: AuthenticatedIdentity, projectId: string) {
    const owner = await this.usersService.findCurrent(identity);
    await this.projectsService.findOwned(identity, projectId);
    return owner.id;
  }

  private async requireFeed(
    ownerId: string,
    projectId: string,
    feedId: string,
  ) {
    const feed = await this.repository.findByOwner(ownerId, projectId, feedId);
    if (!feed) {
      throw apiError(ErrorCodes.FEED_NOT_FOUND);
    }
    return feed;
  }

  private async setDeliveryTokenHash(
    ownerId: string,
    projectId: string,
    feedId: string,
    tokenHash: string | null,
  ) {
    const feed = await this.repository.setDeliveryTokenHash({
      ownerId,
      projectId,
      feedId,
      tokenHash,
      updatedAt: new Date().toISOString(),
    });
    if (!feed) {
      throw apiError(ErrorCodes.FEED_NOT_FOUND);
    }
    return feed;
  }

  private async requireExport(
    ownerId: string,
    projectId: string,
    exportId: string,
  ) {
    const source = await this.repository.findExportToPublish(
      ownerId,
      projectId,
      exportId,
    );
    if (!source) {
      throw apiError(ErrorCodes.EXPORT_NOT_FOUND);
    }
    return source;
  }

  /**
   * El archivo de la versión se enlaza y verifica antes de la transacción. Si la
   * versión no se guarda (conflicto, exportación borrada…), nadie lo referencia
   * y se borra.
   */
  private async linkAndPublish(
    target: {
      feedId: string;
      projectId: string;
      expectedGeneration: number;
      source: ExportToPublish;
      publishedBy: PublishedBy;
    },
    confirm?: PublicationConfirmation,
  ) {
    const versionId = randomUUID();
    const file = await this.linkFile(target.source, `${versionId}.tsv`);

    try {
      return await this.repository.publish(
        {
          ...target,
          id: versionId,
          file,
          createdAt: new Date().toISOString(),
        },
        confirm,
      );
    } catch (error) {
      await this.discardFile(file.key);
      throw error;
    }
  }

  /**
   * La fila de la exportación existe pero su archivo no: es un fallo del
   * almacenamiento, no del cliente. Se registra sin datos del catálogo y `503`,
   * como al descargar la exportación.
   */
  private async linkFile(source: ExportToPublish, versionKey: string) {
    try {
      return await this.store.linkFeedVersion(source.artifactKey, versionKey, {
        byteSize: source.byteSize,
        checksum: source.tsvChecksum,
      });
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
      this.logger.error({ code: 'EXPORT_FILE_MISSING', exportId: source.id });
      throw apiError(ErrorCodes.EXPORT_FILE_UNAVAILABLE);
    }
  }

  /**
   * La publicación ya está confirmada: si la retención falla, los archivos
   * antiguos siguen en disco hasta la próxima publicación, sin afectar a nadie.
   */
  private async retireOldFiles(feedId: string) {
    let retired: string[];
    try {
      retired = await this.repository.retireOldFiles(
        feedId,
        this.options.retainedFiles,
      );
    } catch {
      this.logger.error({ code: 'FEED_RETENTION_FAILED', feedId });
      return;
    }
    for (const key of retired) {
      await this.discardFile(key);
    }
  }

  /** Si no se puede borrar, queda sin referencia y lo retira la limpieza al arrancar. */
  private async discardFile(key: string) {
    try {
      await this.store.removeFeedVersion(key);
    } catch {
      this.logger.error({ code: 'FEED_FILE_DISCARD_FAILED' });
    }
  }
}

/** Mismo contenido que la versión vigente: publicarlo no cambiaría nada. */
function isAlreadyPublished(feed: FeedView, source: ExportToPublish) {
  return feed.publishedVersion?.tsvChecksum === source.tsvChecksum;
}
