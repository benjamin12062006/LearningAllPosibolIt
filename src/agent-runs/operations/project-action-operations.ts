import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import type { ChangesetsService } from '../../changesets/changesets.service.js';
import type { Changeset } from '../../changesets/changesets.types.js';
import { apiError } from '../../common/http/api-error.js';
import { ErrorCodes } from '../../common/http/error-codes.js';
import { validateAs } from '../../common/http/validation-options.js';
import type { EvaluationsService } from '../../evaluations/evaluations.service.js';
import type { ExportsService } from '../../exports/exports.service.js';
import type { FeedsService } from '../../feeds/feeds.service.js';
import type { SavedViewsService } from '../../worksheets/saved-views.service.js';
import type { WorksheetsService } from '../../worksheets/worksheets.service.js';
import {
  operationText,
  type OperationContext,
  type WriteOperation,
} from './agent-operation.js';
import { objectSchema } from './operation-inputs.js';

/*
 * Lo que antes solo hacía la persona en la web (plan 09, ampliación pedida el
 * 2026-11-15): libros y hojas, aplicar o cancelar borradores, aprobar la
 * exportación y publicar el feed. Siguen siendo escrituras: preparan una
 * propuesta y su confirmación llama al servicio de siempre con la identidad
 * de la persona, así que los permisos por rol, la aprobación entre pares y
 * la auditoría son los de REST. Quién confirma (la persona o la confirmación
 * automática del MCP) lo decide quien llama.
 */

const UUID_SCHEMA = { type: 'string', format: 'uuid' } as const;
const NAME_SCHEMA = { type: 'string', minLength: 1, maxLength: 200 } as const;

/** Un borrador que todavía puede llegar a aplicarse. */
const APPLICABLE_STATUSES = ['draft', 'pending_review', 'approved'] as const;

type Services = Readonly<{
  worksheets: WorksheetsService;
  changesets: ChangesetsService;
  views: SavedViewsService;
  evaluations: EvaluationsService;
  exports: ExportsService;
  feeds: FeedsService;
}>;

// ── Entradas ──

function trim({ value }: { value: unknown }) {
  return typeof value === 'string' ? value.trim() : value;
}

class NameInput {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;
}

class WorkbookNameInput extends NameInput {
  @IsUUID()
  workbookId!: string;
}

class WorksheetNameInput extends NameInput {
  @IsUUID()
  worksheetId!: string;
}

class WorkbookInput {
  @IsUUID()
  workbookId!: string;
}

class WorksheetInput {
  @IsUUID()
  worksheetId!: string;
}

class ChangesetInput {
  @IsUUID()
  changesetId!: string;
}

class ViewInput {
  @IsUUID()
  viewId!: string;
}

class EvaluationInput {
  @IsOptional()
  @IsUUID()
  evaluationId?: string;
}

class ExportInput {
  @IsUUID()
  exportId!: string;
}

// ── Operaciones ──

export function projectActionOperations(services: Services): WriteOperation[] {
  return [
    createWorkbook(services),
    renameWorkbook(services),
    renameWorksheet(services),
    archiveWorkbook(services, true),
    archiveWorkbook(services, false),
    archiveWorksheet(services, true),
    archiveWorksheet(services, false),
    applyChangeset(services),
    cancelChangeset(services),
    deleteSavedView(services),
    approveExport(services),
    publishFeed(services),
  ] as WriteOperation[];
}

function createWorkbook({ worksheets }: Services): WriteOperation<NameInput> {
  return {
    name: 'create_workbook',
    description: 'Crea un libro nuevo en el proyecto.',
    level: 'write',
    permission: 'worksheet.write',
    inputSchema: objectSchema({ name: NAME_SCHEMA }, ['name']),
    parse: (input) => validateAs(NameInput, input),
    targetOf: ({ scope }) => ({ projectId: scope.projectId }),
    prepare: async (context, input) => ({
      summary: operationText(
        context,
        `Crear el libro «${input.name}».`,
        `Create the workbook “${input.name}”.`,
      ),
      plan: { name: input.name },
      target: { projectId: context.scope.projectId },
    }),
    confirm: async ({ identity, scope }, plan) => {
      const workbook = await worksheets.createWorkbook(
        identity,
        scope,
        String(plan.name),
      );
      return { workbookId: workbook.id, name: workbook.name };
    },
  };
}

