import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedIdentity } from '../../auth/authenticated-request.js';
import { CatalogImportService } from '../../catalog-import/catalog-import.service.js';
import { ChangesetsService } from '../../changesets/changesets.service.js';
import { ExportsService } from '../../exports/exports.service.js';
import { apiError } from '../../common/http/api-error.js';
import { ErrorCodes } from '../../common/http/error-codes.js';
import { validateAs } from '../../common/http/validation-options.js';
import { EvaluationsService } from '../../evaluations/evaluations.service.js';
import { FeedViewerService } from '../../feed-viewer/feed-viewer.service.js';
import { FeedsService } from '../../feeds/feeds.service.js';
import { ProjectMembershipService } from '../../projects/project-membership.service.js';
import { ProjectsService } from '../../projects/projects.service.js';
import { RulesetsService } from '../../rulesets/rulesets.service.js';
import { WorksheetExportsService } from '../../worksheet-exports/worksheet-exports.service.js';
import { WorksheetImportsService } from '../../worksheet-imports/worksheet-imports.service.js';
import { WorksheetToolsService } from '../../worksheet-tools/worksheet-tools.service.js';
import { WorksheetCatalogSnapshotsService } from '../../worksheet-catalog-snapshots/worksheet-catalog-snapshots.service.js';
import { SavedViewsService } from '../../worksheets/saved-views.service.js';
import { WorksheetRowsService } from '../../worksheets/worksheet-rows.service.js';
import {
  CreateWorksheetDto,
  SaveViewDto,
} from '../../worksheets/worksheets.dto.js';
import { WorksheetsService } from '../../worksheets/worksheets.service.js';
import type {
  AgentOperation,
  OperationContext,
  OperationDescription,
  ReadOperation,
  WriteOperation,
} from './agent-operation.js';
import { operationText, worksheetOf } from './agent-operation.js';
import {
  catalogSnapshotOperation,
  createRulesetOperation,
  previewRulesOperation,
  requestEvaluationOperation,
} from './catalog-rules-operations.js';
import { projectActionOperations } from './project-action-operations.js';
import {
  findDuplicatesOperation,
  prepareSheetEditsOperation,
} from './sheet-edit-operations.js';
import {
  compareRevisionsOperation,
  listWorkbooksOperation,
  openChangesetOperation,
  sheetHistoryOperation,
} from './sheet-history-operations.js';
import {
  CHANGE_PROPOSAL_SCHEMA,
  ChangeProposalInput,
  EVALUATION_REF_SCHEMA,
  EvaluationRefInput,
  FEED_PRODUCTS_SCHEMA,
  FEED_REF_SCHEMA,
  FeedProductsInput,
  FeedRefInput,
  NO_INPUT_SCHEMA,
  NoInput,
  PREVIEW_TRANSFORM_SCHEMA,
  PreviewTransformInput,
  QUERY_ROWS_SCHEMA,
  QueryRowsInput,
  RULESET_REF_SCHEMA,
  RulesetRefInput,
  SELECT_ROWS_SCHEMA,
  SelectRowsInput,
  SHEET_SCHEMA_SCHEMA,
  SheetSchemaInput,
  SHEET_CATALOG_SCHEMA,
  SheetCatalogInput,
  SHEET_LAYOUT_SCHEMA,
  SheetLayoutInput,
  SUGGEST_VIEW_SCHEMA,
  SuggestViewInput,
  WORKBOOK_REF_SCHEMA,
  WorkbookRefInput,
} from './operation-inputs.js';

/**
 * Lo vital, que el agente nunca hace (ampliación del 2026-11-15): borrar,
 * crear o reconfigurar el proyecto, cambiar miembros o roles, el perfil de la
 * persona, gastar en reindexar y los secretos de entrega. El resto de acciones
 * del proyecto son escrituras con confirmación. La prueba del catálogo
 * comprueba que ninguna operación lleva uno de estos nombres.
 */
export const FORBIDDEN_OPERATIONS = [
  'delete_project',
  'create_project',
  'update_project',
  'delete_organization',
  'manage_members',
  'update_me',
  'reindex_knowledge',
  'rotate_delivery_token',
] as const;

