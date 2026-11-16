/**
 * Tipos del conocimiento (plan E6, D14–D18): lo que Nest manda al servicio de IA
 * y lo que recuerda de lo ya mandado.
 */

/** Los mismos tipos de fuente que el servicio de IA (`SourceType`). */
export const SOURCE_TYPES = [
  'organization',
  'project',
  'workbook',
  'worksheet',
  'catalog',
  'evaluation',
  'ruleset',
  'feed',
  'changeset',
  'worksheet_import',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export type MetadataValue = string | number | boolean;

/** Un documento tal como lo recibe el servicio de IA. */
export type KnowledgeDocument = Readonly<{
  documentId: string;
  text: string;
  metadata: Readonly<Record<string, MetadataValue>>;
}>;

/** Dónde vive una fuente en el índice. */
export type SourceKey = Readonly<{
  organizationId: string;
  projectId: string;
  sourceType: SourceType;
  sourceId: string;
}>;

/** Una fuente como está ahora en PostgreSQL, con su huella. */
export type CurrentSource = SourceKey & Readonly<{ fingerprint: string }>;

/** Marca de reindexado. Conserva la clave para retirar una fuente que haya desaparecido. */
export const REINDEX_PENDING = '';

/** Estado guardado de una fuente que se mandó al índice. */
export type SyncedSource = CurrentSource & Readonly<{ syncedAt: string }>;

export const KNOWLEDGE_OPTIONS = Symbol('KNOWLEDGE_OPTIONS');
export type KnowledgeOptions = Readonly<{
  autoStart: boolean;
  pollMs: number;
  shutdownMs: number;
  clock: () => Date;
}>;

/**
 * Cada 30 s: los cambios llegan al agente en menos de un minuto sin cargar la
 * base, porque una pasada sin cambios solo hace dos consultas.
 */
export const KNOWLEDGE_DEFAULTS: KnowledgeOptions = Object.freeze({
  autoStart: true,
  pollMs: 30_000,
  shutdownMs: 5_000,
  clock: () => new Date(),
});
