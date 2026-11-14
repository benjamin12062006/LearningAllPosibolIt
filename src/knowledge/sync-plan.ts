import {
  REINDEX_PENDING,
  type CurrentSource,
  type SourceKey,
  type SyncedSource,
} from './knowledge.types.js';

/** Qué hacer en una pasada del reconciliador (D15). */
export type SyncPlan = Readonly<{
  /** Fuentes nuevas o con otra huella: se reemplazan en el índice. */
  changed: readonly CurrentSource[];
  /** Fuentes que ya no existen en un proyecto que sigue existiendo. */
  removed: readonly SourceKey[];
  /** Proyectos que ya no existen: se quitan enteros del índice. */
  removedProjects: readonly Readonly<{
    organizationId: string;
    projectId: string;
  }>[];
}>;

/**
 * Compara lo que hay en PostgreSQL con lo que se mandó la última vez. Todo
 * proyecto existente tiene siempre su fuente `project`, así que un proyecto sin
 * ninguna fuente actual es un proyecto borrado.
 */
export function planSync(
  current: readonly CurrentSource[],
  synced: readonly SyncedSource[],
): SyncPlan {
  const syncedByKey = new Map(synced.map((source) => [keyOf(source), source]));
  const currentKeys = new Set(current.map(keyOf));
  const existingProjects = new Set(current.map((source) => source.projectId));

  const changed = current.filter((source) =>
    needsSync(source, syncedByKey.get(keyOf(source))),
  );

  const removed: SourceKey[] = [];
  const removedProjects = new Map<
    string,
    SyncPlan['removedProjects'][number]
  >();
  for (const source of synced) {
    if (!existingProjects.has(source.projectId)) {
      removedProjects.set(source.projectId, {
        organizationId: source.organizationId,
        projectId: source.projectId,
      });
    } else if (!currentKeys.has(keyOf(source))) {
      removed.push(source);
    }
  }

  return { changed, removed, removedProjects: [...removedProjects.values()] };
}

export function needsSync(
  current: CurrentSource,
  synced?: SyncedSource,
): boolean {
  return (
    synced?.syncedAt === REINDEX_PENDING ||
    synced?.fingerprint !== current.fingerprint
  );
}

/** Clave de una fuente: proyecto, tipo e id. */
export function keyOf(source: SourceKey): string {
  return `${source.projectId}/${source.sourceType}/${source.sourceId}`;
}