/**
 * El catálogo de operaciones del agente (plan 05, D4). Cada operación se
 * declara una vez: nombre, descripción, esquema de entrada, permiso, nivel y
 * qué servicio llama. Las lecturas se ejecutan; las escrituras solo se
 * preparan, y la confirmación de la persona es la que crea el borrador, la
 * hoja o la vista.
 */
@Injectable()
export class AgentOperationCatalog {
  private readonly operations: ReadonlyMap<string, AgentOperation>;

  constructor(
    private readonly projects: ProjectsService,
    private readonly membership: ProjectMembershipService,
    private readonly imports: CatalogImportService,
    private readonly rulesets: RulesetsService,
    private readonly evaluations: EvaluationsService,
    private readonly feeds: FeedsService,
    private readonly viewer: FeedViewerService,
    private readonly worksheets: WorksheetsService,
    private readonly rows: WorksheetRowsService,
    private readonly tools: WorksheetToolsService,
    private readonly views: SavedViewsService,
    private readonly worksheetCatalog: WorksheetCatalogSnapshotsService,
    private readonly changesets: ChangesetsService,
    private readonly worksheetImports: WorksheetImportsService,
    private readonly worksheetExports: WorksheetExportsService,
    private readonly catalogExports: ExportsService,
  ) {
    const all: AgentOperation[] = [
      this.projectOverview(),
      catalogSnapshotOperation(this.imports),
      listWorkbooksOperation(this.worksheets),
      this.listWorksheets(),
      this.sheetSchema(),
      sheetHistoryOperation({
        worksheets: this.worksheets,
        changesets: this.changesets,
        imports: this.worksheetImports,
        exports: this.worksheetExports,
      }),
      openChangesetOperation(this.changesets),
      compareRevisionsOperation(this.rows),
      findDuplicatesOperation(this.rows),
      this.queryRows(),
      this.selectRows(),
      this.previewTransform(),
      this.evaluationReport(),
      this.ruleset(),
      previewRulesOperation(this.evaluations),
      this.feedStatus(),
      this.feedProducts(),
      createRulesetOperation(this.rulesets),
      requestEvaluationOperation(this.imports, this.rulesets, this.evaluations),
      this.sheetCatalog(),
      this.changeProposal(),
      prepareSheetEditsOperation({
        changesets: this.changesets,
        worksheets: this.worksheets,
      }),
      this.sheetLayout(),
      this.suggestView(),
      ...projectActionOperations({
        worksheets: this.worksheets,
        changesets: this.changesets,
        views: this.views,
        evaluations: this.evaluations,
        exports: this.catalogExports,
        feeds: this.feeds,
      }),
    ];
    this.operations = new Map(
      all.map((operation) => [operation.name, operation]),
    );
  }

  find(name: string): AgentOperation | undefined {
    return this.operations.get(name);
  }

  all(): AgentOperation[] {
    return [...this.operations.values()];
  }

  /** Lo que se le cuenta al agente: sin servicios ni funciones. */
  describe(operations = this.all()): OperationDescription[] {
    return operations.map(({ name, description, inputSchema, level }) => ({
      name,
      description,
      inputSchema,
      level,
    }));
  }

  async describeFor(identity: AuthenticatedIdentity, projectId: string) {
    const { permissions } = await this.membership.resolveAccess(
      identity,
      projectId,
    );
    return this.describe(
      this.all().filter((operation) =>
        permissions.includes(operation.permission),
      ),
    );
  }

