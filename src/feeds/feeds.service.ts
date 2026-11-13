import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
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
import { OutboxRelay } from '../outbox/outbox.relay.js';
import type { OrganizationPermission } from '../organizations/organization-roles.js';
import { ProjectsService } from '../projects/projects.service.js';
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
  type DeliveryBlock,
  type DeliveryStatus,
  type ExportToPublish,
  type FeedOptions,
  type FeedVersionView,
  type FeedView,
  type PublicationConfirmation,
  type PublishedBy,
} from './feeds.types.js';

type Publication = Readonly<{ feed: FeedView; published: boolean }>;

/** El TSV de una versión, ya abierto, y cuántos productos lleva. */
export type VersionDownload = Readonly<{ content: Readable; rowCount: number }>;

@Injectable()
export class FeedsService {
  private readonly logger = new Logger(FeedsService.name);

  constructor(
    private readonly projectsService: ProjectsService,
    private readonly repository: FeedsRepository,
    private readonly store: ArtifactStore,
    private readonly outbox: OutboxRelay,
    @Inject(FEED_OPTIONS)
    private readonly options: FeedOptions,
  ) {}

  /**
   * Crea el feed del proyecto con la entrega activa. La URL con el token solo se
   * devuelve aquí: la base guarda su hash (D7).
   */
  async create(identity: AuthenticatedIdentity, projectId: string) {
    await this.actorFor(identity, projectId, 'changeset.approve');
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
    const ownerId = await this.actorFor(
      identity,
      projectId,
      'organization.read',
    );
    return this.repository.findAllByOwner(ownerId, projectId);
  }

  async findOne(
    identity: AuthenticatedIdentity,
    projectId: string,
    feedId: string,
  ) {
    const ownerId = await this.actorFor(
      identity,
      projectId,
      'organization.read',
    );
    return this.requireFeed(ownerId, projectId, feedId);
  }

  /** Historial de versiones publicadas, paginado (D12). */
  async listVersions(
    identity: AuthenticatedIdentity,
    projectId: string,
    feedId: string,
    query?: Partial<PageRequest>,
  ) {
    const ownerId = await this.actorFor(
      identity,
      projectId,
      'organization.read',
    );
    await this.requireFeed(ownerId, projectId, feedId);
    const page = resolvePage(query);
    const rows = await this.repository.listVersions(feedId, fetchWindow(page));
    const { items, page: pageInfo } = toPage(rows, page);
    return { versions: items, page: pageInfo };
  }

  /** Una versión del historial, para saber de dónde sale lo que enseña el visor. */
  async findVersion(
    identity: AuthenticatedIdentity,
    projectId: string,
    feedId: string,
    versionId: string,
  ): Promise<FeedVersionView> {
    const ownerId = await this.actorFor(
      identity,
      projectId,
      'organization.read',
    );
    await this.requireFeed(ownerId, projectId, feedId);
    const version = await this.repository.findVersion(feedId, versionId);
    if (!version) {
      throw apiError(ErrorCodes.FEED_VERSION_NOT_FOUND);
    }
    return version;
  }

  /**
   * Si la URL pública entrega el TSV y, si no, por qué (plan 02 de cierre, P3).
   * Hace la misma comprobación que la entrega, sin el token.
   */
  async deliveryStatus(
    identity: AuthenticatedIdentity,
    projectId: string,
    feedId: string,
  ): Promise<DeliveryStatus> {
    const ownerId = await this.actorFor(
      identity,
      projectId,
      'organization.read',
    );
    const feed = await this.requireFeed(ownerId, projectId, feedId);
    const reason = await this.deliveryBlockOf(feed);
    return {
      delivering: reason === null,
      reason,
      deliveryEnabled: feed.deliveryEnabled,
      publishedVersion: feed.publishedVersion,
    };
  }

