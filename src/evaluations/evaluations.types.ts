import {
  ApplicationFailure,
  type PublicError,
} from '../common/http/public-error.js';
import type { ProductValues } from './engine/google-merchant.profile.js';
import type { ProblemView } from './problem-messages.js';

export const EVALUATION_LIMITS = {
  /** Filas del catálogo que se leen, evalúan y guardan en cada lote. */
  batchRows: 250,
} as const;

export type EvaluationStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export const ROW_OUTCOMES = ['valid', 'invalid', 'excluded'] as const;
export type RowOutcomeKind = (typeof ROW_OUTCOMES)[number];

/** Filas de la muestra en `GET …/evaluations/:evaluationId` (D10). */
export const SAMPLE_ROWS = 20;

/** Una fila evaluada tal como la ve el cliente: problemas con texto es/en. */
export type EvaluationRowView = Readonly<{
  sourceRow: number;
  externalId: string;
  outcome: RowOutcomeKind;
  values: ProductValues | null;
  problems: readonly ProblemView[];
  excludedByRule: number | null;
}>;

/** Datos que la aceptación necesita; los IDs se generan antes de la transacción. */
export type EvaluationRequest = Readonly<{
  evaluationId: string;
  ownerId: string;
  projectId: string;
  snapshotId: string;
  rulesetRevision: number;
}>;

/**
 * Evaluación reclamada por el worker, con las versiones fijadas. `ruleset` y
 * `currency` llegan de `jsonb` sin tipo y el worker los comprueba.
 */
export type ClaimedEvaluation = Readonly<{
  id: string;
  snapshotId: string;
  rowCount: number;
  currency: unknown;
  mapping: unknown;
  rules: unknown;
}>;

export type EvaluationCountsView = Readonly<{
  total: number;
  valid: number;
  invalid: number;
  excluded: number;
}>;

/** Lo que devuelve `GET …/evaluations/:evaluationId`. */
export type EvaluationView = Readonly<{
  id: string;
  snapshotId: string;
  rulesetRevision: number;
  engineVersion: string;
  profileVersion: string;
  status: EvaluationStatus;
  counts: EvaluationCountsView | null;
  resultChecksum: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: PublicError | null;
}>;

/** Fallo esperado de una evaluación; su `detail` se guarda tal cual. */
export class EvaluationFailure extends ApplicationFailure {}

export const EVALUATION_OPTIONS = Symbol('EVALUATION_OPTIONS');
export type EvaluationOptions = {
  autoStart: boolean;
  pollMs: number;
  shutdownMs: number;
};