  private projectOverview(): ReadOperation<NoInput> {
    return {
      name: 'get_project_overview',
      description:
        'Resumen del proyecto: configuración, tu rol, últimas importaciones, reglas, evaluaciones, feeds y libros.',
      level: 'read',
      permission: 'organization.read',
      inputSchema: NO_INPUT_SCHEMA,
      parse: (input) => validateAs(NoInput, input),
      targetOf: ({ scope }) => ({ projectId: scope.projectId }),
      execute: async ({ identity, scope }) => {
        const { projectId } = scope;
        const project = await this.projects.findVisible(identity, projectId);
        const access = await this.membership.resolveAccess(identity, projectId);
        const imports = await this.imports.list(identity, projectId, {
          limit: 5,
          offset: 0,
        });
        const rulesets = await this.rulesets.findAll(identity, projectId, {
          limit: 1,
          offset: 0,
        });
        const evaluations = await this.evaluations.findAll(
          identity,
          projectId,
          { limit: 5, offset: 0 },
        );
        const feeds = await this.feeds.findAll(identity, projectId);
        const workbooks = await this.worksheets.findWorkbooks(identity, scope, {
          limit: 20,
          offset: 0,
        });
        return {
          project: {
            id: project.id,
            name: project.name,
            country: project.country,
            currency: project.currency,
            configurationStatus: project.configurationStatus,
          },
          role: access.role,
          imports: imports.imports.map((item) => ({
            id: item.id,
            status: item.status,
            rowCount: item.rowCount,
            originalName: item.originalName,
            createdAt: item.createdAt,
          })),
          latestRulesetRevision: rulesets.items[0]?.revision ?? null,
          evaluations: evaluations.items.map((item) => ({
            id: item.id,
            status: item.status,
            rulesetRevision: item.rulesetRevision,
            counts: item.counts,
            createdAt: item.createdAt,
          })),
          feeds: feeds.map((feed) => ({
            id: feed.id,
            generation: feed.generation,
            deliveryEnabled: feed.deliveryEnabled,
            publishedRows: feed.publishedVersion?.rowCount ?? null,
          })),
          workbooks: workbooks.items.map((workbook) => ({
            id: workbook.id,
            name: workbook.name,
            archived: workbook.archivedAt !== null,
          })),
        };
      },
    };
  }

  private listWorksheets(): ReadOperation<WorkbookRefInput> {
    return {
      name: 'list_worksheets',
      description:
        'Hojas de un libro (por defecto, el de la conversación) con su número de filas.',
      level: 'read',
      permission: 'organization.read',
      inputSchema: WORKBOOK_REF_SCHEMA,
      parse: (input) => validateAs(WorkbookRefInput, input),
      targetOf: (context, input) => ({
        workbookId: input.workbookId ?? context.context.workbookId,
      }),
      execute: async ({ identity, scope, context }, input) => {
        const workbookId = workbookOf(input.workbookId ?? context.workbookId);
        const { items } = await this.worksheets.findWorksheets(
          identity,
          scope,
          workbookId,
          { limit: 50, offset: 0 },
        );
        return {
          workbookId,
          worksheets: items.map((sheet) => ({
            id: sheet.id,
            name: sheet.name,
            rowCount: sheet.headRevision.rowCount,
            archived: sheet.archivedAt !== null,
          })),
        };
      },
    };
  }

  private sheetSchema(): ReadOperation<SheetSchemaInput> {
    return {
      name: 'get_sheet_schema',
      description:
        'Columnas (id, nombre, tipo) y revisión vigente de una hoja; con revisionId, las columnas de esa revisión. Úsalo antes de leer filas o transformar.',
      level: 'read',
      permission: 'organization.read',
      inputSchema: SHEET_SCHEMA_SCHEMA,
      parse: (input) => validateAs(SheetSchemaInput, input),
      targetOf: (context, input) => ({
        worksheetId: worksheetOf(context, input.worksheetId),
      }),
      execute: async (context, input) => {
        const worksheetId = worksheetOf(context, input.worksheetId);
        const { worksheet } = await this.worksheets.findWorksheet(
          context.identity,
          context.scope,
          worksheetId,
        );
        const requested = input.revisionId
          ? await this.rows.revisionSchema(
              context.identity,
              context.scope,
              worksheetId,
              input.revisionId,
            )
          : null;
        return {
          id: worksheet.id,
          name: worksheet.name,
          headRevision: worksheet.headRevision,
          revision: requested?.revision ?? null,
          columns: (requested?.columns ?? worksheet.columns).map((column) => ({
            id: column.id,
            name: column.name,
            type: column.type,
            required: column.required,
          })),
        };
      },
    };
  }