function renameWorkbook({
  worksheets,
}: Services): WriteOperation<WorkbookNameInput> {
  return {
    name: 'rename_workbook',
    description: 'Cambia el nombre de un libro.',
    level: 'write',
    permission: 'worksheet.write',
    inputSchema: objectSchema({ workbookId: UUID_SCHEMA, name: NAME_SCHEMA }, [
      'workbookId',
      'name',
    ]),
    parse: (input) => validateAs(WorkbookNameInput, input),
    targetOf: (_context, input) => ({ workbookId: input.workbookId }),
    prepare: async (context, input) => ({
      summary: operationText(
        context,
        `Renombrar el libro a «${input.name}».`,
        `Rename the workbook to “${input.name}”.`,
      ),
      plan: { workbookId: input.workbookId, name: input.name },
      target: { workbookId: input.workbookId },
    }),
    confirm: async ({ identity, scope }, plan) => {
      const workbook = await worksheets.renameWorkbook(
        identity,
        scope,
        String(plan.workbookId),
        String(plan.name),
      );
      return { workbookId: workbook.id, name: workbook.name };
    },
  };
}

function renameWorksheet({
  worksheets,
}: Services): WriteOperation<WorksheetNameInput> {
  return {
    name: 'rename_worksheet',
    description: 'Cambia el nombre de una hoja.',
    level: 'write',
    permission: 'worksheet.write',
    inputSchema: objectSchema({ worksheetId: UUID_SCHEMA, name: NAME_SCHEMA }, [
      'worksheetId',
      'name',
    ]),
    parse: (input) => validateAs(WorksheetNameInput, input),
    targetOf: (_context, input) => ({ worksheetId: input.worksheetId }),
    prepare: async (context, input) => ({
      summary: operationText(
        context,
        `Renombrar la hoja a «${input.name}».`,
        `Rename the sheet to “${input.name}”.`,
      ),
      plan: { worksheetId: input.worksheetId, name: input.name },
      target: { worksheetId: input.worksheetId },
    }),
    confirm: async ({ identity, scope }, plan) => {
      const { worksheet } = await worksheets.renameWorksheet(
        identity,
        scope,
        String(plan.worksheetId),
        String(plan.name),
      );
      return { worksheetId: worksheet.id, name: worksheet.name };
    },
  };
}

/** Archivar se puede deshacer: el libro y sus hojas se siguen leyendo. */
function archiveWorkbook(
  { worksheets }: Services,
  archive: boolean,
): WriteOperation<WorkbookInput> {
  const verb = archive ? 'Archivar' : 'Restaurar';
  return {
    name: archive ? 'archive_workbook' : 'restore_workbook',
    description: archive
      ? 'Archiva un libro: se sigue leyendo, pero no admite cambios.'
      : 'Restaura un libro archivado.',
    level: 'write',
    permission: 'worksheet.write',
    inputSchema: objectSchema({ workbookId: UUID_SCHEMA }, ['workbookId']),
    parse: (input) => validateAs(WorkbookInput, input),
    targetOf: (_context, input) => ({ workbookId: input.workbookId }),
    prepare: async (context, input) => ({
      summary: operationText(
        context,
        `${verb} el libro.`,
        `${archive ? 'Archive' : 'Restore'} the workbook.`,
      ),
      plan: { workbookId: input.workbookId },
      target: { workbookId: input.workbookId },
    }),
    confirm: async ({ identity, scope }, plan) => {
      const workbookId = String(plan.workbookId);
      const workbook = archive
        ? await worksheets.archiveWorkbook(identity, scope, workbookId)
        : await worksheets.restoreWorkbook(identity, scope, workbookId);
      return { workbookId: workbook.id, archivedAt: workbook.archivedAt };
    },
  };
}

function archiveWorksheet(
  { worksheets }: Services,
  archive: boolean,
): WriteOperation<WorksheetInput> {
  const verb = archive ? 'Archivar' : 'Restaurar';
  return {
    name: archive ? 'archive_worksheet' : 'restore_worksheet',
    description: archive
      ? 'Archiva una hoja: se sigue leyendo, pero no admite cambios.'
      : 'Restaura una hoja archivada.',
    level: 'write',
    permission: 'worksheet.write',
    inputSchema: objectSchema({ worksheetId: UUID_SCHEMA }, ['worksheetId']),
    parse: (input) => validateAs(WorksheetInput, input),
    targetOf: (_context, input) => ({ worksheetId: input.worksheetId }),
    prepare: async (context, input) => ({
      summary: operationText(
        context,
        `${verb} la hoja.`,
        `${archive ? 'Archive' : 'Restore'} the sheet.`,
      ),
      plan: { worksheetId: input.worksheetId },
      target: { worksheetId: input.worksheetId },
    }),
    confirm: async ({ identity, scope }, plan) => {
      const worksheetId = String(plan.worksheetId);
      const { worksheet } = archive
        ? await worksheets.archiveWorksheet(identity, scope, worksheetId)
        : await worksheets.restoreWorksheet(identity, scope, worksheetId);
      return { worksheetId: worksheet.id, archivedAt: worksheet.archivedAt };
    },
  };
}

/**
 * Envía, aprueba y aplica un borrador, como los tres botones del editor y con
 * sus mismas reglas: sin conflictos ni problemas, aprobación según la política
 * de la organización y aplicación idempotente por propuesta.
 */
