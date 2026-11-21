import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import type { CatalogImportService } from '../../catalog-import/catalog-import.service.js';
import { apiError } from '../../common/http/api-error.js';
import { ErrorCodes } from '../../common/http/error-codes.js';
import { validateAs } from '../../common/http/validation-options.js';
import {
  ApproveFeedPolicyDto,
  UpdateFeedScheduleDto,
  UpdateFeedSourceDto,
} from '../../feeds/feeds.dto.js';
import type { FeedsService } from '../../feeds/feeds.service.js';
import {
  operationText,
  type AgentOperation,
  type OperationContext,
  type ReadOperation,
  type WriteOperation,
} from './agent-operation.js';
import { objectSchema } from './operation-inputs.js';

/*
 * El catálogo y la configuración del feed, como en sus pantallas (plan 10,
 * D8): listar y borrar importaciones (solo cabe una activa por proyecto y no
 * se borra mientras está en cola) y la fuente, el horario y la política de la
 * actualización automática. Subir un archivo sigue siendo cosa de la web:
 * el chat todavía no admite adjuntos (decisión del usuario, 2026-11-21).
 */

const UUID_SCHEMA = { type: 'string', format: 'uuid' } as const;

type Services = Readonly<{
  imports: CatalogImportService;
  feeds: FeedsService;
}>;

// ── Entradas ──

class PageInput {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}

class SnapshotInput {
  @IsUUID()
  snapshotId!: string;
}

class FeedSourceInput extends UpdateFeedSourceDto {
  @IsOptional()
  @IsUUID()
  feedId?: string;
}

class FeedScheduleInput extends UpdateFeedScheduleDto {
  @IsOptional()
  @IsUUID()
  feedId?: string;
}

class FeedPolicyInput extends ApproveFeedPolicyDto {
  @IsOptional()
  @IsUUID()
  feedId?: string;
}

// ── Operaciones ──

export function catalogFeedOperations(services: Services): AgentOperation[] {
  return [
    listCatalogImports(services),
    deleteCatalogImport(services),
    setFeedSource(services),
    setFeedSchedule(services),
    approveFeedPolicy(services),
  ] as AgentOperation[];
}

function listCatalogImports({ imports }: Services): ReadOperation<PageInput> {
  return {
    name: 'list_catalog_imports',
    description:
      'Importaciones del catálogo, de la más nueva a la más vieja, con su estado (queued y running son trabajos en curso: solo cabe uno por proyecto), filas y columna de ID.',
    level: 'read',
    permission: 'organization.read',
    inputSchema: objectSchema({
      limit: { type: 'integer', minimum: 1, maximum: 50 },
      offset: { type: 'integer', minimum: 0 },
    }),
    parse: (input) => validateAs(PageInput, input),
    targetOf: ({ scope }) => ({ projectId: scope.projectId }),
    execute: ({ identity, scope }, input) =>
      imports.list(identity, scope.projectId, {
        limit: input.limit ?? 20,
        offset: input.offset ?? 0,
      }),
  };
}

function deleteCatalogImport({
  imports,
}: Services): WriteOperation<SnapshotInput> {
  return {
    name: 'delete_catalog_import',
    description:
      'Borra una importación del catálogo terminada o fallida, con sus archivos. Una en cola o en curso (IMPORT_IN_PROGRESS) o con una evaluación en marcha no se puede borrar todavía.',
    level: 'write',
    permission: 'worksheet.write',
    inputSchema: objectSchema({ snapshotId: UUID_SCHEMA }, ['snapshotId']),
    parse: (input) => validateAs(SnapshotInput, input),
    targetOf: (_context, input) => ({ snapshotId: input.snapshotId }),
    prepare: async (context, input) => {
      const { snapshot } = await imports.findSnapshot(
        context.identity,
        context.scope.projectId,
        input.snapshotId,
      );
      return {
        summary: operationText(
          context,
          `Borrar la importación «${snapshot.originalName}» (${snapshot.status}, ${snapshot.rowCount ?? 0} filas).`,
          `Delete the import “${snapshot.originalName}” (${snapshot.status}, ${snapshot.rowCount ?? 0} rows).`,
        ),
        plan: { snapshotId: snapshot.id },
        target: { snapshotId: snapshot.id },
      };
    },
    confirm: async ({ identity, scope }, plan) => {
      await imports.deleteImport(
        identity,
        scope.projectId,
        String(plan.snapshotId),
      );
      return { snapshotId: plan.snapshotId, deleted: true };
    },
  };
}

function setFeedSource({ feeds }: Services): WriteOperation<FeedSourceInput> {
  return {
    name: 'set_feed_source',
    description:
      'Fija de dónde descarga el feed su CSV en la actualización automática: URL https, columna de ID y separador. Por defecto, el feed del proyecto.',
    level: 'write',
    permission: 'changeset.approve',
    inputSchema: objectSchema(
      {
        feedId: UUID_SCHEMA,
        url: { type: 'string', format: 'uri' },
        idColumn: { type: 'string', minLength: 1, maxLength: 128 },
        delimiter: { type: 'string', enum: ['comma', 'semicolon'] },
      },
      ['url', 'idColumn'],
    ),
    parse: (input) => validateAs(FeedSourceInput, input),
    targetOf: (context) => ({ projectId: context.scope.projectId }),
    prepare: async (context, input) => {
      const feedId = await feedOf(feeds, context, input.feedId);
      return {
        summary: operationText(
          context,
          `Descargar el CSV del feed desde ${input.url} (ID en «${input.idColumn}»).`,
          `Download the feed CSV from ${input.url} (ID in “${input.idColumn}”).`,
        ),
        plan: {
          feedId,
          url: input.url,
          idColumn: input.idColumn,
          delimiter: input.delimiter,
        },
        target: { feedId },
      };
    },
    confirm: async ({ identity, scope }, plan) => {
      const { feedId, ...source } = plan;
      const body = await validateAs(UpdateFeedSourceDto, source);
      const feed = await feeds.setSource(
        identity,
        scope.projectId,
        String(feedId),
        body,
      );
      return { feedId: feed.id };
    },
  };
}