  private queryRows(): ReadOperation<QueryRowsInput> {
    return {
      name: 'query_rows',
      description:
        'Lee filas de una hoja con filtro, orden y columnas (como rows/query), hasta 50 por página.',
      level: 'read',
      permission: 'organization.read',
      inputSchema: QUERY_ROWS_SCHEMA,
      parse: (input) => validateAs(QueryRowsInput, input),
      targetOf: (context, input) => ({
        worksheetId: worksheetOf(context, input.worksheetId),
      }),
      execute: async (context, input) => {
        const worksheetId = worksheetOf(context, input.worksheetId);
        return this.rows.query(context.identity, context.scope, worksheetId, {
          revisionId: revisionOf(context, worksheetId, input.revisionId),
          viewId: input.viewId,
          filter: input.filter,
          sort: input.sort,
          columns: input.columns,
          cursor: input.cursor,
          limit: input.limit ?? 20,
        });
      },
    };
  }

  private selectRows(): ReadOperation<SelectRowsInput> {
    return {
      name: 'select_rows',
      description:
        'Fija una selección para transformarla después. Pasa el revisionId y los rowId devueltos por query_rows y los IDs de columna de get_sheet_schema para la misma hoja.',
      level: 'read',
      permission: 'ai.use',
      inputSchema: SELECT_ROWS_SCHEMA,
      parse: (input) => validateAs(SelectRowsInput, input),
      targetOf: (context, input) => ({
        worksheetId: worksheetOf(context, input.worksheetId),
        columnIds: input.columnIds,
      }),
      execute: async (context, input) => {
        const worksheetId = worksheetOf(context, input.worksheetId);
        const revisionId =
          revisionOf(context, worksheetId, input.revisionId) ??
          (
            await this.worksheets.findWorksheet(
              context.identity,
              context.scope,
              worksheetId,
            )
          ).worksheet.headRevision.id;
        return this.tools.createSelection(
          context.identity,
          context.scope,
          worksheetId,
          { revisionId, columnIds: input.columnIds, rows: input.rows },
        );
      },
    };
  }

  private previewTransform(): ReadOperation<PreviewTransformInput> {
    return {
      name: 'preview_transform',
      description:
        'Calcula sin guardar cómo quedaría una transformación (recortar, reemplazar un valor o un fragmento, mapear o porcentaje exacto) sobre una selección.',
      level: 'read',
      permission: 'ai.use',
      inputSchema: PREVIEW_TRANSFORM_SCHEMA,
      parse: (input) => validateAs(PreviewTransformInput, input),
      targetOf: (context, input) => ({
        worksheetId: worksheetOf(context, input.worksheetId),
        selectionId: input.selectionId ?? context.context.selectionId,
        columnIds: input.columnIds,
      }),
      execute: async (context, input) => {
        const selectionId = input.selectionId ?? context.context.selectionId;
        if (!selectionId) {
          throw apiError(ErrorCodes.AI_SHEET_SELECTION_NOT_FOUND);
        }
        return this.tools.previewTransform(
          context.identity,
          context.scope,
          worksheetOf(context, input.worksheetId),
          {
            selectionId,
            columnIds: input.columnIds,
            transform: input.transform,
          },
        );
      },
    };
  }

  private evaluationReport(): ReadOperation<EvaluationRefInput> {
    return {
      name: 'get_evaluation_report',
      description:
        'Estado de una evaluación (por defecto, la última) y su «Requiere atención»: problemas por atributo y exclusiones.',
      level: 'read',
      permission: 'organization.read',
      inputSchema: EVALUATION_REF_SCHEMA,
      parse: (input) => validateAs(EvaluationRefInput, input),
      targetOf: (context, input) => ({
        projectId: context.scope.projectId,
        evaluationId:
          input.evaluationId ?? context.context.evaluationId ?? null,
      }),
      resultTarget: (result) => {
        if (result && typeof result === 'object' && 'evaluation' in result) {
          const evaluation = result.evaluation;
          if (
            evaluation &&
            typeof evaluation === 'object' &&
            'id' in evaluation &&
            typeof evaluation.id === 'string'
          )
            return { evaluationId: evaluation.id };
        }
        return {};
      },
      execute: async ({ identity, scope, context }, input) => {
        const evaluationId =
          input.evaluationId ??
          context.evaluationId ??
          (
            await this.evaluations.findAll(identity, scope.projectId, {
              limit: 1,
              offset: 0,
            })
          ).items[0]?.id;
        if (!evaluationId) {
          return { evaluation: null };
        }
        const evaluation = await this.evaluations.findSummary(
          identity,
          scope.projectId,
          evaluationId,
        );
        const attention =
          evaluation.status === 'succeeded'
            ? await this.evaluations.findAttention(
                identity,
                scope.projectId,
                evaluationId,
              )
            : null;
        return { evaluation, attention };
      },
    };
  }

