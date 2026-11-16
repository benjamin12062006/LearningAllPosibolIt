import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import type { ImportRow } from '../catalog-import/import.types.js';
import {
  fetchWindow,
  resolvePage,
  toPage,
  type PageRequest,
  type PaginationQueryDto,
} from '../common/http/pagination.js';
import { ProjectsService } from '../projects/projects.service.js';
import {
  assertRulesetIsConsistent,
  toRuleset,
} from '../rulesets/rulesets.service.js';
import { UsersService } from '../users/users.service.js';
import { evaluateRow } from './engine/evaluate-row.js';
import { buildErrorsCsv } from './errors-csv.js';
import type {
  CreateEvaluationDto,
  EvaluationRowsQueryDto,
  PreviewRulesDto,
} from './evaluations.dto.js';
import {
  assertColumnsExist,
  EvaluationsRepository,
} from './evaluations.repository.js';
import type { RowProblem } from './engine/google-merchant.profile.js';
import {
  EVALUATION_LIMITS,
  SAMPLE_ROWS,
  type AttentionView,
  type EvaluationView,
  type PreviewedOutcomeView,
  type ProblemGroupView,
  type ProductPreviewView,
  type RowFilter,
  type RulesPreviewView,
} from './evaluations.types.js';
import { EvaluationWorker } from './evaluations.worker.js';
import { describeProblem, type Language } from './problem-messages.js';
import {
  compareOutcomes,
  type PreviewedOutcome,
  type ProblemCount,
  type ProductPreview,
  type RulesComparison,
} from './rules-preview.js';

@Injectable()
export class EvaluationsService {
  constructor(
    private readonly usersService: UsersService,
    private readonly projectsService: ProjectsService,
    private readonly repository: EvaluationsRepository,
    private readonly worker: EvaluationWorker,
  ) {}

  /**
   * Deja la evaluación en cola y responde sin esperarla: el cliente consulta
   * `statusUrl` hasta que termine.
   */
  async accept(
    identity: AuthenticatedIdentity,
    projectId: string,
    input: CreateEvaluationDto,
  ) {
    const owner = await this.usersService.findCurrent(identity);
    const evaluationId = randomUUID();

    await this.repository.accept({
      evaluationId,
      ownerId: owner.id,
      projectId,
      snapshotId: input.snapshotId,
      rulesetRevision: input.rulesetRevision,
    });
    this.worker.wake();

    return {
      evaluationId,
      status: 'queued' as const,
      statusUrl: `/api/v1/projects/${projectId}/evaluations/${evaluationId}`,
    };
  }

  /**
   * Encola una evaluación con el id que quien llama ya guardó (la actualización
   * del feed, D9 de feeds&publications). Mismas comprobaciones que `accept`; el
   * propietario ya está resuelto.
   */
  async acceptPlanned(
    request: {
      evaluationId: string;
      ownerId: string;
      projectId: string;
      snapshotId: string;
      rulesetRevision: number;
    },
    idempotent = false,
  ) {
    await this.repository.accept(request, idempotent);
    this.worker.wake();
  }

  /** La evaluación y, solo si terminó bien, una muestra de sus primeras filas. */
  async findOne(
    identity: AuthenticatedIdentity,
    projectId: string,
    evaluationId: string,
  ) {
    const evaluation = await this.findOwned(identity, projectId, evaluationId);
    const sample = hasResults(evaluation)
      ? await this.repository.findRows(evaluationId, {
          limit: SAMPLE_ROWS,
          offset: 0,
        })
      : [];
    return { evaluation, sample };
  }

  /**
   * La evaluación sin la muestra de filas: GraphQL la pide así porque las
   * filas son un campo aparte que el cliente elige.
   */
  findSummary(
    identity: AuthenticatedIdentity,
    projectId: string,
    evaluationId: string,
  ): Promise<EvaluationView> {
    return this.findOwned(identity, projectId, evaluationId);
  }

  /** Informe paginado (D10): las filas en orden, opcionalmente de un resultado. */
  async findRows(
    identity: AuthenticatedIdentity,
    projectId: string,
    evaluationId: string,
    query: EvaluationRowsQueryDto,
  ) {
    const evaluation = await this.findOwned(identity, projectId, evaluationId);
    assertHasResults(evaluation);

    const page = resolvePage(query);
    const rows = await this.repository.findRows(
      evaluationId,
      fetchWindow(page),
      rowFilterOf(query),
    );
    return toPage(rows, page);
  }

  /**
   * Prueba unas reglas sin guardarlas (plan 02 de cierre, P6): evalúa el
   * catálogo con la revisión guardada y con las propuestas, con el mismo motor
   * que una evaluación real, y dice qué cambia. No escribe nada, pero pide el
   * permiso de quien edita reglas: es parte de prepararlas.
   */
  async previewRules(
    identity: AuthenticatedIdentity,
    projectId: string,
    input: PreviewRulesDto,
    query: PaginationQueryDto,
  ): Promise<RulesPreviewView> {
    await this.projectsService.requireAccess(
      identity,
      projectId,
      'worksheet.write',
    );
    const proposed = toRuleset(input);
    assertRulesetIsConsistent(proposed);

    const source = await this.repository.findPreviewSource(
      projectId,
      input.snapshotId,
      input.baseRevision,
    );
    assertColumnsExist(source.base.ruleset.mapping, source.headers);
    assertColumnsExist(proposed.mapping, source.headers);

    const rows = await this.readCatalog(input.snapshotId);
    const context = { currency: source.currency };
    const comparison = compareOutcomes(
      rows.map((row) => evaluateRow(row, source.base.ruleset, context)),
      rows.map((row) => evaluateRow(row, proposed, context)),
    );
    return toPreviewView(comparison, {
      snapshotId: input.snapshotId,
      baseRevision: source.base.revision,
      page: resolvePage(query),
    });
  }

