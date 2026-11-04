import { Injectable } from '@nestjs/common';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import type { PageRequest } from '../common/http/pagination.js';
import {
  localizeStoredError,
  publicError,
  type PublicError,
  type ValidationIssue,
} from '../common/http/public-error.js';
import type { ImportRow } from '../catalog-import/import.types.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { describeProblem, isRowProblem } from './problem-messages.js';
import { ENGINE_VERSION, type RowOutcome } from './engine/evaluate-row.js';
import type { EvaluationResult } from './engine/evaluation-summary.js';
import {
  isProductValues,
  PROFILE_VERSION,
  type ProductValues,
  type RowProblem,
} from './engine/google-merchant.profile.js';
import { isRuleset, type AttributeMapping } from './engine/ruleset.js';
import type { InvalidRow } from './errors-csv.js';
import {
  EvaluationFailure,
  type ClaimedEvaluation,
  type EvaluationCountsView,
  type EvaluationRequest,
  type EvaluationRowView,
  type RowOutcomeKind,
  type EvaluationStatus,
  type EvaluationView,
} from './evaluations.types.js';

type IdRow = { id: string };

type SnapshotForEvaluationRow = { status: string; headers: unknown };

type RulesetForEvaluationRow = { id: string; mapping: unknown; rules: unknown };

type StatusRow = { status: EvaluationStatus };

type OutcomeCountRow = { outcome: RowOutcome['outcome']; count: number };

type EvaluationRow = {
  id: string;
  snapshotId: string;
  rulesetRevision: number;
  engineVersion: string;
  profileVersion: string;
  status: EvaluationStatus;
  totalCount: number | null;
  validCount: number | null;
  invalidCount: number | null;
  excludedCount: number | null;
  resultChecksum: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: unknown;
};

/** `product_values` y `problems` llegan de `jsonb` sin tipo; se comprueban al leer. */
type StoredEvaluationRow = {
  sourceRow: number;
  externalId: string;
  outcome: RowOutcomeKind;
  productValues: unknown;
  problems: unknown;
  excludedByRule: number | null;
};

const ACTIVE_STATUSES: EvaluationStatus[] = ['queued', 'running'];

/** Vista pública de una evaluación; la comparten la consulta de una y el listado. */
const EVALUATION_COLUMNS = Prisma.sql`
  e.id,
  e.snapshot_id AS "snapshotId",
  r.revision AS "rulesetRevision",
  e.engine_version AS "engineVersion",
  e.profile_version AS "profileVersion",
  e.status,
  e.total_count AS "totalCount",
  e.valid_count AS "validCount",
  e.invalid_count AS "invalidCount",
  e.excluded_count AS "excludedCount",
  e.result_checksum AS "resultChecksum",
  e.created_at AS "createdAt",
  e.started_at AS "startedAt",
  e.finished_at AS "finishedAt",
  e.error
`;

/** El proyecto da el propietario y la versión de reglas da su número de revisión. */
const EVALUATION_SOURCE = Prisma.sql`
  FROM estadistica_forms.evaluations e
  JOIN estadistica_forms.projects p ON p.id = e.project_id
  JOIN estadistica_forms.ruleset_versions r
    ON r.project_id = e.project_id AND r.id = e.ruleset_version_id
`;

const ROW_COLUMNS = Prisma.sql`
  source_row AS "sourceRow",
  external_id AS "externalId",
  outcome,
  product_values AS "productValues",
  problems,
  excluded_by_rule AS "excludedByRule"
`;