  private ruleset(): ReadOperation<RulesetRefInput> {
    return {
      name: 'get_ruleset',
      description:
        'Mapeo de columnas y reglas de una revisión (por defecto, la última guardada).',
      level: 'read',
      permission: 'organization.read',
      inputSchema: RULESET_REF_SCHEMA,
      parse: (input) => validateAs(RulesetRefInput, input),
      targetOf: (context, input) => ({
        projectId: context.scope.projectId,
        rulesetRevision:
          input.revision ?? context.context.rulesetRevision ?? null,
      }),
      resultTarget: (result) => {
        if (
          result &&
          typeof result === 'object' &&
          'revision' in result &&
          typeof result.revision === 'number'
        )
          return { rulesetRevision: result.revision };
        return {};
      },
      execute: async ({ identity, scope, context }, input) => {
        const revision = input.revision ?? context.rulesetRevision;
        if (revision !== undefined) {
          return this.rulesets.findRevision(
            identity,
            scope.projectId,
            revision,
          );
        }
        const { items } = await this.rulesets.findAll(
          identity,
          scope.projectId,
          { limit: 1, offset: 0 },
        );
        return items[0] ?? { ruleset: null };
      },
    };
  }

  private feedStatus(): ReadOperation<FeedRefInput> {
    return {
      name: 'get_feed_status',
      description:
        'Estado del feed: versión publicada, si la URL pública entrega y por qué no, fuente, horario y última actualización.',
      level: 'read',
      permission: 'organization.read',
      inputSchema: FEED_REF_SCHEMA,
      parse: (input) => validateAs(FeedRefInput, input),
      targetOf: (context, input) => ({
        projectId: context.scope.projectId,
        feedId: input.feedId ?? null,
      }),
      execute: async ({ identity, scope }, input) => {
        const feeds = input.feedId
          ? [await this.feeds.findOne(identity, scope.projectId, input.feedId)]
          : await this.feeds.findAll(identity, scope.projectId);
        const statuses = [];
        for (const feed of feeds) {
          const delivery = await this.feeds.deliveryStatus(
            identity,
            scope.projectId,
            feed.id,
          );
          statuses.push({
            id: feed.id,
            generation: feed.generation,
            publishedVersion: feed.publishedVersion,
            delivery: {
              delivering: delivery.delivering,
              reason: delivery.reason,
            },
            schedule: feed.schedule,
            lastRefresh: feed.lastRefresh,
          });
        }
        return { feeds: statuses };
      },
    };
  }

  private feedProducts(): ReadOperation<FeedProductsInput> {
    return {
      name: 'list_feed_products',
      description:
        'Productos del TSV de una exportación aprobada o de una versión publicada del feed, con búsqueda.',
      level: 'read',
      permission: 'organization.read',
      inputSchema: FEED_PRODUCTS_SCHEMA,
      parse: (input) => validateAs(FeedProductsInput, input),
      targetOf: (context, input) => ({
        projectId: context.scope.projectId,
        exportId: input.exportId ?? null,
        feedId: input.feedId ?? null,
        versionId: input.versionId ?? null,
      }),
      execute: async ({ identity, scope }, input) => {
        const page = {
          limit: input.limit ?? 10,
          offset: input.offset ?? 0,
          search: input.search,
        };
        if (input.exportId) {
          return this.viewer.exportProducts(
            identity,
            scope.projectId,
            input.exportId,
            page,
          );
        }
        if (input.feedId && input.versionId) {
          return this.viewer.feedVersionProducts(
            identity,
            scope.projectId,
            input.feedId,
            input.versionId,
            page,
          );
        }
        throw apiError(ErrorCodes.VALIDATION_FAILED);
      },
    };
  }

