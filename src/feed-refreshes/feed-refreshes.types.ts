import type { ImportDelimiter } from '../catalog-import/import.types.js';
import type { PublicError } from '../common/http/public-error.js';
import type {
  FeedPolicy,
  RefreshOutcome,
  RefreshStage,
  RefreshStatus,
} from '../feeds/feeds.types.js';
import type { RefreshRetryOptions } from '../jobs/refresh-retry.js';

// Los estados de una actualización se definen junto al feed, que muestra la
// última (D12); este módulo los reexporta para no cambiar sus importaciones.
export type {
  RefreshOutcome,
  RefreshStage,
  RefreshStatus,
} from '../feeds/feeds.types.js';

/** Lo que devuelven las rutas de actualizaciones. Sin token ni lease. */
export type RefreshView = Readonly<{
  id: string;
  feedId: string;
  status: RefreshStatus;
  stage: RefreshStage;
  attempts: number;
  outcome: RefreshOutcome | null;
  snapshotId: string | null;
  evaluationId: string | null;
  runAfter: string;
  error: PublicError | null;
  /** Fecha local de una actualización programada; nula si se disparó a mano. */
  scheduledFor: string | null;
  createdAt: string;
  finishedAt: string | null;
}>;

/** Fuente del feed tal como la necesita el paso `fetch`. */
export type RefreshSource = Readonly<{
  url: string;
  idColumn: string;
  delimiter: ImportDelimiter;
}>;

/**
 * Una actualización reclamada: el token identifica este reclamo. Cualquier
 * escritura con un token que ya no es el vigente no tiene efecto (D3).
 */
export type ClaimedRefresh = Readonly<{
  id: string;
  feedId: string;
  projectId: string;
  ownerId: string;
  token: string;
  stage: RefreshStage;
  attempts: number;
  /** Nula si se borró la fuente después de disparar: el paso `fetch` falla. */
  source: RefreshSource | null;
  snapshotId: string | null;
  importJobId: string | null;
  evaluationId: string | null;
  /** La generación del feed al disparar: solo se publica si sigue siendo esa. */
  expectedGeneration: number | null;
  /** Nula si se quitó la política después de disparar: el paso que la usa falla. */
  policy: FeedPolicy | null;
}>;

/** El reclamo dejó de ser el vigente: el worker abandona sin más efectos (D3). */
export class LostClaimError extends Error {
  constructor() {
    super('El reclamo de la actualización ya no es el vigente.');
    this.name = 'LostClaimError';
  }
}

/** Ids previstos que un paso guarda antes de crear lo que identifican (D9). */
export type PlannedIds = Partial<
  Pick<ClaimedRefresh, 'snapshotId' | 'importJobId' | 'evaluationId'>
>;

export const FEED_REFRESH_OPTIONS = Symbol('FEED_REFRESH_OPTIONS');
export type FeedRefreshOptions = {
  autoStart: boolean;
  /** Cada cuánto busca trabajo el worker. */
  pollMs: number;
  /** Cada cuánto vuelve a mirar una importación o evaluación en curso. */
  waitMs: number;
  /** Mayor que el paso más largo (descarga ≤ 30 s), sin renovación (D2). */
  leaseMs: number;
  /** Cuánto espera al trabajo en curso al apagar antes de abortarlo. */
  shutdownMs: number;
  retry: RefreshRetryOptions;
  /**
   * Hora actual para decidir qué actualizaciones programadas tocan (D10). Se
   * inyecta para probar días y horas sin esperar al reloj real (RC3).
   */
  clock: () => Date;
};