@Injectable()
export class EvaluationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Peticiones del propietario: aceptar y consultar.
  // ---------------------------------------------------------------------------

  /**
   * Registra la evaluación en cola con el snapshot y la revisión fijados, o la
   * rechaza. Si otra evaluación activa entró a la vez, responde 409.
   */
  async accept(request: EvaluationRequest) {
    try {
      await this.insertQueued(request);
    } catch (error) {
      throw asAlreadyActive(error);
    }
  }

  async findByOwner(
    ownerId: string,
    projectId: string,
    evaluationId: string,
  ): Promise<EvaluationView | null> {
    const rows = await this.prisma.$queryRaw<EvaluationRow[]>`
      SELECT ${EVALUATION_COLUMNS}
      ${EVALUATION_SOURCE}
      WHERE e.id = ${evaluationId}
        AND p.id = ${projectId}
        AND p.owner_id = ${ownerId}`;
    return rows[0] ? toEvaluationView(rows[0]) : null;
  }

  /**
   * Evaluaciones del proyecto, de la más reciente a la más antigua. El `id`
   * desempata las creadas en el mismo instante para que las páginas no
   * repitan ni salten filas.
   */
  async findAllByOwner(
    ownerId: string,
    projectId: string,
    window: PageRequest,
  ): Promise<EvaluationView[]> {
    const rows = await this.prisma.$queryRaw<EvaluationRow[]>`
      SELECT ${EVALUATION_COLUMNS}
      ${EVALUATION_SOURCE}
      WHERE p.id = ${projectId}
        AND p.owner_id = ${ownerId}
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT ${window.limit} OFFSET ${window.offset}`;
    return rows.map(toEvaluationView);
  }

  /** Filas de una evaluación en orden de `source_row`, opcionalmente de un resultado. */
  async findRows(
    evaluationId: string,
    page: { limit: number; offset: number },
    outcome?: RowOutcomeKind,
  ): Promise<EvaluationRowView[]> {
    const onlyOutcome = outcome
      ? Prisma.sql`AND outcome = ${outcome}`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<StoredEvaluationRow[]>`
      SELECT ${ROW_COLUMNS}
      FROM estadistica_forms.evaluation_rows
      WHERE evaluation_id = ${evaluationId}
        ${onlyOutcome}
      ORDER BY source_row
      LIMIT ${page.limit} OFFSET ${page.offset}`;
    return rows.map(toRowView);
  }

  /** Todas las filas inválidas, para `errores.csv`: como mucho 5.000. */
  async findInvalidRows(evaluationId: string): Promise<InvalidRow[]> {
    const rows = await this.prisma.$queryRaw<StoredEvaluationRow[]>`
      SELECT ${ROW_COLUMNS}
      FROM estadistica_forms.evaluation_rows
      WHERE evaluation_id = ${evaluationId}
        AND outcome = 'invalid'
      ORDER BY source_row`;
    return rows.map((row) => ({
      sourceRow: row.sourceRow,
      externalId: row.externalId,
      problems: readProblems(row),
    }));
  }

  // ---------------------------------------------------------------------------
  // Trabajo del worker: reclamar, guardar lotes y cerrar la evaluación.
  // ---------------------------------------------------------------------------

  /**
   * Toma la evaluación en cola más antigua y la marca como `running`, con todo
   * lo que el motor necesita. SKIP LOCKED evita que dos workers tomen la misma.
   */
  claim(): Promise<ClaimedEvaluation | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<ClaimedEvaluation[]>`
        SELECT
          e.id,
          e.snapshot_id AS "snapshotId",
          s.row_count AS "rowCount",
          s.project_configuration ->> 'currency' AS "currency",
          r.mapping,
          r.rules
        FROM estadistica_forms.evaluations e
        JOIN estadistica_forms.catalog_snapshots s
          ON s.project_id = e.project_id AND s.id = e.snapshot_id
        JOIN estadistica_forms.ruleset_versions r
          ON r.project_id = e.project_id AND r.id = e.ruleset_version_id
        WHERE e.status = 'queued'
        ORDER BY e.created_at, e.id
        LIMIT 1
        FOR UPDATE OF e SKIP LOCKED`;
      const evaluation = rows[0];
      if (!evaluation) {
        return null;
      }

      await tx.evaluation.update({
        where: { id: evaluation.id },
        data: { status: 'running', startedAt: new Date().toISOString() },
      });
      return evaluation;
    });
  }

  /** Lee el siguiente lote por `source_row`, sin repetir ni saltar filas. */
  readCatalogRows(
    snapshotId: string,
    afterSourceRow: number,
    limit: number,
  ): Promise<ImportRow[]> {
    return this.prisma.$queryRaw<ImportRow[]>`
      SELECT
        source_row AS "sourceRow",
        external_id AS "externalId",
        original_values AS "originalValues"
      FROM estadistica_forms.catalog_rows
      WHERE snapshot_id = ${snapshotId}
        AND source_row > ${afterSourceRow}
      ORDER BY source_row
      LIMIT ${limit}`;
  }

  appendRows(evaluationId: string, outcomes: readonly RowOutcome[]) {
    return this.prisma.$transaction(async (tx) => {
      await lockRunning(tx, evaluationId);
      await tx.evaluationRow.createMany({
        data: outcomes.map((outcome) => toStoredRow(evaluationId, outcome)),
      });
    });
  }

  /**
   * Confirma la evaluación solo si lo guardado coincide con lo que contó el
   * motor y con las filas del snapshot (D7): si no, falla por integridad.
   */
  complete(evaluation: ClaimedEvaluation, result: EvaluationResult) {
    return this.prisma.$transaction(async (tx) => {
      await lockRunning(tx, evaluation.id);
      const stored = await countStoredOutcomes(tx, evaluation.id);
      if (!matchesResult(stored, result, evaluation.rowCount)) {
        throw new EvaluationFailure(ErrorCodes.EVALUATION_INTEGRITY_FAILED);
      }

      await tx.evaluation.update({
        where: { id: evaluation.id },
        data: {
          status: 'succeeded',
          totalCount: result.counts.total,
          validCount: result.counts.valid,
          invalidCount: result.counts.invalid,
          excludedCount: result.counts.excluded,
          resultChecksum: result.checksum,
          finishedAt: new Date().toISOString(),
        },
      });
    });
  }

  /**
   * Guarda el error público y borra las filas parciales, que ya no sirven. No
   * toca una evaluación que ya terminó.
   */
  fail(evaluationId: string, error: PublicError) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<StatusRow[]>`
        SELECT status
        FROM estadistica_forms.evaluations
        WHERE id = ${evaluationId}
        FOR UPDATE`;
      if (!isActive(rows[0])) {
        return;
      }

      await tx.evaluationRow.deleteMany({ where: { evaluationId } });
      await tx.evaluation.update({
        where: { id: evaluationId },
        data: { status: 'failed', finishedAt: new Date().toISOString(), error },
      });
    });
  }

  /** Al arrancar o al apagar: las evaluaciones `running` no pueden continuar. */
  interruptRunning() {
    return this.prisma.$transaction(async (tx) => {
      await tx.evaluationRow.deleteMany({
        where: { evaluation: { status: 'running' } },
      });
      const interrupted = await tx.evaluation.updateMany({
        where: { status: 'running' },
        data: {
          status: 'failed',
          finishedAt: new Date().toISOString(),
          error: publicError(ErrorCodes.EVALUATION_INTERRUPTED),
        },
      });
      return interrupted.count;
    });
  }

  private insertQueued(request: EvaluationRequest) {
    return this.prisma.$transaction(async (tx) => {
      await lockOwnedProject(tx, request.ownerId, request.projectId);
      const headers = await readReadySnapshotHeaders(tx, request);
      const ruleset = await readRuleset(tx, request);
      assertColumnsExist(ruleset.mapping, headers);
      if (await hasActiveEvaluation(tx, request.projectId)) {
        throw apiError(ErrorCodes.EVALUATION_ALREADY_ACTIVE);
      }

      // Con la API del modelo, el índice único parcial llega como P2002 (ficha 07).
      await tx.evaluation.create({
        data: {
          id: request.evaluationId,
          projectId: request.projectId,
          snapshotId: request.snapshotId,
          rulesetVersionId: ruleset.id,
          engineVersion: ENGINE_VERSION,
          profileVersion: PROFILE_VERSION,
          status: 'queued',
          createdAt: new Date().toISOString(),
        },
      });
    });
  }
}

