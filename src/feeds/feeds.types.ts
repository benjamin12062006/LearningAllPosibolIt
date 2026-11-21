import type { WrittenArtifact } from '../artifacts/artifact.store.js';
import type { ImportDelimiter } from '../catalog-import/import.types.js';
import type { PublicError } from '../common/http/public-error.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { FeedSchedule } from './feed-schedule.js';

/** Estados de una actualización del feed (CHECK de `feed_refreshes`). */
export type RefreshStatus =
  'queued' | 'running' | 'succeeded' | 'retry_wait' | 'failed';

/** Pasos de una actualización, en orden. */
export type RefreshStage = 'fetch' | 'import' | 'evaluate' | 'publish';

/**
 * Resultado de una actualización terminada (D11): publicó, el TSV ya era el
 * publicado, la política no se cumple o alguien publicó entretanto. En los dos
 * últimos, `error` guarda el motivo y la publicación anterior sigue.
 */
export type RefreshOutcome =
  'published' | 'unchanged' | 'needs_review' | 'conflict';

/**
 * La última actualización del feed, tal como la ve el operador (D12): cuándo
 * fue, cómo acabó y por qué, si no publicó. Es la «alerta» del incremento 5.
 */
export type LastRefreshView = Readonly<{
  id: string;
  status: RefreshStatus;
  stage: RefreshStage;
  outcome: RefreshOutcome | null;
  error: PublicError | null;
  scheduledFor: string | null;
  createdAt: string;
  finishedAt: string | null;
}>;

/** Una versión del historial del feed (D12). */
export type FeedVersionView = PublishedVersionView &
  Readonly<{
    /** La versión publicada ahora. */
    current: boolean;
    /** `false` si la retención ya retiró su archivo (D14): no se puede volver a ella. */
    fileRetained: boolean;
  }>;

/** Quién publicó una versión: el operador a mano o la actualización automática. */
export type PublishedBy = 'operator' | 'refresh';

/** La versión vigente tal como la ve el operador; sin la clave del archivo. */
export type PublishedVersionView = Readonly<{
  id: string;
  /** Nulos si se borró la importación de la que salió: la versión sigue (D5). */
  exportId: string | null;
  evaluationId: string | null;
  rowCount: number;
  byteSize: number;
  tsvChecksum: string;
  publishedBy: PublishedBy;
  publishedAt: string;
}>;

/** De dónde descarga el feed su CSV y cómo leerlo, como una importación (D9). */
export type FeedSource = Readonly<{
  url: string;
  idColumn: string;
  delimiter: ImportDelimiter;
}>;

/**
 * Política aprobada (D11): con qué reglas se evalúa la actualización automática
 * y qué límites tiene que cumplir para publicarse sin revisión. Las versiones
 * del motor y del perfil las fija el servidor al aprobar.
 */
export type FeedPolicy = Readonly<{
  rulesetRevision: number;
  maxInvalid: number;
  maxExcluded: number;
  maxDropPercent: number;
  engineVersion: string;
  profileVersion: string;
  approvedAt: string;
}>;

/** Lo que el operador aprueba; el resto lo fija el servidor. */
export type PolicyInput = Pick<
  FeedPolicy,
  'rulesetRevision' | 'maxInvalid' | 'maxExcluded' | 'maxDropPercent'
>;

/**
 * Lo que devuelven las rutas del feed. `generation` es lo que el operador manda
 * al publicar (D6). El token nunca sale de aquí: solo si la entrega está activa.
 */
export type FeedView = Readonly<{
  id: string;
  generation: number;
  deliveryEnabled: boolean;
  publishedVersion: PublishedVersionView | null;
  source: FeedSource | null;
  policy: FeedPolicy | null;
  /** Nula hasta que el operador la configura por primera vez (D10). */
  schedule: FeedSchedule | null;
  lastRefresh: LastRefreshView | null;
  createdAt: string;
  updatedAt: string;
}>;

/** Por qué la URL pública no entrega el TSV (plan 02 de cierre, P3). */
export type DeliveryBlock =
  'no_published_version' | 'delivery_disabled' | 'file_unavailable';

/**
 * Lo que responde `GET …/feeds/:feedId/delivery`: si la URL pública entrega y,
 * si no, el motivo. La ruta pública responde el mismo 404 a todos los «no»
 * (D7); con sesión sí se puede explicar. El token nunca sale de aquí.
 */
export type DeliveryStatus = Readonly<{
  delivering: boolean;
  reason: DeliveryBlock | null;
  deliveryEnabled: boolean;
  publishedVersion: PublishedVersionView | null;
}>;

export type NewFeed = Readonly<{
  id: string;
  projectId: string;
  deliveryTokenHash: string | null;
  createdAt: string;
}>;

/** La exportación que se publica y su archivo; solo la lee el servidor. */
export type ExportToPublish = Readonly<{
  id: string;
  evaluationId: string;
  artifactKey: string;
  rowCount: number;
  byteSize: number;
  tsvChecksum: string;
}>;

/**
 * El archivo de una versión del historial, para el visor (plan E6, D1). La clave
 * es nula si la retención ya lo retiró (D14).
 */
export type VersionFile = Readonly<{
  artifactKey: string | null;
  rowCount: number;
}>;

/** El archivo publicado al que lleva un token de entrega; solo lo ve el servidor. */
export type DeliveryFile = Readonly<{
  feedId: string;
  /** La retención nunca retira el de la versión publicada (D14). */
  artifactKey: string | null;
  byteSize: number;
  tsvChecksum: string;
}>;

/** Una versión lista para publicar: su archivo ya está enlazado y verificado. */
export type NewFeedVersion = Readonly<{
  id: string;
  feedId: string;
  projectId: string;
  expectedGeneration: number;
  source: ExportToPublish;
  file: WrittenArtifact;
  publishedBy: PublishedBy;
  createdAt: string;
}>;

/**
 * Lo que la actualización automática hace dentro de la transacción que publica:
 * comprobar que su reclamo sigue vigente y terminarlo (D3). Si lanza, la versión
 * no se publica.
 */
export type PublicationConfirmation = (
  tx: Prisma.TransactionClient,
) => Promise<void>;

export const FEED_OPTIONS = Symbol('FEED_OPTIONS');
export type FeedOptions = {
  /** Limpiar al arrancar los archivos de `feeds/` que ninguna versión referencia. */
  autoStart: boolean;
  /**
   * Archivos que se conservan por feed: el publicado y los más recientes hasta
   * completar esta cifra, para poder volver atrás (D14).
   */
  retainedFiles: number;
};