  private changeProposal(): WriteOperation<ChangeProposalInput> {
    return {
      name: 'create_change_proposal',
      description:
        'Prepara un borrador con los cambios de una vista previa de transformación. La persona lo confirma; nunca se aplica solo.',
      level: 'write',
      permission: 'ai.use',
      inputSchema: CHANGE_PROPOSAL_SCHEMA,
      parse: (input) => validateAs(ChangeProposalInput, input),
      targetOf: (context, input) => ({
        worksheetId: worksheetOf(context, input.worksheetId),
        previewId: input.previewId,
      }),
      prepare: async (context, input) => {
        const worksheetId = worksheetOf(context, input.worksheetId);
        const preview = await this.tools.findPreview(
          context.identity,
          context.scope,
          worksheetId,
          input.previewId,
          1,
          0,
        );
        if (!preview.canCreateProposal) {
          throw apiError(ErrorCodes.AI_SHEET_PREVIEW_INVALID);
        }
        const { worksheet } = await this.worksheets.findWorksheet(
          context.identity,
          context.scope,
          worksheetId,
        );
        return {
          summary: operationText(
            context,
            `Crear un borrador en la hoja «${worksheet.name}» con ${preview.affectedCells} cambios en ${preview.affectedRows} filas: ${input.explanation}`,
            `Create a draft in “${worksheet.name}” with ${preview.affectedCells} changes across ${preview.affectedRows} rows: ${input.explanation}`,
          ),
          plan: {
            worksheetId,
            previewId: input.previewId,
            explanation: input.explanation,
          },
          target: { worksheetId, previewId: input.previewId },
        };
      },
      confirm: async (context, plan, proposalId) => {
        const proposal = await this.tools.createChangeProposal(
          context.identity,
          context.scope,
          String(plan.worksheetId),
          {
            previewId: String(plan.previewId),
            explanation: String(plan.explanation),
          },
          `agent-proposal:${proposalId}`,
        );
        return { changesetId: proposal.id, worksheetId: proposal.worksheetId };
      },
    };
  }

  private sheetCatalog(): WriteOperation<SheetCatalogInput> {
    return {
      name: 'propose_catalog_from_sheet',
      description:
        'Prepara una importación del catálogo a partir de una revisión de hoja. Usa get_sheet_schema para identificar la columna de identificadores únicos. Requiere confirmación humana.',
      level: 'write',
      permission: 'worksheet.write',
      inputSchema: SHEET_CATALOG_SCHEMA,
      parse: (input) => validateAs(SheetCatalogInput, input),
      targetOf: (context, input) => ({
        worksheetId: worksheetOf(context, input.worksheetId),
      }),
      prepare: async (context, input) => {
        const { worksheetId: requestedSheet, ...source } = input;
        const worksheetId = worksheetOf(context, requestedSheet);
        const revisionId =
          source.revisionId ??
          (worksheetId === context.context.worksheetId
            ? (context.context.revisionId ?? undefined)
            : undefined);
        const prepared = await this.worksheetCatalog.prepare(
          context.identity,
          context.scope,
          worksheetId,
          { ...source, revisionId },
        );
        return {
          summary: operationText(
            context,
            `Crear una importación desde «${prepared.worksheetName}» usando «${prepared.idColumnName}» como identificador.`,
            `Create an import from “${prepared.worksheetName}” using “${prepared.idColumnName}” as the ID column.`,
          ),
          plan: {
            worksheetId,
            source: asPlainJson({ ...source, revisionId: prepared.revisionId }),
            jobId: randomUUID(),
          },
          target: { worksheetId },
        };
      },
      confirm: async (context, plan, proposalId) => {
        const source = await validateAs(SheetCatalogInput, plan.source);
        const { snapshotId, jobId } = await this.worksheetCatalog.create(
          context.identity,
          context.scope,
          String(plan.worksheetId),
          source,
          proposalId,
          { snapshotId: proposalId, jobId: String(plan.jobId) },
        );
        return { snapshotId, jobId };
      },
    };
  }