  /**
   * El catálogo entero, leído por lotes como hace el worker. Cabe en memoria:
   * una importación tiene como mucho 5.000 filas (`IMPORT_LIMITS.rows`).
   */
  private async readCatalog(snapshotId: string): Promise<ImportRow[]> {
    const rows: ImportRow[] = [];
    let lastRow = 0;
    for (;;) {
      const batch = await this.repository.readCatalogRows(
        snapshotId,
        lastRow,
        EVALUATION_LIMITS.batchRows,
      );
      rows.push(...batch);
      if (batch.length < EVALUATION_LIMITS.batchRows) {
        return rows;
      }
      lastRow = batch[batch.length - 1].sourceRow;
    }
  }

  /**
   * «Requiere atención» (plan 02 de cierre, P4): los problemas agrupados y las
   * exclusiones aparte. El total de afectados es el de productos inválidos de
   * la evaluación: cada uno cuenta una vez aunque esté en varios grupos.
   */
  async findAttention(
    identity: AuthenticatedIdentity,
    projectId: string,
    evaluationId: string,
  ): Promise<AttentionView> {
    const evaluation = await this.findOwned(identity, projectId, evaluationId);
    assertHasResults(evaluation);

    const problemGroups = await this.repository.findProblemGroups(evaluationId);
    return {
      evaluationId,
      affectedProducts: evaluation.counts?.invalid ?? 0,
      problemGroups: problemGroups.map(({ productCount, ...problem }) => ({
        ...describeProblem(problem),
        productCount,
      })),
      excludedProducts: evaluation.counts?.excluded ?? 0,
      exclusionGroups: await this.repository.findExclusionGroups(evaluationId),
    };
  }

  /**
   * Evaluaciones del proyecto, de la más reciente a la más antigua y sin
   * muestra. Un proyecto ajeno responde 404 como en el resto de listados.
   */
  async findAll(
    identity: AuthenticatedIdentity,
    projectId: string,
    query: PaginationQueryDto,
  ) {
    const owner = await this.usersService.findCurrent(identity);
    await this.projectsService.findVisible(identity, projectId);

    const page = resolvePage(query);
    const evaluations = await this.repository.findAllByOwner(
      owner.id,
      projectId,
      fetchWindow(page),
    );
    return toPage(evaluations, page);
  }

  async buildErrorsCsv(
    identity: AuthenticatedIdentity,
    projectId: string,
    evaluationId: string,
    language: Language,
  ) {
    const evaluation = await this.findOwned(identity, projectId, evaluationId);
    assertHasResults(evaluation);

    const rows = await this.repository.findInvalidRows(evaluationId);
    return buildErrorsCsv(rows, language);
  }

  private async findOwned(
    identity: AuthenticatedIdentity,
    projectId: string,
    evaluationId: string,
  ) {
    const owner = await this.usersService.findCurrent(identity);
    await this.projectsService.findVisible(identity, projectId);
    const evaluation = await this.repository.findByOwner(
      owner.id,
      projectId,
      evaluationId,
    );
    if (!evaluation) {
      throw apiError(ErrorCodes.EVALUATION_NOT_FOUND);
    }
    return evaluation;
  }
}

/** La vista previa con los problemas descritos y solo la página pedida de productos. */
function toPreviewView(
  comparison: RulesComparison,
  request: Readonly<{
    snapshotId: string;
    baseRevision: number;
    page: PageRequest;
  }>,
): RulesPreviewView {
  const { page } = request;
  // Una fila de más, como en los repositorios, para saber si hay otra página.
  const window = comparison.products.slice(
    page.offset,
    page.offset + page.limit + 1,
  );
  const { items, page: pageInfo } = toPage(window, page);
  return {
    snapshotId: request.snapshotId,
    baseRevision: request.baseRevision,
    counts: comparison.counts,
    problems: {
      appeared: comparison.problems.appeared.map(describeProblemCount),
      resolved: comparison.problems.resolved.map(describeProblemCount),
      persisting: comparison.problems.persisting.map(describeProblemCount),
    },
    outcomeChanges: comparison.outcomeChanges,
    changedValues: comparison.changedValues,
    changedProducts: comparison.products.length,
    products: items.map(describeProductPreview),
    page: pageInfo,
  };
}

function describeProblemCount({
  productCount,
  ...problem
}: ProblemCount): ProblemGroupView {
  return { ...describeProblem(problem), productCount };
}

function describeProductPreview(product: ProductPreview): ProductPreviewView {
  return {
    ...product,
    current: describeOutcome(product.current),
    proposed: describeOutcome(product.proposed),
  };
}

function describeOutcome(outcome: PreviewedOutcome): PreviewedOutcomeView {
  return { ...outcome, problems: outcome.problems.map(describeProblem) };
}

/** El filtro del informe a partir de la consulta ya validada. */
function rowFilterOf(query: EvaluationRowsQueryDto): RowFilter {
  return {
    outcome: query.outcome,
    problem: problemOf(query),
    excludedByRule: query.rule,
  };
}

/** La validación garantiza que `attribute` y `code` llegan juntos o no llegan. */
function problemOf({
  attribute,
  code,
}: EvaluationRowsQueryDto): RowProblem | undefined {
  if (attribute === undefined || code === undefined) {
    return undefined;
  }
  return { attribute, code };
}

/** Solo una evaluación terminada bien tiene filas completas y confirmadas. */
function hasResults(evaluation: EvaluationView) {
  return evaluation.status === 'succeeded';
}

function assertHasResults(evaluation: EvaluationView) {
  if (!hasResults(evaluation)) {
    throw apiError(ErrorCodes.EVALUATION_RESULTS_UNAVAILABLE);
  }
}
