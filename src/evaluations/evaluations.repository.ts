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
import {
  assertProjectPermission,
  isProjectMember,
  joinProjectAccess,
  PROJECT_ACCESS_COLUMNS,
  type ProjectMemberAccess,
} from '../projects/project-access.js';
import {
  claimIsCurrent,
  LostClaimError,
  newExecutionToken,
  nowPlus,
  type JobClaim,
} from '../jobs/lease-sql.js';
import { retryDelay, type RetryOptions } from '../jobs/retry-delay.js';
import { describeProblem, isRowProblem } from './problem-messages.js';
import { ENGINE_VERSION, type RowOutcome } from './engine/evaluate-row.js';
import type { EvaluationResult } from './engine/evaluation-summary.js';
import {
  isProductValues,
  PROFILE_VERSION,
  type ProductValues,
  type RowProblem,
} from './engine/google-merchant.profile.js';
import {
  isRuleset,
  type AttributeMapping,
  type Ruleset,
} from './engine/ruleset.js';
import type { InvalidRow } from './errors-csv.js';
import {
  CURRENCY_PATTERN,
  EVALUATION_JOB_DEFAULTS,
  EvaluationFailure,
  type ClaimedEvaluation,
  type EvaluationCountsView,
  type EvaluationRequest,
  type EvaluationRowView,
  type EvaluationStatus,
  type ExclusionGroupView,
  type RowFilter,
  type RowOutcomeKind,
  type EvaluationView,
} from './evaluations.types.js';

type IdRow = { id: string };

type PreviewSnapshotRow = {
  status: string;
  headers: unknown;
  currency: unknown;
};

type BaseRulesetRow = RulesetForEvaluationRow & { revision: number };

/** El catálogo listo y la revisión con la que se compara una vista previa. */
export type PreviewSource = Readonly<{
  headers: readonly string[];
  currency: string;
  base: Readonly<{ revision: number; ruleset: Ruleset }>;
}>;

/** Un grupo de problemas tal como sale de la base, sin textos. */
export type ProblemGroupRow = RowProblem & { productCount: number };

type SnapshotForEvaluationRow = { status: string; headers: unknown };

type RulesetForEvaluationRow = { id: string; mapping: unknown; rules: unknown };

/** Una evaluación `running` con el lease vencido, a punto de recuperarse. */
type ExpiredEvaluationRow = { id: string; attempts: number };

