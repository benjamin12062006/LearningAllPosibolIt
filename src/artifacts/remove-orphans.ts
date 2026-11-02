import type { StoredArtifact } from './artifact.store.js';

/**
 * Margen de seguridad: un archivo recién escrito puede pertenecer a una
 * operación que todavía no ha confirmado su fila en la base.
 */
export const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;

/** Cómo listar, consultar y borrar los archivos de una carpeta concreta. */
export type OrphanSource = Readonly<{
  list: () => Promise<StoredArtifact[]>;
  /** De las claves dadas, las que todavía usa alguna fila de la base. */
  findReferenced: (keys: string[]) => Promise<Set<string>>;
  remove: (key: string) => Promise<void>;
}>;

/**
 * Borra los archivos con más de `ORPHAN_MIN_AGE_MS` que ninguna fila referencia
 * y devuelve cuántos borró. Cada feature aporta su carpeta y su consulta,
 * porque solo ella sabe qué archivos siguen en uso.
 */
export async function removeOrphans(
  source: OrphanSource,
  now: number,
): Promise<number> {
  const stored = await source.list();
  const oldEnough = stored.filter(
    (artifact) => now - artifact.modifiedAt >= ORPHAN_MIN_AGE_MS,
  );

  const referenced = await source.findReferenced(
    oldEnough.map((artifact) => artifact.key),
  );
  const orphans = oldEnough.filter((artifact) => !referenced.has(artifact.key));

  for (const orphan of orphans) {
    await source.remove(orphan.key);
  }
  return orphans.length;
}