/**
 * FOR UPDATE sobre el proyecto: el mismo bloqueo que borrar el proyecto, así
 * que no se puede aceptar una evaluación mientras se borra.
 */
async function lockOwnedProject(
  tx: Prisma.TransactionClient,
  ownerId: string,
  projectId: string,
) {
  const projects = await tx.$queryRaw<IdRow[]>`
    SELECT id
    FROM estadistica_forms.projects
    WHERE id = ${projectId} AND owner_id = ${ownerId}
    FOR UPDATE`;
  if (!projects[0]) {
    throw apiError(ErrorCodes.PROJECT_NOT_FOUND);
  }
}

/**
 * FOR SHARE sobre el snapshot: borrar una importación lo bloquea con FOR
 * UPDATE, así que o el borrado espera y ve esta evaluación activa, o esta
 * lectura espera y ya no encuentra el snapshot.
 */
async function readReadySnapshotHeaders(
  tx: Prisma.TransactionClient,
  request: EvaluationRequest,
): Promise<string[]> {
  const rows = await tx.$queryRaw<SnapshotForEvaluationRow[]>`
    SELECT status, headers
    FROM estadistica_forms.catalog_snapshots
    WHERE id = ${request.snapshotId} AND project_id = ${request.projectId}
    FOR SHARE`;
  const snapshot = rows[0];
  if (!snapshot) {
    throw apiError(ErrorCodes.IMPORT_NOT_FOUND);
  }
  if (snapshot.status !== 'ready' || !isTextList(snapshot.headers)) {
    throw apiError(ErrorCodes.EVALUATION_SNAPSHOT_NOT_READY);
  }
  return snapshot.headers;
}

