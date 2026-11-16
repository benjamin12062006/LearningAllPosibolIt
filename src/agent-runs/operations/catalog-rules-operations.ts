import type { CatalogImportService } from '../../catalog-import/catalog-import.service.js';
import { apiError } from '../../common/http/api-error.js';
import { ErrorCodes } from '../../common/http/error-codes.js';
import { validateAs } from '../../common/http/validation-options.js';
import {
  CreateEvaluationDto,
  PreviewRulesDto,
} from '../../evaluations/evaluations.dto.js';
import type { EvaluationsService } from '../../evaluations/evaluations.service.js';
import {
  CLEANABLE_ATTRIBUTES,
  PRODUCT_ATTRIBUTES,
} from '../../evaluations/engine/google-merchant.profile.js';
import {
  EXCLUDE_OPERATORS,
  RULE_TYPES,
} from '../../evaluations/engine/ruleset.js';
import {
  CreateRulesetDto,
  RULESET_LIMITS,
} from '../../rulesets/rulesets.dto.js';
import {
  assertRulesetIsConsistent,
  toRuleset,
  type RulesetsService,
} from '../../rulesets/rulesets.service.js';
import type {
  OperationContext,
  ReadOperation,
  WriteOperation,
} from './agent-operation.js';
import { objectSchema } from './operation-inputs.js';
import { operationText } from './agent-operation.js';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

class CatalogSnapshotInput {
  @IsUUID()
  snapshotId!: string;
}

class ProposeRulesetInput extends CreateRulesetDto {
  @IsInt()
  @Min(0)
  @Max(2_147_483_646)
  baseRevision!: number;
}

const snapshotId = { type: 'string', format: 'uuid' };
const revision = { type: 'integer', minimum: 1, maximum: 2_147_483_647 };
const ruleProperties = {
  mapping: {
    type: 'array',
    minItems: 1,
    maxItems: RULESET_LIMITS.mappings,
    items: objectSchema(
      {
        attribute: { type: 'string', enum: PRODUCT_ATTRIBUTES },
        column: { type: 'string', maxLength: RULESET_LIMITS.columnLength },
      },
      ['attribute', 'column'],
    ),
  },
  rules: {
    type: 'array',
    maxItems: RULESET_LIMITS.rules,
    items: objectSchema(
      {
        type: { type: 'string', enum: RULE_TYPES },
        attributes: {
          type: 'array',
          items: { type: 'string', enum: CLEANABLE_ATTRIBUTES },
          maxItems: RULESET_LIMITS.cleanAttributes,
          description: 'Atributos para clean_text.',
        },
        template: {
          type: 'string',
          maxLength: RULESET_LIMITS.templateLength,
          description:
            'Plantilla para build_title, con referencias {atributo}.',
        },
        attribute: { type: 'string', enum: ['id', ...PRODUCT_ATTRIBUTES] },
        operator: { type: 'string', enum: EXCLUDE_OPERATORS },
        value: {
          type: 'string',
          maxLength: RULESET_LIMITS.conditionValueLength,
        },
      },
      ['type'],
    ),
  },
};

function snapshotTarget(
  { scope }: OperationContext,
  input: CatalogSnapshotInput,
) {
  return { projectId: scope.projectId, snapshotId: input.snapshotId };
}

export function catalogSnapshotOperation(
  imports: CatalogImportService,
): ReadOperation<CatalogSnapshotInput> {
  return {
    name: 'get_catalog_snapshot',
    description:
      'Columnas y estado de una importación del catálogo. Obtén los IDs con get_project_overview.',
    level: 'read',
    permission: 'organization.read',
    inputSchema: objectSchema({ snapshotId }, ['snapshotId']),
    parse: (input) => validateAs(CatalogSnapshotInput, input),
    targetOf: snapshotTarget,
    async execute({ identity, scope }, input) {
      const { snapshot } = await imports.findSnapshot(
        identity,
        scope.projectId,
        input.snapshotId,
      );
      const { id, originalName, status, rowCount, headers, idColumn } =
        snapshot;
      return { id, originalName, status, rowCount, headers, idColumn };
    },
  };
}