function applyChangeset({
  changesets,
}: Services): WriteOperation<ChangesetInput> {
  return {
    name: 'apply_changeset',
    description:
      'Envía, aprueba y aplica un borrador (draft, pending_review o approved) para crear una revisión nueva de la hoja. Revisa antes con open_changeset que no tenga conflictos ni problemas.',
    level: 'write',
    permission: 'changeset.approve',
    inputSchema: objectSchema({ changesetId: UUID_SCHEMA }, ['changesetId']),
    parse: (input) => validateAs(ChangesetInput, input),
    targetOf: (_context, input) => ({ changesetId: input.changesetId }),
    prepare: async (context, input) => {
      const changeset = await changesets.find(
        context.identity,
        context.scope,
        input.changesetId,
      );
      if (!isApplicable(changeset)) {
        throw apiError(ErrorCodes.CHANGESET_STATE_INVALID);
      }
      return {
        summary: operationText(
          context,
          `Enviar, aprobar y aplicar el borrador «${changeset.title}» (${changeset.operations.length} cambios).`,
          `Submit, approve and apply the draft “${changeset.title}” (${changeset.operations.length} changes).`,
        ),
        plan: { changesetId: changeset.id },
        target: {
          changesetId: changeset.id,
          worksheetId: changeset.worksheetId,
        },
      };
    },
    confirm: async (context, plan, proposalId) =>
      submitApproveAndApply(
        changesets,
        context,
        String(plan.changesetId),
        proposalId,
      ),
  };
}

function cancelChangeset({
  changesets,
}: Services): WriteOperation<ChangesetInput> {
  return {
    name: 'cancel_changeset',
    description: 'Cancela un borrador que no se ha aplicado.',
    level: 'write',
    permission: 'worksheet.write',
    inputSchema: objectSchema({ changesetId: UUID_SCHEMA }, ['changesetId']),
    parse: (input) => validateAs(ChangesetInput, input),
    targetOf: (_context, input) => ({ changesetId: input.changesetId }),
    prepare: async (context, input) => {
      const changeset = await changesets.find(
        context.identity,
        context.scope,
        input.changesetId,
      );
      return {
        summary: operationText(
          context,
          `Cancelar el borrador «${changeset.title}».`,
          `Cancel the draft “${changeset.title}”.`,
        ),
        plan: { changesetId: changeset.id },
        target: { changesetId: changeset.id },
      };
    },
    confirm: async ({ identity, scope }, plan) => {
      const changeset = await changesets.cancel(
        identity,
        scope,
        String(plan.changesetId),
      );
      return { changesetId: changeset.id, status: changeset.status };
    },
  };
}

function deleteSavedView({ views }: Services): WriteOperation<ViewInput> {
  return {
    name: 'delete_saved_view',
    description: 'Elimina una vista guardada (filtro, orden y columnas).',
    level: 'write',
    permission: 'organization.read',
    inputSchema: objectSchema({ viewId: UUID_SCHEMA }, ['viewId']),
    parse: (input) => validateAs(ViewInput, input),
    targetOf: (_context, input) => ({ viewId: input.viewId }),
    prepare: async (context, input) => {
      const view = await views.find(
        context.identity,
        context.scope,
        input.viewId,
      );
      return {
        summary: operationText(
          context,
          `Eliminar la vista «${view.name}».`,
          `Delete the view “${view.name}”.`,
        ),
        plan: { viewId: view.id },
        target: { viewId: view.id, worksheetId: view.worksheetId },
      };
    },
    confirm: async ({ identity, scope }, plan) => {
      await views.delete(identity, scope, String(plan.viewId));
      return { viewId: plan.viewId, deleted: true };
    },
  };
}

/**
 * Aprueba lo que sale al canal: la exportación de una evaluación terminada.
 * Acepta como excluidos los inválidos que había al preparar; si la evaluación
 * cambió, el servicio lo rechaza por su checksum.
 */
