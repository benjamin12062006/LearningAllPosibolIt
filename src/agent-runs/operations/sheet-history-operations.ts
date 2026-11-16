import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { apiError } from '../../common/http/api-error.js';
import { ErrorCodes } from '../../common/http/error-codes.js';
import { validateAs } from '../../common/http/validation-options.js';
import type { ChangesetReview } from '../../changesets/changesets.service.js';
import type { ChangesetsService } from '../../changesets/changesets.service.js';
import {
  CHANGESET_STATUSES,
  type Changeset,
  type ChangesetStatus,
} from '../../changesets/changesets.types.js';
import type { WorksheetExportsService } from '../../worksheet-exports/worksheet-exports.service.js';
import type { WorksheetImportsService } from '../../worksheet-imports/worksheet-imports.service.js';
import type { WorksheetRowsService } from '../../worksheets/worksheet-rows.service.js';
import type { WorksheetsService } from '../../worksheets/worksheets.service.js';
import {
  worksheetOf,
  type OperationContext,
  type ReadOperation,
} from './agent-operation.js';
import { objectSchema } from './operation-inputs.js';

/*
 * Consultar libros, hojas e historial desde el chat (plan 09 del asistente,
 * etapa 1). Todas son lecturas con los servicios de REST: los permisos, los
 * 404 de lo ajeno y las páginas son los mismos que ve la web.
 */

/** Lo que vuelve al modelo cuesta: las listas van más cortas que en REST. */
const AGENT_PAGE = { defaultLimit: 20, maxLimit: 50 } as const;

const HISTORY_KINDS = [
  'revisions',
  'changesets',
  'imports',
  'exports',
] as const;
type HistoryKind = (typeof HISTORY_KINDS)[number];

/** Un borrador que ya terminó no se revisa: su resultado es una revisión. */
const FINISHED_STATUSES: readonly ChangesetStatus[] = ['applied', 'cancelled'];

const UUID_SCHEMA = { type: 'string', format: 'uuid' } as const;
const LIMIT_SCHEMA = {
  type: 'integer',
  minimum: 1,
  maximum: AGENT_PAGE.maxLimit,
} as const;
const OFFSET_SCHEMA = { type: 'integer', minimum: 0 } as const;

// ── Entradas ──

class ListWorkbooksInput {
  @IsOptional()
  @IsBoolean()
  archived?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(AGENT_PAGE.maxLimit)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}

class SheetHistoryInput {
  @IsOptional()
  @IsUUID()
  worksheetId?: string;

  @IsIn(HISTORY_KINDS)
  kind!: HistoryKind;

  @IsOptional()
  @IsIn(CHANGESET_STATUSES)
  status?: ChangesetStatus;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(AGENT_PAGE.maxLimit)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}

class OpenChangesetInput {
  @IsUUID()
  changesetId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(AGENT_PAGE.maxLimit)
  limit?: number;
}

class CompareRevisionsInput {
  @IsOptional()
  @IsUUID()
  worksheetId?: string;

  @IsUUID()
  fromRevisionId!: string;

  @IsOptional()
  @IsUUID()
  toRevisionId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(AGENT_PAGE.maxLimit)
  limit?: number;
}

// ── Operaciones ──

export function listWorkbooksOperation(
  worksheets: WorksheetsService,
): ReadOperation<ListWorkbooksInput> {
  return {
    name: 'list_workbooks',
    description:
      'Libros del proyecto, por páginas. Con archived: true, los archivados.',
    level: 'read',
    permission: 'organization.read',
    inputSchema: objectSchema({
      archived: { type: 'boolean' },
      limit: LIMIT_SCHEMA,
      offset: OFFSET_SCHEMA,
    }),
    parse: (input) => validateAs(ListWorkbooksInput, input),
    targetOf: ({ scope }) => ({ projectId: scope.projectId }),
    execute: async ({ identity, scope }, input) => {
      const { items, page } = await worksheets.findWorkbooks(identity, scope, {
        ...pageOf(input),
        archived: input.archived,
      });
      return {
        workbooks: items.map((workbook) => ({
          id: workbook.id,
          name: workbook.name,
          archived: workbook.archivedAt !== null,
          createdAt: workbook.createdAt,
        })),
        page,
      };
    },
  };
}

export function sheetHistoryOperation(services: {
  worksheets: WorksheetsService;
  changesets: ChangesetsService;
  imports: WorksheetImportsService;
  exports: WorksheetExportsService;
}): ReadOperation<SheetHistoryInput> {
  return {
    name: 'list_sheet_history',
    description:
      'Historial de una hoja por páginas: revisiones, borradores (con status opcional), importaciones o exportaciones. Elige kind.',
    level: 'read',
    permission: 'organization.read',
    inputSchema: objectSchema(
      {
        worksheetId: UUID_SCHEMA,
        kind: { type: 'string', enum: HISTORY_KINDS },
        status: { type: 'string', enum: CHANGESET_STATUSES },
        limit: LIMIT_SCHEMA,
        offset: OFFSET_SCHEMA,
      },
      ['kind'],
    ),
    parse: async (input) => {
      const parsed = await validateAs(SheetHistoryInput, input);
      // El estado solo filtra borradores: en otra lista se ignoraría en silencio.
      if (parsed.status !== undefined && parsed.kind !== 'changesets') {
        throw apiError(ErrorCodes.VALIDATION_FAILED);
      }
      return parsed;
    },
    targetOf: (context, input) => ({
      worksheetId: worksheetOf(context, input.worksheetId),
    }),
    execute: async (context, input) => {
      const worksheetId = worksheetOf(context, input.worksheetId);
      const { items, page } = await historyPage(
        services,
        context,
        worksheetId,
        input,
      );
      return { worksheetId, kind: input.kind, items, page };
    },
  };
}

