import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import type { PublicError } from '../common/http/public-error.js';
import type { ProjectScope } from '../worksheets/worksheets.types.js';

export const AGENT_RUN_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'expired',
  'cancelled',
] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

/** Cómo terminó una ejecución correcta: lo decide el agente (A11). */
export const AGENT_OUTCOMES = [
  'answered',
  'confirmation_required',
  'needs_clarification',
  'limit_reached',
] as const;
export type AgentOutcome = (typeof AGENT_OUTCOMES)[number];

/**
 * Dónde trabaja el agente: lo fija la conversación (libro y, si la tiene,
 * hoja) y, opcionalmente, la persona (revisión y selección de H6).
 */
export const ASSISTANT_SECTIONS = [
  'project',
  'catalog',
  'rules',
  'evaluations',
  'products',
  'feed',
  'worksheets',
  'integrations',
  'chats',
] as const;
export type AssistantSection = (typeof ASSISTANT_SECTIONS)[number];

export type RunContext = Readonly<{
  language?: 'en' | 'es';
  section?: AssistantSection;
  catalogSnapshotId?: string;
  evaluationId?: string;
  rulesetRevision?: number;
  workbookId: string | null;
  worksheetId: string | null;
  revisionId: string | null;
  selectionId: string | null;
}>;

/** Límites de una ejecución (plan 05, D2–D3). */
export const AGENT_RUN_LIMITS = {
  /** Mensajes anteriores que se mandan como historial. */
  historyMessages: 50,
  /** Bytes del historial en total: el resto se recorta por lo más antiguo. */
  historyBytes: 64 * 1024,
  /** Llamadas aceptadas por la pasarela en una ejecución. */
  calls: 20,
  /** El servicio de IA corta a los 120 s; Nest espera un poco más. */
  requestTimeoutMs: 150_000,
  /** Lo que dura el reclamo de una ejecución, y con él su credencial. */
  leaseMs: 180_000,
  /** Una ejecución en cola que no se reclama en este plazo caduca. */
  queueTimeoutMs: 10 * 60_000,
  /** Lo que la persona tiene para confirmar una propuesta. */
  proposalTtlMs: 30 * 60_000,
  /** Respuesta de una lectura que vuelve al modelo. */
  readResultBytes: 60 * 1024,
} as const;

/** Mensaje del asistente cuando el agente no devuelve texto. */
export const EMPTY_ANSWER = 'No tengo nada más que añadir.';

/**
 * Cuotas por persona (E6.4, D6): ejecuciones activas a la vez y ejecuciones
 * iniciadas en las últimas 24 horas. Pasarlas responde 429.
 */
export type AgentRunQuota = Readonly<{ activeRuns: number; dailyRuns: number }>;

export const AGENT_RUN_OPTIONS = Symbol('AGENT_RUN_OPTIONS');
export type AgentRunOptions = Readonly<{
  autoStart: boolean;
  parallelRuns: number;
  pollMs: number;
  shutdownMs: number;
  clock: () => Date;
  quota: AgentRunQuota;
}>;

export const AGENT_RUN_DEFAULTS: AgentRunOptions = Object.freeze({
  autoStart: true,
  parallelRuns: 3,
  pollMs: 2_000,
  shutdownMs: 5_000,
  clock: () => new Date(),
  quota: Object.freeze({ activeRuns: 3, dailyRuns: 200 }),
});

/** Los hitos de una ejecución que ve la web por SSE (E6.4). */
export const RUN_EVENT_TYPES = [
  'run.queued',
  'run.started',
  'tool.started',
  'tool.completed',
  'proposal.ready',
  'run.completed',
  'run.failed',
  'run.cancelled',
] as const;
export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

export type RunEvent = Readonly<{
  sequence: number;
  type: RunEventType;
  payload: Record<string, unknown>;
  createdAt: string;
}>;

/** Estados en los que una ejecución ya no cambia. */
export const FINISHED_STATUSES: readonly AgentRunStatus[] = [
  'succeeded',
  'failed',
  'expired',
  'cancelled',
];

/** La propuesta tal como la ve la persona. */
export type ProposalView = Readonly<{
  id: string;
  operation: string;
  summary: string;
  rulesetReview?: unknown;
  hash: string;
  status: 'ready' | 'confirming' | 'confirmed' | 'rejected';
  target: unknown;
  result: unknown;
  expiresAt: string;
  createdAt: string;
  decidedAt: string | null;
}>;

/** Una ejecución tal como la ve su autor. */
export type AgentRunView = Readonly<{
  id: string;
  conversationId: string;
  userMessageId: string;
  status: AgentRunStatus;
  outcome: AgentOutcome | null;
  context: RunContext;
  answerMessageId: string | null;
  answer: string | null;
  error: PublicError | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  proposal: ProposalView | null;
}>;

/**
 * Una ejecución reclamada por el worker o autenticada en la pasarela: con la
 * identidad de la persona, porque cada operación llama a su servicio como ella.
 */
export type RunningRun = Readonly<{
  id: string;
  scope: ProjectScope;
  actorId: string;
  identity: AuthenticatedIdentity;
  conversationId: string;
  userMessageId: string;
  context: RunContext;
  claimToken: string;
}>;
