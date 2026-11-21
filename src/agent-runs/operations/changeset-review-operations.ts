import { Type } from 'class-transformer';
import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ConflictResolutionDto } from '../../changesets/changesets.dto.js';
import type { ChangesetsService } from '../../changesets/changesets.service.js';
import { apiError } from '../../common/http/api-error.js';
import { ErrorCodes } from '../../common/http/error-codes.js';
import { validateAs } from '../../common/http/validation-options.js';
import { operationText, type WriteOperation } from './agent-operation.js';
import { objectSchema } from './operation-inputs.js';

/*
 * El ciclo de revisión de un borrador, como los botones del editor (plan 10,
 * D8): enviar, reabrir, rechazar, ponerlo al día con la revisión vigente
 * (rebase) y proponer deshacer una revisión. Sin ellos, un borrador que se
 * quedaba atrás o en conflicto solo se podía cancelar.
 */

const UUID_SCHEMA = { type: 'string', format: 'uuid' } as const;
const NULLABLE_UUID_SCHEMA = {
  anyOf: [UUID_SCHEMA, { type: 'null' }],
} as const;

type Services = Readonly<{ changesets: ChangesetsService }>;

// ── Entradas ──

class ChangesetInput {
  @IsUUID()
  changesetId!: string;
}

class RejectInput extends ChangesetInput {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

class RebaseInput extends ChangesetInput {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConflictResolutionDto)
  resolutions?: ConflictResolutionDto[];
}

class RevisionInput {
  @IsUUID()
  revisionId!: string;
}

const CHANGESET_SCHEMA = objectSchema({ changesetId: UUID_SCHEMA }, [
  'changesetId',
]);

// ── Operaciones ──

export function changesetReviewOperations(
  services: Services,
): WriteOperation[] {
  return [
    submitChangeset(services),
    reopenChangeset(services),
    rejectChangeset(services),
    rebaseChangeset(services),
    proposeRevert(services),
  ] as WriteOperation[];
}

function submitChangeset({
  changesets,
}: Services): WriteOperation<ChangesetInput> {
  return {
    name: 'submit_changeset',
    description:
      'Envía a revisión un borrador (draft) sin conflictos ni problemas. Sirve a quien prepara cambios pero no los aprueba; para enviar, aprobar y aplicar de una vez, apply_changeset.',
    level: 'write',
    permission: 'worksheet.write',
    inputSchema: CHANGESET_SCHEMA,
    parse: (input) => validateAs(ChangesetInput, input),
    targetOf: (_context, input) => ({ changesetId: input.changesetId }),
    prepare: async (context, input) => {
      const changeset = await changesets.find(
        context.identity,
        context.scope,
        input.changesetId,
      );
      if (changeset.status !== 'draft') {
        throw apiError(ErrorCodes.CHANGESET_STATE_INVALID);
      }
      return {
        summary: operationText(
          context,
          `Enviar a revisión el borrador «${changeset.title}» (${changeset.operations.length} cambios).`,
          `Submit the draft “${changeset.title}” for review (${changeset.operations.length} changes).`,
        ),
        plan: {
          changesetId: changeset.id,
          draftVersion: changeset.draftVersion,
        },
        target: {
          changesetId: changeset.id,
          worksheetId: changeset.worksheetId,
        },
      };
    },
    confirm: async ({ identity, scope }, plan) => {
      const changeset = await changesets.submit(
        identity,
        scope,
        String(plan.changesetId),
        Number(plan.draftVersion),
      );
      return { changesetId: changeset.id, status: changeset.status };
    },
  };
}

function reopenChangeset({
  changesets,
}: Services): WriteOperation<ChangesetInput> {
  return {
    name: 'reopen_changeset',
    description:
      'Devuelve a borrador (draft) uno enviado, aprobado o rechazado, para seguir editándolo con prepare_sheet_edits.',
    level: 'write',
    permission: 'worksheet.write',
    inputSchema: CHANGESET_SCHEMA,
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
          `Reabrir como borrador «${changeset.title}» (ahora ${changeset.status}).`,
          `Reopen “${changeset.title}” as a draft (now ${changeset.status}).`,
        ),
        plan: {
          changesetId: changeset.id,
          draftVersion: changeset.draftVersion,
        },
        target: {
          changesetId: changeset.id,
          worksheetId: changeset.worksheetId,
        },
      };
    },
    confirm: async ({ identity, scope }, plan) => {
      const changeset = await changesets.reopen(
        identity,
        scope,
        String(plan.changesetId),
        Number(plan.draftVersion),
      );
      return { changesetId: changeset.id, status: changeset.status };
    },
  };
}