function setFeedSchedule({
  feeds,
}: Services): WriteOperation<FeedScheduleInput> {
  return {
    name: 'set_feed_schedule',
    description:
      'Activa o desactiva la actualización diaria del feed y fija su hora (HH:MM) y zona horaria IANA. Por defecto, el feed del proyecto.',
    level: 'write',
    permission: 'changeset.approve',
    inputSchema: objectSchema(
      {
        feedId: UUID_SCHEMA,
        enabled: { type: 'boolean' },
        refreshTime: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
        timeZone: { type: 'string', minLength: 1 },
      },
      ['enabled', 'refreshTime', 'timeZone'],
    ),
    parse: (input) => validateAs(FeedScheduleInput, input),
    targetOf: (context) => ({ projectId: context.scope.projectId }),
    prepare: async (context, input) => {
      const feedId = await feedOf(feeds, context, input.feedId);
      return {
        summary: operationText(
          context,
          input.enabled
            ? `Actualizar el feed cada día a las ${input.refreshTime} (${input.timeZone}).`
            : 'Desactivar la actualización diaria del feed.',
          input.enabled
            ? `Refresh the feed every day at ${input.refreshTime} (${input.timeZone}).`
            : 'Turn off the daily feed refresh.',
        ),
        plan: {
          feedId,
          enabled: input.enabled,
          refreshTime: input.refreshTime,
          timeZone: input.timeZone,
        },
        target: { feedId },
      };
    },
    confirm: async ({ identity, scope }, plan) => {
      const { feedId, ...schedule } = plan;
      const body = await validateAs(UpdateFeedScheduleDto, schedule);
      const feed = await feeds.setSchedule(
        identity,
        scope.projectId,
        String(feedId),
        body,
      );
      return { feedId: feed.id };
    },
  };
}

function approveFeedPolicy({
  feeds,
}: Services): WriteOperation<FeedPolicyInput> {
  return {
    name: 'approve_feed_policy',
    description:
      'Aprueba la política de la actualización automática: revisión de reglas y cuántos inválidos, excluidos y qué caída de productos (%) se aceptan sin revisión. Por defecto, el feed del proyecto.',
    level: 'write',
    permission: 'changeset.approve',
    inputSchema: objectSchema(
      {
        feedId: UUID_SCHEMA,
        rulesetRevision: { type: 'integer', minimum: 1 },
        maxInvalid: { type: 'integer', minimum: 0 },
        maxExcluded: { type: 'integer', minimum: 0 },
        maxDropPercent: { type: 'integer', minimum: 0, maximum: 100 },
      },
      ['rulesetRevision', 'maxInvalid', 'maxExcluded', 'maxDropPercent'],
    ),
    parse: (input) => validateAs(FeedPolicyInput, input),
    targetOf: (context) => ({ projectId: context.scope.projectId }),
    prepare: async (context, input) => {
      const feedId = await feedOf(feeds, context, input.feedId);
      return {
        summary: operationText(
          context,
          `Aprobar la política del feed con la revisión ${input.rulesetRevision} de reglas: hasta ${input.maxInvalid} inválidos, ${input.maxExcluded} excluidos y ${input.maxDropPercent} % de caída.`,
          `Approve the feed policy with ruleset revision ${input.rulesetRevision}: up to ${input.maxInvalid} invalid, ${input.maxExcluded} excluded and a ${input.maxDropPercent}% drop.`,
        ),
        plan: {
          feedId,
          rulesetRevision: input.rulesetRevision,
          maxInvalid: input.maxInvalid,
          maxExcluded: input.maxExcluded,
          maxDropPercent: input.maxDropPercent,
        },
        target: { feedId },
      };
    },
    confirm: async ({ identity, scope }, plan) => {
      const { feedId, ...policy } = plan;
      const body = await validateAs(ApproveFeedPolicyDto, policy);
      const feed = await feeds.approvePolicy(
        identity,
        scope.projectId,
        String(feedId),
        body,
      );
      return { feedId: feed.id };
    },
  };
}

// ── Detalle ──

/** El feed pedido o, si no se indica, el del proyecto (hay uno como mucho). */
async function feedOf(
  feeds: FeedsService,
  { identity, scope }: OperationContext,
  feedId: string | undefined,
): Promise<string> {
  if (feedId) {
    await feeds.findOne(identity, scope.projectId, feedId);
    return feedId;
  }
  const [feed] = await feeds.findAll(identity, scope.projectId);
  if (!feed) {
    throw apiError(ErrorCodes.FEED_NOT_FOUND);
  }
  return feed.id;
}