async function readRuleset(
  tx: Prisma.TransactionClient,
  request: EvaluationRequest,
) {
  const rows = await tx.$queryRaw<RulesetForEvaluationRow[]>`
    SELECT id, mapping, rules
    FROM estadistica_forms.ruleset_versions
    WHERE project_id = ${request.projectId}
      AND revision = ${request.rulesetRevision}`;
  const row = rows[0];
  if (!row) {
    throw apiError(ErrorCodes.RULESET_NOT_FOUND);
  }
  const ruleset = { mapping: row.mapping, rules: row.rules };
  if (!isRuleset(ruleset)) {
    throw new Error(`La versión de reglas ${row.id} tiene una forma inválida.`);
  }
  return { id: row.id, ...ruleset };
}

/**
 * Una revisión es del proyecto y puede aplicarse a importaciones con columnas
 * distintas: aquí se comprueba contra las cabeceras de este snapshot (D2).
 */
function assertColumnsExist(
  mapping: readonly AttributeMapping[],
  headers: readonly string[],
) {
  const available = new Set(headers);
  const issues: ValidationIssue[] = mapping
    .filter(({ column }) => !available.has(column))
    .map(({ attribute }) => ({
      field: `mapping.${attribute}`,
      ...publicError(ErrorCodes.EVALUATION_COLUMN_MISSING),
    }));
  if (issues.length > 0) {
    throw apiError(ErrorCodes.EVALUATION_COLUMN_MISSING, issues);
  }
}

/** Solo es fiable con la fila del proyecto bloqueada en `tx`. */
async function hasActiveEvaluation(
  tx: Prisma.TransactionClient,
  projectId: string,
) {
  const active = await tx.evaluation.findFirst({
    where: { projectId, status: { in: ACTIVE_STATUSES } },
    select: { id: true },
  });
  return active !== null;
}

/** Bloquea la evaluación y falla si ya no está `running` (por ejemplo, interrumpida). */
async function lockRunning(tx: Prisma.TransactionClient, id: string) {
  const rows = await tx.$queryRaw<StatusRow[]>`
    SELECT status
    FROM estadistica_forms.evaluations
    WHERE id = ${id}
    FOR UPDATE`;
  if (rows[0]?.status !== 'running') {
    throw new EvaluationFailure(ErrorCodes.EVALUATION_INTERRUPTED);
  }
}

