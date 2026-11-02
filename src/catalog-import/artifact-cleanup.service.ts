import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ArtifactStore } from '../artifacts/artifact.store.js';
import { removeOrphans } from '../artifacts/remove-orphans.js';
import { CatalogImportRepository } from './catalog-import.repository.js';
import {
  CATALOG_IMPORT_OPTIONS,
  type CatalogImportOptions,
} from './import.types.js';

// Se sigue exportando desde aquí: las pruebas de la limpieza lo importan de este archivo.
export { ORPHAN_MIN_AGE_MS } from '../artifacts/remove-orphans.js';

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
  removeOrphanArtifacts(now = Date.now()): Promise<number> {
    return removeOrphans(
      {
        list: () => this.store.listArtifacts(),
        findReferenced: (keys) =>
          this.repository.findReferencedArtifactKeys(keys),
        remove: (key) => this.store.removeArtifact(key),
      },
      now,
    );
  }
}