export function previewRulesOperation(
  evaluations: EvaluationsService,
): ReadOperation<PreviewRulesDto> {
  return {
    name: 'preview_rules',
    description:
      'Compara un mapeo y reglas candidatos con la revisión vigente o indicada sobre un catálogo importado. Devuelve recuentos y problemas sin guardar.',
    level: 'read',
    permission: 'worksheet.write',
    inputSchema: objectSchema(
      { snapshotId, baseRevision: revision, ...ruleProperties },
      ['snapshotId', 'mapping', 'rules'],
    ),
    parse: (input) => validateAs(PreviewRulesDto, input),
    targetOf: snapshotTarget,
    async execute({ identity, scope }, input) {
      const preview = await evaluations.previewRules(
        identity,
        scope.projectId,
        input,
        { limit: 1 },
      );
      const {
        snapshotId,
        baseRevision,
        counts,
        problems,
        outcomeChanges,
        changedValues,
        changedProducts,
      } = preview;
      return {
        snapshotId,
        baseRevision,
        counts,
        problems,
        outcomeChanges,
        changedValues,
        changedProducts,
      };
    },
  };
}

export function createRulesetOperation(
  rulesets: RulesetsService,
): WriteOperation<ProposeRulesetInput> {
  return {
    name: 'create_ruleset',
    description:
      'Propone guardar una revisión completa de mapeo y reglas. Usa get_ruleset y su número de revisión como base; usa 0 para la primera. La persona debe revisar y confirmar.',
    level: 'write',
    permission: 'worksheet.write',
    inputSchema: objectSchema(
      {
        ...ruleProperties,
        baseRevision: { ...revision, minimum: 0, maximum: 2_147_483_646 },
      },
      ['mapping', 'rules', 'baseRevision'],
    ),
    parse: (input) => validateAs(ProposeRulesetInput, input),
    targetOf: ({ scope }) => ({ projectId: scope.projectId }),
    async prepare(context, input) {
      const { identity, scope } = context;
      const ruleset = toRuleset(input);
      assertRulesetIsConsistent(ruleset);
      const { items } = await rulesets.findAll(identity, scope.projectId, {
        limit: 1,
        offset: 0,
      });
      const { baseRevision } = input;
      if (baseRevision !== (items[0]?.revision ?? 0)) {
        throw apiError(ErrorCodes.RULESET_REVISION_CONFLICT);
      }
      return {
        summary: operationText(
          context,
          `Guardar la revisión ${baseRevision + 1} con ${ruleset.mapping.length} columnas mapeadas y ${ruleset.rules.length} reglas.`,
          `Save revision ${baseRevision + 1} with ${ruleset.mapping.length} mapped columns and ${ruleset.rules.length} rules.`,
        ),
        plan: { ruleset, baseRevision },
        target: { projectId: scope.projectId },
      };
    },
    async confirm({ identity, scope }, plan, proposalId) {
      const input = await validateAs(CreateRulesetDto, plan.ruleset);
      const saved = await rulesets.create(identity, scope.projectId, input, {
        id: proposalId,
        baseRevision: Number(plan.baseRevision),
      });
      return { rulesetRevision: saved.revision };
    },
  };
}

export function requestEvaluationOperation(
  imports: CatalogImportService,
  rulesets: RulesetsService,
  evaluations: EvaluationsService,
): WriteOperation<CreateEvaluationDto> {
  return {
    name: 'request_evaluation',
    description:
      'Propone ejecutar una evaluación de un catálogo importado con una revisión guardada. Usa get_project_overview para descubrir ambos. Requiere confirmación humana.',
    level: 'write',
    permission: 'worksheet.write',
    inputSchema: objectSchema({ snapshotId, rulesetRevision: revision }, [
      'snapshotId',
      'rulesetRevision',
    ]),
    parse: (input) => validateAs(CreateEvaluationDto, input),
    targetOf: snapshotTarget,
    async prepare(context, input) {
      const { identity, scope } = context;
      const { snapshot } = await imports.findSnapshot(
        identity,
        scope.projectId,
        input.snapshotId,
      );
      if (snapshot.status !== 'ready')
        throw apiError(ErrorCodes.EVALUATION_SNAPSHOT_NOT_READY);
      await rulesets.findRevision(
        identity,
        scope.projectId,
        input.rulesetRevision,
      );
      return {
        summary: operationText(
          context,
          `Evaluar el catálogo «${snapshot.originalName}» con la revisión ${input.rulesetRevision}.`,
          `Evaluate the catalog “${snapshot.originalName}” using revision ${input.rulesetRevision}.`,
        ),
        plan: {
          snapshotId: input.snapshotId,
          rulesetRevision: input.rulesetRevision,
        },
        target: { projectId: scope.projectId, snapshotId: input.snapshotId },
      };
    },
    async confirm({ actorId, scope }, plan, proposalId) {
      const input = await validateAs(CreateEvaluationDto, plan);
      await evaluations.acceptPlanned(
        {
          ...input,
          ownerId: actorId,
          projectId: scope.projectId,
          evaluationId: proposalId,
        },
        true,
      );
      return { evaluationId: proposalId };
    },
  };
}