function approveExport({
  evaluations,
  exports,
}: Services): WriteOperation<EvaluationInput> {
  return {
    name: 'approve_export',
    description:
      'Aprueba la exportación (productos.tsv) de una evaluación terminada; por defecto, la última. Los productos inválidos quedan fuera. Es lo que el feed puede publicar.',
    level: 'write',
    permission: 'changeset.approve',
    inputSchema: objectSchema({ evaluationId: UUID_SCHEMA }),
    parse: (input) => validateAs(EvaluationInput, input),
    targetOf: (context, input) => ({
      projectId: context.scope.projectId,
      evaluationId: input.evaluationId ?? null,
    }),
    prepare: async (context, input) => {
      const evaluation = await evaluationToExport(evaluations, context, input);
      const counts = evaluation.counts;
      if (
        evaluation.status !== 'succeeded' ||
        !counts ||
        !evaluation.resultChecksum
      ) {
        throw apiError(ErrorCodes.VALIDATION_FAILED);
      }
      return {
        summary: operationText(
          context,
          `Aprobar la exportación de la evaluación: ${counts.valid} productos válidos; quedan fuera ${counts.invalid} inválidos y ${counts.excluded} excluidos.`,
          `Approve the export of the evaluation: ${counts.valid} valid products; ${counts.invalid} invalid and ${counts.excluded} excluded are left out.`,
        ),
        plan: {
          evaluationId: evaluation.id,
          resultChecksum: evaluation.resultChecksum,
          acceptedInvalidCount: counts.invalid,
          acceptedExcludedCount: counts.excluded,
        },
        target: {
          projectId: context.scope.projectId,
          evaluationId: evaluation.id,
        },
      };
    },
    confirm: async ({ identity, scope }, plan) => {
      const result = await exports.create(identity, scope.projectId, {
        evaluationId: String(plan.evaluationId),
        resultChecksum: String(plan.resultChecksum),
        acceptedInvalidCount: Number(plan.acceptedInvalidCount),
        acceptedExcludedCount: Number(plan.acceptedExcludedCount),
      });
      return { exportId: result.export.id, created: result.created };
    },
  };
}

/**
 * Publica una exportación aprobada en el feed del proyecto; lo crea si no
 * hay. La URL de entrega lleva un secreto y no se devuelve: se ve en la web.
 */
function publishFeed({ feeds }: Services): WriteOperation<ExportInput> {
  return {
    name: 'publish_feed',
    description:
      'Publica en el feed del proyecto una exportación aprobada (approve_export); crea el feed si no existe. Después, list_feed_products con feedId y versionId.',
    level: 'write',
    permission: 'changeset.approve',
    inputSchema: objectSchema({ exportId: UUID_SCHEMA }, ['exportId']),
    parse: (input) => validateAs(ExportInput, input),
    targetOf: (context, input) => ({
      projectId: context.scope.projectId,
      exportId: input.exportId,
    }),
    prepare: async (context, input) => {
      const [feed] = await feeds.findAll(
        context.identity,
        context.scope.projectId,
      );
      return {
        summary: operationText(
          context,
          feed
            ? `Publicar la exportación en el feed (versión ${feed.generation + 1}).`
            : 'Crear el feed del proyecto y publicar la exportación.',
          feed
            ? `Publish the export to the feed (version ${feed.generation + 1}).`
            : "Create the project's feed and publish the export.",
        ),
        plan: {
          exportId: input.exportId,
          feedId: feed?.id ?? null,
          expectedGeneration: feed?.generation ?? 0,
        },
        target: {
          projectId: context.scope.projectId,
          exportId: input.exportId,
        },
      };
    },
    confirm: async ({ identity, scope }, plan) => {
      const feedId =
        typeof plan.feedId === 'string'
          ? plan.feedId
          : (await feeds.create(identity, scope.projectId)).feed.id;
      const { feed, published } = await feeds.publish(
        identity,
        scope.projectId,
        feedId,
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

// ── Detalle ──

function isApplicable(changeset: Changeset) {
  return APPLICABLE_STATUSES.some((status) => status === changeset.status);
}

async function submitApproveAndApply(
  changesets: ChangesetsService,
  { identity, scope }: OperationContext,
  changesetId: string,
  proposalId: string,
) {
  let changeset = await changesets.find(identity, scope, changesetId);
  if (changeset.status === 'draft') {
    changeset = await changesets.submit(
      identity,
      scope,
      changesetId,
      changeset.draftVersion,
    );
  }
  if (changeset.status === 'pending_review') {
    await changesets.decide(identity, scope, changesetId, {
      decision: 'accept',
      contentHash: String(changeset.contentHash),
      draftVersion: changeset.draftVersion,
      expectedHeadRevisionId: changeset.baseRevisionId,
    });
  }
  const applied = await changesets.apply(
    identity,
    scope,
    changesetId,
    `agent-apply-${proposalId}`,
    {
      contentHash: String(changeset.contentHash),
      expectedHeadRevisionId: changeset.baseRevisionId,
    },
  );
  return {
    changesetId: applied.changesetId,
    revisionId: applied.revisionId,
    sequence: applied.sequence,
  };
}

async function evaluationToExport(
  evaluations: EvaluationsService,
  { identity, scope }: OperationContext,
  input: EvaluationInput,
) {
  const evaluationId =
    input.evaluationId ??
    (
      await evaluations.findAll(identity, scope.projectId, {
        limit: 1,
        offset: 0,
      })
    ).items[0]?.id;
  if (!evaluationId) {
    throw apiError(ErrorCodes.EVALUATION_NOT_FOUND);
  }
  return evaluations.findSummary(identity, scope.projectId, evaluationId);
}
