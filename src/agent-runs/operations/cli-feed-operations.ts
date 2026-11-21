import { IsUUID } from 'class-validator';
import { apiError } from '../../common/http/api-error.js';
import { ErrorCodes } from '../../common/http/error-codes.js';
import {
  PaginationQueryDto,
  PAGINATION,
} from '../../common/http/pagination.js';
import type { FeedRefreshesService } from '../../feed-refreshes/feed-refreshes.service.js';
import type { FeedsService } from '../../feeds/feeds.service.js';
import type {
  AgentOperation,
  ReadOperation,
  WriteOperation,
} from './agent-operation.js';
import { validateAs } from '../../common/http/validation-options.js';
import { objectSchema } from './operation-inputs.js';

const UUID_SCHEMA = { type: 'string', format: 'uuid' } as const;

class FeedInput {
  @IsUUID()
  feedId!: string;
}

class VersionsInput extends PaginationQueryDto {
  @IsUUID()
  feedId!: string;
}

class RefreshInput extends FeedInput {
  @IsUUID()
  refreshId!: string;
}

class VersionInput extends FeedInput {
  @IsUUID()
  versionId!: string;
}

const FEED_SCHEMA = objectSchema({ feedId: UUID_SCHEMA }, ['feedId']);
const NO_INPUT_SCHEMA = objectSchema({});

export function cliFeedOperations(
  feeds: FeedsService,
  refreshes: FeedRefreshesService,
): AgentOperation[] {
  return [
    createFeed(feeds),
    listVersions(feeds),
    deliveryStatus(feeds),
    feedConfiguration(feeds),
    getRefresh(refreshes),
    refreshFeed(feeds, refreshes),
    republishVersion(feeds),
    disableDelivery(feeds),
  ];
}

function createFeed(
  feeds: FeedsService,
): WriteOperation<Record<string, never>> {
  return {
    name: 'create_feed',
    description:
      'Crea el feed del proyecto. Activa su URL de entrega desde la pestaña Feed.',
    level: 'write',
    permission: 'changeset.approve',
    inputSchema: NO_INPUT_SCHEMA,
    parse: async (input) => {
      if (Object.keys(input).length)
        throw apiError(ErrorCodes.VALIDATION_FAILED);
      return {};
    },
    targetOf: ({ scope }) => ({ projectId: scope.projectId }),
    prepare: async ({ identity, scope }) => {
      const [existing] = await feeds.findAll(identity, scope.projectId);
      if (existing) throw apiError(ErrorCodes.FEED_ALREADY_EXISTS);
      return {
        summary: 'Crear el feed con la entrega pública desactivada.',
        plan: {},
        target: { projectId: scope.projectId },
      };
    },
    confirm: async ({ identity, scope }) => {
      const feed = await feeds.createWithoutDelivery(identity, scope.projectId);
      return { feedId: feed.id, deliveryEnabled: feed.deliveryEnabled };
    },
  };
}

function listVersions(feeds: FeedsService): ReadOperation<VersionsInput> {
  return {
    name: 'list_feed_versions',
    description:
      'Lista versiones publicadas con sus IDs, exportaciones y evaluaciones. Usa el cursor para continuar.',
    level: 'read',
    permission: 'organization.read',
    inputSchema: objectSchema(
      {
        feedId: UUID_SCHEMA,
        limit: { type: 'integer', minimum: 1, maximum: PAGINATION.maxLimit },
        cursor: UUID_SCHEMA,
      },
      ['feedId'],
    ),
    parse: (input) => validateAs(VersionsInput, input),
    targetOf: (_context, { feedId }) => ({ feedId }),
    execute: ({ identity, scope }, { feedId, ...page }) =>
      feeds.listVersions(identity, scope.projectId, feedId, page),
  };
}

function deliveryStatus(feeds: FeedsService): ReadOperation<FeedInput> {
  return {
    name: 'get_feed_delivery_status',
    description:
      'Comprueba la entrega pública y explica si falta una versión, está desactivada o el TSV no está disponible.',
    level: 'read',
    permission: 'organization.read',
    inputSchema: FEED_SCHEMA,
    parse: (input) => validateAs(FeedInput, input),
    targetOf: (_context, { feedId }) => ({ feedId }),
    execute: ({ identity, scope }, { feedId }) =>
      feeds.deliveryStatus(identity, scope.projectId, feedId),
  };
}

function feedConfiguration(feeds: FeedsService): ReadOperation<FeedInput> {
  return {
    name: 'get_feed_configuration',
    description:
      'Consulta la fuente, la política aprobada y el horario de un feed.',
    level: 'read',
    permission: 'organization.read',
    inputSchema: FEED_SCHEMA,
    parse: (input) => validateAs(FeedInput, input),
    targetOf: (_context, { feedId }) => ({ feedId }),
    execute: async ({ identity, scope }, { feedId }) => {
      const { source, policy, schedule } = await feeds.findOne(
        identity,
        scope.projectId,
        feedId,
      );
      return { feedId, source, policy, schedule };
    },
  };
}