/** Una evaluación lista para reclamar, con lo que el motor necesita. */
type ReadyEvaluationRow = Omit<ClaimedEvaluation, 'token' | 'leaseMs'>;

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
        AND ${isProjectMember(ownerId)}`;
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
        AND ${isProjectMember(ownerId)}
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT ${window.limit} OFFSET ${window.offset}`;
    return rows.map(toEvaluationView);
  }

  /** Filas de una evaluación en orden de `source_row`, opcionalmente filtradas. */
  async findRows(
    evaluationId: string,
    page: { limit: number; offset: number },
    filter: RowFilter = {},
  ): Promise<EvaluationRowView[]> {
    const rows = await this.prisma.$queryRaw<StoredEvaluationRow[]>`
      SELECT ${ROW_COLUMNS}
      FROM estadistica_forms.evaluation_rows
      WHERE evaluation_id = ${evaluationId}
        ${rowFilterSql(filter)}
      ORDER BY source_row
      LIMIT ${page.limit} OFFSET ${page.offset}`;
    return rows.map(toRowView);
  }

  /**
   * Los problemas de las filas inválidas, agrupados por atributo y código, del
   * más frecuente al menos. Una fila es un producto (la importación rechaza los
   * identificadores repetidos), pero se cuenta `DISTINCT` para que el recuento
   * no dependa de esa garantía.
   */
  findProblemGroups(evaluationId: string): Promise<ProblemGroupRow[]> {
    return this.prisma.$queryRaw<ProblemGroupRow[]>`
      SELECT
        problem->>'attribute' AS attribute,
        problem->>'code' AS code,
        count(DISTINCT r.external_id)::int AS "productCount"
      FROM estadistica_forms.evaluation_rows r
      CROSS JOIN LATERAL jsonb_array_elements(r.problems) AS problem
      WHERE r.evaluation_id = ${evaluationId}
        AND r.outcome = 'invalid'
      GROUP BY 1, 2
      ORDER BY "productCount" DESC, attribute, code`;
  }

  /**
   * Los productos excluidos, por la regla que los dejó fuera. `rule` sale de
   * la revisión con la que se evaluó; las posiciones empiezan en 1 y los
   * arrays de `jsonb` en 0.
   */
  findExclusionGroups(evaluationId: string): Promise<ExclusionGroupView[]> {
    return this.prisma.$queryRaw<ExclusionGroupView[]>`
      SELECT
        r.excluded_by_rule AS "rulePosition",
        rv.rules -> (r.excluded_by_rule - 1) AS rule,
        count(DISTINCT r.external_id)::int AS "productCount"
      FROM estadistica_forms.evaluation_rows r
      JOIN estadistica_forms.evaluations e ON e.id = r.evaluation_id
      JOIN estadistica_forms.ruleset_versions rv
        ON rv.project_id = e.project_id
       AND rv.id = e.ruleset_version_id
      WHERE r.evaluation_id = ${evaluationId}
        AND r.outcome = 'excluded'
      GROUP BY r.excluded_by_rule, rv.rules
      ORDER BY r.excluded_by_rule`;
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
   * Las evaluaciones `running` con el lease vencido no pueden seguir: su
   * proceso cayó o se quedó colgado. Cuenta como un fallo temporal (plan
   * jobs&files, D6 y D7): vuelven a la cola desde cero o, sin intentos, fallan
   * con `EVALUATION_INTERRUPTED`. Su token deja de valer.
   */
  recoverExpiredLeases(retry: RetryOptions): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const expired = await tx.$queryRaw<ExpiredEvaluationRow[]>`
        SELECT id, attempts
        FROM estadistica_forms.evaluations
        WHERE status = 'running'
          AND lease_until <= now()
        FOR UPDATE SKIP LOCKED`;
      for (const evaluation of expired) {
        const attempts = evaluation.attempts + 1;
        if (attempts >= retry.maxAttempts) {
          const error = publicError(ErrorCodes.EVALUATION_INTERRUPTED);
          await failLocked(tx, evaluation.id, attempts, error);
        } else {
          const delayMs = retryDelay(attempts, retry);
          await requeueLocked(tx, evaluation.id, attempts, delayMs);
        }
      }
      return expired.length;
    });
  }

  /**
   * Toma la evaluación lista más antigua y la marca `running` con un token
   * nuevo, su lease y todo lo que el motor necesita. SKIP LOCKED evita que dos
   * workers tomen la misma. `skip`: las que este worker ya atendió en la
   * pasada actual.
   */
  claim(
    leaseMs: number = EVALUATION_JOB_DEFAULTS.leaseMs,
    skip: readonly string[] = [],
  ): Promise<ClaimedEvaluation | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<ReadyEvaluationRow[]>`
        SELECT
          e.id,
          e.snapshot_id AS "snapshotId",
          e.attempts,
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
          AND (e.run_after IS NULL OR e.run_after <= now())
          AND e.id <> ALL(${[...skip]}::text[])
        ORDER BY e.created_at, e.id
        LIMIT 1
        FOR UPDATE OF e SKIP LOCKED`;
      const evaluation = rows[0];
      if (!evaluation) {
        return null;
      }

      const token = newExecutionToken();
      await tx.$executeRaw`
        UPDATE estadistica_forms.evaluations
        SET
          status = 'running',
          started_at = ${new Date().toISOString()},
          lease_until = ${nowPlus(leaseMs)},
          execution_token = ${token}
        WHERE id = ${evaluation.id}`;
      return { ...evaluation, token, leaseMs };
    });
  }

  /**
   * Lo que necesita una vista previa de reglas (plan 02 de cierre, P6): las
   * cabeceras y la moneda del catálogo y la revisión con la que se compara.
   * Mismos errores que al pedir una evaluación. No bloquea nada: la vista
   * previa no guarda, así que no compite con un borrado.
   */
  async findPreviewSource(
    projectId: string,
    snapshotId: string,
    baseRevision?: number,
  ): Promise<PreviewSource> {
    const snapshots = await this.prisma.$queryRaw<PreviewSnapshotRow[]>`
      SELECT
        status,
        headers,
        project_configuration ->> 'currency' AS currency
      FROM estadistica_forms.catalog_snapshots
      WHERE id = ${snapshotId}
        AND project_id = ${projectId}`;
    const snapshot = snapshots[0];
    if (!snapshot) {
      throw apiError(ErrorCodes.IMPORT_NOT_FOUND);
    }
    if (!isReadyForPreview(snapshot)) {
      throw apiError(ErrorCodes.EVALUATION_SNAPSHOT_NOT_READY);
    }
    return {
      headers: snapshot.headers,
      currency: snapshot.currency,
      base: await this.findBaseRuleset(projectId, baseRevision),
    };
  }

  /** La revisión pedida o, sin pedir ninguna, la última del proyecto. */
  private async findBaseRuleset(
    projectId: string,
    revision?: number,
  ): Promise<PreviewSource['base']> {
    const onlyRevision =
      revision === undefined
        ? Prisma.empty
        : Prisma.sql`AND revision = ${revision}`;
    const rows = await this.prisma.$queryRaw<BaseRulesetRow[]>`
      SELECT
        id,
        revision,
        mapping,
        rules
      FROM estadistica_forms.ruleset_versions
      WHERE project_id = ${projectId}
        ${onlyRevision}
      ORDER BY revision DESC
      LIMIT 1`;
    const row = rows[0];
    if (!row) {
      throw apiError(ErrorCodes.RULESET_NOT_FOUND);
    }
    const ruleset = { mapping: row.mapping, rules: row.rules };
    if (!isRuleset(ruleset)) {
      throw new Error(
        `La versión de reglas ${row.id} tiene una forma inválida.`,
      );
    }
    return { revision: row.revision, ruleset };
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

  /** Guarda un lote y renueva el lease; sin el reclamo vigente, no guarda nada. */
  appendRows(evaluation: ClaimedEvaluation, outcomes: readonly RowOutcome[]) {
    return this.prisma.$transaction(async (tx) => {
      const renewed = await tx.$queryRaw<IdRow[]>`
        UPDATE estadistica_forms.evaluations
        SET lease_until = ${nowPlus(evaluation.leaseMs)}
        WHERE ${claimIsCurrent(evaluation)}
        RETURNING id`;
      if (renewed.length !== 1) {
        throw new LostClaimError();
      }
      await tx.evaluationRow.createMany({
        data: outcomes.map((outcome) => toStoredRow(evaluation.id, outcome)),
      });
    });
  }

  /**
   * Confirma la evaluación solo si lo guardado coincide con lo que contó el
   * motor y con las filas del snapshot (D7): si no, falla por integridad.
   */
  complete(evaluation: ClaimedEvaluation, result: EvaluationResult) {
    return this.prisma.$transaction(async (tx) => {
      await lockCurrentClaim(tx, evaluation);
      const stored = await countStoredOutcomes(tx, evaluation.id);
      if (!matchesResult(stored, result, evaluation.rowCount)) {
        throw new EvaluationFailure(ErrorCodes.EVALUATION_INTEGRITY_FAILED);
      }

      await tx.$executeRaw`
        UPDATE estadistica_forms.evaluations
        SET
          status = 'succeeded',
          total_count = ${result.counts.total},
          valid_count = ${result.counts.valid},
          invalid_count = ${result.counts.invalid},
          excluded_count = ${result.counts.excluded},
          result_checksum = ${result.checksum},
          finished_at = ${new Date().toISOString()},
          lease_until = NULL,
          execution_token = NULL
        WHERE id = ${evaluation.id}`;
    });
  }

  /**
   * Termina con el error público y borra las filas parciales, que ya no
   * sirven. Devuelve `false` sin tocar nada si el reclamo ya no es el vigente.
   */
  fail(
    evaluation: ClaimedEvaluation,
    error: PublicError,
    attempts = evaluation.attempts,
  ) {
    return this.whileClaimed(evaluation, (tx) =>
      failLocked(tx, evaluation.id, attempts, error),
    );
  }

  /** Fallo temporal: vuelve a la cola desde cero dentro de `delayMs`. */
  retryLater(evaluation: ClaimedEvaluation, attempts: number, delayMs: number) {
    return this.whileClaimed(evaluation, (tx) =>
      requeueLocked(tx, evaluation.id, attempts, delayMs),
    );
  }

  /** Al apagar: vuelve a la cola ya, sin gastar un intento (D6). */
  release(evaluation: ClaimedEvaluation) {
    return this.whileClaimed(evaluation, (tx) =>
      requeueLocked(tx, evaluation.id, evaluation.attempts, 0),
    );
  }

  /** Ejecuta `write` con el reclamo bloqueado; `false` si ya no es el vigente. */
  private whileClaimed(
    evaluation: ClaimedEvaluation,
    write: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await holdsCurrentClaim(tx, evaluation))) {
        return false;
      }
      await write(tx);
      return true;
    });
  }

  private insertQueued(request: EvaluationRequest) {
    return this.prisma.$transaction(async (tx) => {
      await lockProjectForEvaluation(tx, request.ownerId, request.projectId);
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
 * FOR UPDATE OF p sobre el proyecto: el mismo bloqueo que borrar el proyecto,
 * así que no se puede aceptar una evaluación mientras se borra. Con él se
 * comprueba que quien evalúa (también la actualización programada del feed,
 * en nombre de quien la configuró) es miembro y puede preparar trabajo (C6).
 */
async function lockProjectForEvaluation(
  tx: Prisma.TransactionClient,
  actorId: string,
  projectId: string,
) {
  const projects = await tx.$queryRaw<ProjectMemberAccess[]>`
    SELECT ${PROJECT_ACCESS_COLUMNS}
    FROM estadistica_forms.projects p
    ${joinProjectAccess(actorId)}
    WHERE p.id = ${projectId}
    FOR UPDATE OF p`;
  assertProjectPermission(projects[0] ?? null, 'worksheet.write');
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
export function assertColumnsExist(
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

/** Bloquea la evaluación si el reclamo sigue siendo el vigente. */
async function holdsCurrentClaim(
  tx: Prisma.TransactionClient,
  claim: JobClaim,
) {
  const rows = await tx.$queryRaw<IdRow[]>`
    SELECT id
    FROM estadistica_forms.evaluations
    WHERE ${claimIsCurrent(claim)}
    FOR UPDATE`;
  return rows.length === 1;
}

async function lockCurrentClaim(tx: Prisma.TransactionClient, claim: JobClaim) {
  if (!(await holdsCurrentClaim(tx, claim))) {
    throw new LostClaimError();
  }
}

/**
 * Vuelve a empezar desde cero (D7): sin filas parciales y otra vez `queued`.
 * Quien llama ya tiene la evaluación bloqueada.
 */
async function requeueLocked(
  tx: Prisma.TransactionClient,
  evaluationId: string,
  attempts: number,
  delayMs: number,
) {
  await tx.evaluationRow.deleteMany({ where: { evaluationId } });
  await tx.$executeRaw`
    UPDATE estadistica_forms.evaluations
    SET
      status = 'queued',
      attempts = ${attempts},
      run_after = ${nowPlus(delayMs)},
      started_at = NULL,
      lease_until = NULL,
      execution_token = NULL
    WHERE id = ${evaluationId}`;
}

/** Cierra la evaluación como fallida y borra sus filas parciales. Ya está bloqueada. */
async function failLocked(
  tx: Prisma.TransactionClient,
  evaluationId: string,
  attempts: number,
  error: PublicError,
) {
  await tx.evaluationRow.deleteMany({ where: { evaluationId } });
  await tx.$executeRaw`
    UPDATE estadistica_forms.evaluations
    SET
      status = 'failed',
      attempts = ${attempts},
      finished_at = ${new Date().toISOString()},
      error = ${JSON.stringify(error)}::jsonb,
      lease_until = NULL,
      execution_token = NULL
    WHERE id = ${evaluationId}`;
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

/** Un catálogo terminado, con sus cabeceras y su moneda bien guardadas. */
function isReadyForPreview(
  snapshot: PreviewSnapshotRow,
): snapshot is { status: 'ready'; headers: string[]; currency: string } {
  return (
    snapshot.status === 'ready' &&
    isTextList(snapshot.headers) &&
    typeof snapshot.currency === 'string' &&
    CURRENCY_PATTERN.test(snapshot.currency)
  );
}

function isTextList(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

/**
 * Las condiciones del filtro del informe. Un problema se busca con `@>`: la
 * fila lo tiene si su lista contiene ese par de atributo y código.
 */
function rowFilterSql(filter: RowFilter) {
  const conditions: Prisma.Sql[] = [];
  if (filter.outcome) {
    conditions.push(Prisma.sql`AND outcome = ${filter.outcome}`);
  }
  if (filter.problem) {
    const wanted = JSON.stringify([filter.problem]);
    conditions.push(Prisma.sql`AND problems @> ${wanted}::jsonb`);
  }
  if (filter.excludedByRule !== undefined) {
    conditions.push(
      Prisma.sql`AND excluded_by_rule = ${filter.excludedByRule}`,
    );
  }
  // `Prisma.join` no admite una lista vacía.
  return conditions.length > 0 ? Prisma.join(conditions, ' ') : Prisma.empty;
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