  private sheetLayout(): WriteOperation<SheetLayoutInput> {
    return {
      name: 'propose_sheet_layout',
      description:
        'Prepara una hoja nueva y vacía (nombre y columnas tipadas) en un libro. La persona la confirma y entonces se crea.',
      level: 'write',
      permission: 'worksheet.write',
      inputSchema: SHEET_LAYOUT_SCHEMA,
      parse: (input) => validateAs(SheetLayoutInput, input),
      targetOf: (context, input) => ({
        workbookId: input.workbookId ?? context.context.workbookId,
      }),
      prepare: async (context, input) => {
        const workbookId = workbookOf(
          input.workbookId ?? context.context.workbookId,
        );
        // Que el libro exista y se vea, con los 404 de siempre.
        await this.worksheets.findWorksheets(
          context.identity,
          context.scope,
          workbookId,
          { limit: 1, offset: 0 },
        );
        const columns = asPlainJson(input.columns);
        const names = columns.map((column) => column.name).join(', ');
        return {
          summary: operationText(
            context,
            `Crear la hoja vacía «${input.name}» con ${columns.length} columnas: ${names}.`,
            `Create the empty sheet “${input.name}” with ${columns.length} columns: ${names}.`,
          ),
          plan: { workbookId, name: input.name, columns },
          target: { workbookId },
        };
      },
      confirm: async (context, plan) => {
        const body = await validateAs(CreateWorksheetDto, {
          name: plan.name,
          columns: plan.columns,
        });
        const { worksheet } = await this.worksheets.createWorksheet(
          context.identity,
          context.scope,
          String(plan.workbookId),
          body,
        );
        return { worksheetId: worksheet.id, name: worksheet.name };
      },
    };
  }

  private suggestView(): WriteOperation<SuggestViewInput> {
    return {
      name: 'suggest_view',
      description:
        'Prepara una vista personal (filtro, orden y columnas) de una hoja. La persona la confirma y entonces se guarda.',
      level: 'write',
      permission: 'organization.read',
      inputSchema: SUGGEST_VIEW_SCHEMA,
      parse: (input) => validateAs(SuggestViewInput, input),
      targetOf: (context, input) => ({
        worksheetId: worksheetOf(context, input.worksheetId),
      }),
      prepare: async (context, input) => {
        const worksheetId = worksheetOf(context, input.worksheetId);
        const { worksheet } = await this.worksheets.findWorksheet(
          context.identity,
          context.scope,
          worksheetId,
        );
        const query = asPlainJson(input.query);
        return {
          summary: operationText(
            context,
            `Guardar la vista personal «${input.name}» de la hoja «${worksheet.name}».`,
            `Save the personal view “${input.name}” for the sheet “${worksheet.name}”.`,
          ),
          plan: { worksheetId, name: input.name, query },
          target: { worksheetId },
        };
      },
      confirm: async (context, plan) => {
        const body = await validateAs(SaveViewDto, {
          name: plan.name,
          visibility: 'personal',
          query: plan.query,
        });
        const view = await this.views.create(
          context.identity,
          context.scope,
          String(plan.worksheetId),
          body,
        );
        return { savedViewId: view.id, worksheetId: view.worksheetId };
      },
    };
  }
}

function workbookOf(workbookId: string | null): string {
  if (!workbookId) {
    throw apiError(ErrorCodes.WORKBOOK_NOT_FOUND);
  }
  return workbookId;
}

function revisionOf(
  context: OperationContext,
  worksheetId: string,
  requestedRevisionId: string | undefined,
): string | undefined {
  if (requestedRevisionId) return requestedRevisionId;
  if (worksheetId === context.context.worksheetId) {
    return context.context.revisionId ?? undefined;
  }
}

/** El plan se guarda como JSON: sin las clases del DTO que lo validó. */
function asPlainJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