function rejectChangeset({
  changesets,
}: Services): WriteOperation<RejectInput> {
  return {
    name: 'reject_changeset',
    description:
      'Rechaza un borrador enviado a revisión (pending_review), con un motivo opcional. Quien lo preparó puede reabrirlo.',
    level: 'write',
    permission: 'changeset.approve',
    inputSchema: objectSchema(
      {
        changesetId: UUID_SCHEMA,
        reason: { type: 'string', maxLength: 500 },
      },
      ['changesetId'],
    ),
    parse: (input) => validateAs(RejectInput, input),
    targetOf: (_context, input) => ({ changesetId: input.changesetId }),
    prepare: async (context, input) => {
      const changeset = await changesets.find(
        context.identity,
        context.scope,
        input.changesetId,
      );
      if (changeset.status !== 'pending_review') {
        throw apiError(ErrorCodes.CHANGESET_STATE_INVALID);
      }
      return {
        summary: operationText(
          context,
          `Rechazar el borrador «${changeset.title}».`,
          `Reject the draft “${changeset.title}”.`,
        ),
        plan: {
          changesetId: changeset.id,
          draftVersion: changeset.draftVersion,
          contentHash: String(changeset.contentHash),
          expectedHeadRevisionId: changeset.baseRevisionId,
          reason: input.reason ?? null,
        },
        target: {
          changesetId: changeset.id,
          worksheetId: changeset.worksheetId,
        },
      };
    },
    confirm: async ({ identity, scope }, plan) => {
      const { changeset } = await changesets.decide(
        identity,
        scope,
        String(plan.changesetId),
        {
          decision: 'reject',
          draftVersion: Number(plan.draftVersion),
          contentHash: String(plan.contentHash),
          expectedHeadRevisionId: String(plan.expectedHeadRevisionId),
          ...(typeof plan.reason === 'string' ? { reason: plan.reason } : {}),
        },
      );
      return { changesetId: changeset.id, status: changeset.status };
    },
  };
}

function rebaseChangeset({
  changesets,
}: Services): WriteOperation<RebaseInput> {
  return {
    name: 'rebase_changeset',
    description:
      'Pone al día un borrador con la revisión vigente de su hoja: es la salida cuando aplicar o enviar falla con CHANGESET_BASE_OUTDATED o WORKSHEET_HEAD_CHANGED. Si open_changeset muestra conflictos, pasa una resolución por cada uno (choice: proposed conserva el cambio del borrador; head, lo vigente). Sin conflictos, resolutions va vacío.',
    level: 'write',
    permission: 'worksheet.write',
    inputSchema: objectSchema(
      {
        changesetId: UUID_SCHEMA,
        resolutions: {
          type: 'array',
          items: objectSchema(
            {
              rowId: NULLABLE_UUID_SCHEMA,
              columnId: NULLABLE_UUID_SCHEMA,
              choice: { type: 'string', enum: ['proposed', 'head'] },
            },
            ['rowId', 'columnId', 'choice'],
          ),
        },
      },
      ['changesetId'],
    ),
    parse: (input) => validateAs(RebaseInput, input),
    targetOf: (_context, input) => ({ changesetId: input.changesetId }),
    prepare: async (context, input) => {
      const changeset = await changesets.find(
        context.identity,
        context.scope,
        input.changesetId,
      );
      const resolutions = (input.resolutions ?? []).map((resolution) => ({
        rowId: resolution.rowId,
        columnId: resolution.columnId,
        choice: resolution.choice,
      }));
      return {
        summary: operationText(
          context,
          `Poner al día el borrador «${changeset.title}» con la revisión vigente (${resolutions.length} conflictos resueltos).`,
          `Bring the draft “${changeset.title}” up to date with the current revision (${resolutions.length} conflicts resolved).`,
        ),
        plan: {
          changesetId: changeset.id,
          draftVersion: changeset.draftVersion,
          resolutions,
        },
        target: {
          changesetId: changeset.id,
          worksheetId: changeset.worksheetId,
        },
      };
    },
    confirm: async ({ identity, scope }, plan) => {
      const resolutions = await validateAs(RebaseInput, {
        changesetId: plan.changesetId,
        resolutions: plan.resolutions,
      });
      const changeset = await changesets.rebase(
        identity,
        scope,
        String(plan.changesetId),
        Number(plan.draftVersion),
        resolutions.resolutions ?? [],
      );
      return {
        changesetId: changeset.id,
        status: changeset.status,
        baseRevisionId: changeset.baseRevisionId,
      };
    },
  };
}

function proposeRevert({
  changesets,
}: Services): WriteOperation<RevisionInput> {
  return {
    name: 'propose_revert',
    description:
      'Prepara un borrador nuevo que deshace los cambios de filas de una revisión aplicada (IDs con list_sheet_history). El borrador se revisa y se aplica como cualquier otro.',
    level: 'write',
    permission: 'worksheet.write',
    inputSchema: objectSchema({ revisionId: UUID_SCHEMA }, ['revisionId']),
    parse: (input) => validateAs(RevisionInput, input),
    targetOf: (_context, input) => ({ revisionId: input.revisionId }),
    prepare: async (context, input) => ({
      summary: operationText(
        context,
        `Preparar un borrador que deshaga la revisión ${input.revisionId}.`,
        `Prepare a draft that undoes revision ${input.revisionId}.`,
      ),
      plan: { revisionId: input.revisionId },
      target: { revisionId: input.revisionId },
    }),
    confirm: async ({ identity, scope }, plan) => {
      const changeset = await changesets.proposeRevert(
        identity,
        scope,
        String(plan.revisionId),
      );
      return {
        changesetId: changeset.id,
        worksheetId: changeset.worksheetId,
        status: changeset.status,
      };
    },
  };
}
