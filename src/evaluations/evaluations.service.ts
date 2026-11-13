import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import {
  fetchWindow,
  resolvePage,
  toPage,
  type PaginationQueryDto,
} from '../common/http/pagination.js';
import { ProjectsService } from '../projects/projects.service.js';
import { UsersService } from '../users/users.service.js';
import { buildErrorsCsv } from './errors-csv.js';
import type {
  CreateEvaluationDto,
  EvaluationRowsQueryDto,
} from './evaluations.dto.js';
import { EvaluationsRepository } from './evaluations.repository.js';
import type { RowProblem } from './engine/google-merchant.profile.js';
import {
  SAMPLE_ROWS,
  type AttentionView,
  type EvaluationView,
  type RowFilter,
} from './evaluations.types.js';
import { EvaluationWorker } from './evaluations.worker.js';
import { describeProblem, type Language } from './problem-messages.js';

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
  async acceptPlanned(request: {
    evaluationId: string;
    ownerId: string;
    projectId: string;
    snapshotId: string;
    rulesetRevision: number;
  }) {
    await this.repository.accept(request);
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