function getRefresh(
  refreshes: FeedRefreshesService,
): ReadOperation<RefreshInput> {
  return {
    name: 'get_feed_refresh',
    description:
      'Consulta el estado, el resultado y los errores de una actualización por su ID.',
    level: 'read',
    permission: 'organization.read',
    inputSchema: objectSchema({ feedId: UUID_SCHEMA, refreshId: UUID_SCHEMA }, [
      'feedId',
      'refreshId',
    ]),
    parse: (input) => validateAs(RefreshInput, input),
    targetOf: (_context, { feedId, refreshId }) => ({ feedId, refreshId }),
    execute: ({ identity, scope }, { feedId, refreshId }) =>
      refreshes.findOne(identity, scope.projectId, feedId, refreshId),
  };
}

function refreshFeed(
  feeds: FeedsService,
  refreshes: FeedRefreshesService,
): WriteOperation<FeedInput> {
  return {
    name: 'refresh_feed',
    description:
      'Actualiza ahora el feed con la fuente y política aprobadas. Consulta el resultado con get_feed_refresh.',
    level: 'write',
    permission: 'worksheet.write',
    inputSchema: FEED_SCHEMA,
    parse: (input) => validateAs(FeedInput, input),
    targetOf: (_context, { feedId }) => ({ feedId }),
    prepare: async ({ identity, scope }, { feedId }) => {
      const feed = await feeds.findOne(identity, scope.projectId, feedId);
      if (!feed.source) throw apiError(ErrorCodes.FEED_SOURCE_NOT_CONFIGURED);
      if (!feed.policy) throw apiError(ErrorCodes.FEED_POLICY_NOT_APPROVED);
      return {
        summary:
          'Actualizar el feed ahora. Solo publicará si cumple la política aprobada.',
        plan: { feedId },
        target: { feedId },
      };
    },
    confirm: ({ identity, scope }, plan) =>
      refreshes.trigger(identity, scope.projectId, String(plan.feedId)),
  };
}

function republishVersion(feeds: FeedsService): WriteOperation<VersionInput> {
  return {
    name: 'republish_feed_version',
    description:
      'Vuelve a publicar la exportación de una versión histórica. Usa list_feed_versions para obtener el ID.',
    level: 'write',
    permission: 'changeset.approve',
    inputSchema: objectSchema({ feedId: UUID_SCHEMA, versionId: UUID_SCHEMA }, [
      'feedId',
      'versionId',
    ]),
    parse: (input) => validateAs(VersionInput, input),
    targetOf: (_context, { feedId, versionId }) => ({ feedId, versionId }),
    prepare: async ({ identity, scope }, { feedId, versionId }) => {
      const feed = await feeds.findOne(identity, scope.projectId, feedId);
      const version = await feeds.findVersion(
        identity,
        scope.projectId,
        feedId,
        versionId,
      );
      return {
        summary: `Volver a publicar la versión del ${version.publishedAt} con ${version.rowCount} productos.`,
        plan: {
          feedId,
          exportId: version.exportId,
          expectedGeneration: feed.generation,
        },
        target: { feedId, versionId },
      };
    },
    confirm: async ({ identity, scope }, plan) => {
      const { feed, published } = await feeds.publish(
        identity,
        scope.projectId,
        String(plan.feedId),
        {
          exportId: String(plan.exportId),
          expectedGeneration: Number(plan.expectedGeneration),
        },
      );
      return {
        feedId: feed.id,
        generation: feed.generation,
        versionId: feed.publishedVersion?.id ?? null,
        published,
      };
    },
  };
}

function disableDelivery(feeds: FeedsService): WriteOperation<FeedInput> {
  return {
    name: 'disable_feed_delivery',
    description:
      'Desactiva la entrega pública a Merchant Center. Para activarla, crea una URL en la pestaña Feed.',
    level: 'write',
    permission: 'changeset.approve',
    inputSchema: FEED_SCHEMA,
    parse: (input) => validateAs(FeedInput, input),
    targetOf: (_context, { feedId }) => ({ feedId }),
    prepare: async ({ identity, scope }, { feedId }) => {
      await feeds.findOne(identity, scope.projectId, feedId);
      return {
        summary:
          'Desactivar la URL pública del feed. Merchant Center dejará de poder descargarla.',
        plan: { feedId },
        target: { feedId },
      };
    },
    confirm: async ({ identity, scope }, plan) => {
      const feedId = String(plan.feedId);
      await feeds.disableDelivery(identity, scope.projectId, feedId);
      return { feedId, deliveryEnabled: false };
    },
  };
}