  /**
   * El TSV de una versión del historial para el visor (plan E6, D1). Una versión
   * de otro feed responde 404, como lo ajeno; si la retención ya retiró su
   * archivo, 410.
   */
  async openVersionFile(
    identity: AuthenticatedIdentity,
    projectId: string,
    feedId: string,
    versionId: string,
  ): Promise<VersionDownload> {
    const ownerId = await this.actorFor(
      identity,
      projectId,
      'organization.read',
    );
    await this.requireFeed(ownerId, projectId, feedId);

    const file = await this.repository.findVersionFile(feedId, versionId);
    if (!file) {
      throw apiError(ErrorCodes.FEED_VERSION_NOT_FOUND);
    }
    if (file.artifactKey === null) {
      throw apiError(ErrorCodes.FEED_VERSION_FILE_RETIRED);
    }
    return {
      content: await this.openVersion(versionId, file.artifactKey),
      rowCount: file.rowCount,
    };
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
    const ownerId = await this.actorFor(
      identity,
      projectId,
      'changeset.approve',
    );
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
    const ownerId = await this.actorFor(
      identity,
      projectId,
      'changeset.approve',
    );
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
    const ownerId = await this.actorFor(
      identity,
      projectId,
      'changeset.approve',
    );
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
    const ownerId = await this.actorFor(
      identity,
      projectId,
      'changeset.approve',
    );
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
    const ownerId = await this.actorFor(
      identity,
      projectId,
      'changeset.approve',
    );
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
    const ownerId = await this.actorFor(
      identity,
      projectId,
      'changeset.approve',
    );
    await this.setDeliveryTokenHash(ownerId, projectId, feedId, null);
  }

  /**
   * Quien actúa, después de comprobar su acceso al proyecto (C6): si no es
   * miembro, 404 antes de buscar nada más; sin el permiso, 403. Leer es de
   * cualquier miembro; crear, publicar y configurar el feed, de Manager o más.
   */
  private async actorFor(
    identity: AuthenticatedIdentity,
    projectId: string,
    permission: OrganizationPermission,
  ) {
    const { actorId } = await this.projectsService.requireAccess(
      identity,
      projectId,
      permission,
    );
    return actorId;
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
   * Los retirados quedan en el outbox en la misma transacción y se entregan
   * aquí (plan jobs&files, D9).
   */
  private async retireOldFiles(feedId: string) {
    try {
      await this.repository.retireOldFiles(feedId, this.options.retainedFiles);
    } catch {
      this.logger.error({ code: 'FEED_RETENTION_FAILED', feedId });
      return;
    }
    await this.deliverRetiredFiles();
  }

  /** Si falla, el evento sigue pendiente y el relay lo reintenta. */
  private async deliverRetiredFiles() {
    try {
      await this.outbox.deliverNow();
    } catch {
      this.logger.error({ code: 'OUTBOX_DELIVERY_DEFERRED' });
    }
  }

  /** El primer motivo por el que la URL pública no entregaría; nulo si entrega. */
  private async deliveryBlockOf(feed: FeedView): Promise<DeliveryBlock | null> {
    if (!feed.publishedVersion) {
      return 'no_published_version';
    }
    if (!feed.deliveryEnabled) {
      return 'delivery_disabled';
    }
    const hasFile = await this.hasReadableFile(
      feed.id,
      feed.publishedVersion.id,
    );
    return hasFile ? null : 'file_unavailable';
  }

  /** Abre y cierra el archivo: es lo que haría la entrega con la primera petición. */
  private async hasReadableFile(feedId: string, versionId: string) {
    const file = await this.repository.findVersionFile(feedId, versionId);
    if (!file?.artifactKey) {
      return false;
    }
    try {
      const content = await this.store.openFeedVersion(file.artifactKey);
      content.destroy();
      return true;
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
      return false;
    }
  }

  /**
   * Abre antes de responder, como la entrega pública. La fila existe pero el
   * archivo no: fallo del almacenamiento, `503`.
   */
  private async openVersion(versionId: string, key: string) {
    try {
      return await this.store.openFeedVersion(key);
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
      this.logger.error({ code: 'FEED_FILE_MISSING', versionId });
      throw apiError(ErrorCodes.FEED_FILE_UNAVAILABLE);
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