async function countStoredOutcomes(
  tx: Prisma.TransactionClient,
  evaluationId: string,
) {
  const rows = await tx.$queryRaw<OutcomeCountRow[]>`
    SELECT outcome, count(*)::int AS count
    FROM estadistica_forms.evaluation_rows
    WHERE evaluation_id = ${evaluationId}
    GROUP BY outcome`;
  const countOf = (outcome: RowOutcome['outcome']) =>
    rows.find((row) => row.outcome === outcome)?.count ?? 0;
  return {
    valid: countOf('valid'),
    invalid: countOf('invalid'),
    excluded: countOf('excluded'),
  };
}

/**
 * Tres comprobaciones de la misma invariante: lo guardado coincide con lo que
 * contó el motor, y el total es el número de filas del snapshot.
 */
function matchesResult(
  stored: { valid: number; invalid: number; excluded: number },
  result: EvaluationResult,
  snapshotRows: number,
) {
  return (
    stored.valid === result.counts.valid &&
    stored.invalid === result.counts.invalid &&
    stored.excluded === result.counts.excluded &&
    result.counts.total === snapshotRows
  );
}

/**
 * Una fila excluida no tiene valores: se guarda NULL de SQL (`Prisma.DbNull`),
 * no el `null` de JSON (F25).
 */
function toStoredRow(evaluationId: string, outcome: RowOutcome) {
  const row = {
    evaluationId,
    sourceRow: outcome.sourceRow,
    externalId: outcome.externalId,
    outcome: outcome.outcome,
  };
  switch (outcome.outcome) {
    case 'excluded':
      return {
        ...row,
        productValues: Prisma.DbNull,
        problems: [],
        excludedByRule: outcome.excludedByRule,
      };
    case 'invalid':
      return {
        ...row,
        productValues: outcome.values,
        problems: outcome.problems,
      };
    case 'valid':
      return { ...row, productValues: outcome.values, problems: [] };
  }
}

/** Dentro del alta, la única clave única que puede repetirse es la de evaluación activa. */
function asAlreadyActive(error: unknown) {
  const isUniqueViolation =
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002';
  return isUniqueViolation
    ? apiError(ErrorCodes.EVALUATION_ALREADY_ACTIVE)
    : error;
}

function isActive(row: StatusRow | undefined) {
  return row !== undefined && ACTIVE_STATUSES.includes(row.status);
}

function isTextList(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function toRowView(row: StoredEvaluationRow): EvaluationRowView {
  return {
    sourceRow: row.sourceRow,
    externalId: row.externalId,
    outcome: row.outcome,
    values: readProductValues(row),
    problems: readProblems(row).map(describeProblem),
    excludedByRule: row.excludedByRule,
  };
}

/** Solo el worker escribe estas filas; una forma distinta es un error del backend. */
function readProblems(row: StoredEvaluationRow): RowProblem[] {
  if (!Array.isArray(row.problems) || !row.problems.every(isRowProblem)) {
    throw new Error(
      `La fila ${row.sourceRow} tiene problemas con forma inválida.`,
    );
  }
  return row.problems;
}

function readProductValues(row: StoredEvaluationRow): ProductValues | null {
  if (row.productValues === null) {
    return null;
  }
  if (!isProductValues(row.productValues)) {
    throw new Error(
      `La fila ${row.sourceRow} tiene valores con forma inválida.`,
    );
  }
  return row.productValues;
}

function toEvaluationView(row: EvaluationRow): EvaluationView {
  const {
    totalCount: _total,
    validCount: _valid,
    invalidCount: _invalid,
    excludedCount: _excluded,
    error,
    ...evaluation
  } = row;
  return {
    ...evaluation,
    counts: toCounts(row),
    error: localizeStoredError(error),
  };
}

/** La migración exige los cuatro conteos juntos o ninguno; solo existen al terminar bien. */
function toCounts(row: EvaluationRow): EvaluationCountsView | null {
  if (
    row.totalCount === null ||
    row.validCount === null ||
    row.invalidCount === null ||
    row.excludedCount === null
  ) {
    return null;
  }
  return {
    total: row.totalCount,
    valid: row.validCount,
    invalid: row.invalidCount,
    excluded: row.excludedCount,
  };
}