export function openChangesetOperation(
  changesets: ChangesetsService,
): ReadOperation<OpenChangesetInput> {
  return {
    name: 'open_changeset',
    description:
      'Abre un borrador por su ID: estado, versión, revisión base y vigente, y su revisión (cambios, conflictos y problemas). Uno aplicado o cancelado no tiene revisión: compara su revisión con compare_revisions.',
    level: 'read',
    permission: 'organization.read',
    inputSchema: objectSchema(
      { changesetId: UUID_SCHEMA, limit: LIMIT_SCHEMA },
      ['changesetId'],
    ),
    parse: (input) => validateAs(OpenChangesetInput, input),
    targetOf: (_context, input) => ({ changesetId: input.changesetId }),
    resultTarget: (result) => worksheetTargetOf(result),
    execute: async ({ identity, scope }, input) => {
      const limit = input.limit ?? AGENT_PAGE.defaultLimit;
      const changeset = await changesets.find(
        identity,
        scope,
        input.changesetId,
      );
      const review = isOpen(changeset)
        ? await changesets.review(identity, scope, changeset.id)
        : null;
      return {
        worksheetId: changeset.worksheetId,
        changeset: summaryOf(changeset),
        review: review ? reviewSampleOf(review, limit) : null,
      };
    },
  };
}

export function compareRevisionsOperation(
  rows: WorksheetRowsService,
): ReadOperation<CompareRevisionsInput> {
  return {
    name: 'compare_revisions',
    description:
      'Compara dos revisiones de una hoja (sin toRevisionId, con la vigente): filas añadidas, quitadas y editadas, con una muestra, y cambios de columnas. No es la revisión de un borrador.',
    level: 'read',
    permission: 'organization.read',
    inputSchema: objectSchema(
      {
        worksheetId: UUID_SCHEMA,
        fromRevisionId: UUID_SCHEMA,
        toRevisionId: UUID_SCHEMA,
        limit: LIMIT_SCHEMA,
      },
      ['fromRevisionId'],
    ),
    parse: (input) => validateAs(CompareRevisionsInput, input),
    targetOf: (context, input) => ({
      worksheetId: worksheetOf(context, input.worksheetId),
    }),
    execute: (context, input) =>
      rows.compareRevisions(
        context.identity,
        context.scope,
        worksheetOf(context, input.worksheetId),
        {
          fromRevisionId: input.fromRevisionId,
          toRevisionId: input.toRevisionId,
          limit: input.limit ?? AGENT_PAGE.defaultLimit,
        },
      ),
  };
}

// ── Detalle ──

function historyPage(
  services: Parameters<typeof sheetHistoryOperation>[0],
  { identity, scope }: OperationContext,
  worksheetId: string,
  input: SheetHistoryInput,
) {
  const page = pageOf(input);
  switch (input.kind) {
    case 'revisions':
      return services.worksheets.findRevisions(
        identity,
        scope,
        worksheetId,
        page,
      );
    case 'changesets':
      return services.changesets.findByWorksheet(identity, scope, worksheetId, {
        ...page,
        status: input.status,
      });
    case 'imports':
      return services.imports.findByWorksheet(
        identity,
        scope,
        worksheetId,
        page,
      );
    case 'exports':
      return services.exports.findByWorksheet(
        identity,
        scope,
        worksheetId,
        page,
      );
  }
}

function pageOf(input: { limit?: number; offset?: number }) {
  return {
    limit: input.limit ?? AGENT_PAGE.defaultLimit,
    offset: input.offset ?? 0,
  };
}

function isOpen(changeset: Changeset) {
  return !FINISHED_STATUSES.includes(changeset.status);
}

/** Sin las operaciones, que pueden ser mil: su efecto está en la revisión. */
function summaryOf({ operations, ...changeset }: Changeset) {
  return { ...changeset, operationCount: operations.length };
}

/**
 * Los recuentos son de todo el borrador; los cambios y problemas, una muestra
 * con su total para que la respuesta no diga «todos» viendo solo unos pocos.
 */
function reviewSampleOf(review: ChangesetReview, limit: number) {
  return {
    baseRevisionId: review.baseRevisionId,
    headRevisionId: review.headRevisionId,
    upToDate: review.baseRevisionId === review.headRevisionId,
    contentHash: review.contentHash,
    counts: review.counts,
    resultingRowCount: review.resultingRowCount,
    columnConversions: review.columnConversions,
    entries: sampleOf(review.entries, limit),
    problems: sampleOf(review.problems, limit),
  };
}

function sampleOf<T>(items: readonly T[], limit: number) {
  return {
    total: items.length,
    items: items.slice(0, limit),
    truncated: items.length > limit,
  };
}

function worksheetTargetOf(result: unknown): Record<string, unknown> {
  if (
    result &&
    typeof result === 'object' &&
    'worksheetId' in result &&
    typeof result.worksheetId === 'string'
  ) {
    return { worksheetId: result.worksheetId };
  }
  return {};
}
