import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ArtifactStore } from './artifact.store.js';
import { CatalogImportRepository } from './catalog-import.repository.js';
import {
  CATALOG_IMPORT_OPTIONS,
  type CatalogImportOptions,
} from './import.types.js';

/**
 * Margen de seguridad: un archivo recién escrito puede pertenecer a una
 * aceptación que todavía no ha confirmado su fila en la base.
 */
export const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;

/**
 * Retira de `artifacts/` los archivos que ningún snapshot referencia: quedan
 * cuando falla el borrado del archivo después de borrar la importación.
 * Se ejecuta al arrancar, antes de aceptar peticiones, y supone una sola
 * instancia de la API (fase A).
 */
@Injectable()
export class ArtifactCleanupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ArtifactCleanupService.name);

  constructor(
    private readonly store: ArtifactStore,
    private readonly repository: CatalogImportRepository,
    @Inject(CATALOG_IMPORT_OPTIONS)
    private readonly options: CatalogImportOptions,
  ) {}

  async onApplicationBootstrap() {
    if (!this.options.autoStart) {
      return;
    }
    try {
      const removed = await this.removeOrphanArtifacts();
      if (removed > 0) {
        this.logger.log({ code: 'IMPORT_ORPHANS_REMOVED', removed });
      }
    } catch {
      // No impide arrancar: se volverá a intentar en el próximo arranque.
      this.logger.error({ code: 'IMPORT_ORPHAN_CLEANUP_FAILED' });
    }
  }

  /** Devuelve cuántos archivos se borraron. */
  async removeOrphanArtifacts(now = Date.now()): Promise<number> {
    const artifacts = await this.store.listArtifacts();
    const oldEnough = artifacts.filter(
      (artifact) => now - artifact.modifiedAt >= ORPHAN_MIN_AGE_MS,
    );

    const referenced = await this.repository.findReferencedArtifactKeys(
      oldEnough.map((artifact) => artifact.key),
    );
    const orphans = oldEnough.filter(
      (artifact) => !referenced.has(artifact.key),
    );

    for (const orphan of orphans) {
      await this.store.removeArtifact(orphan.key);
    }
    return orphans.length;
  }
}
