import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ArtifactStore } from '../artifacts/artifact.store.js';
import { removeOrphans } from '../artifacts/remove-orphans.js';
import { ExportsRepository } from './exports.repository.js';
import { EXPORT_OPTIONS, type ExportOptions } from './exports.types.js';

/**
 * Retira de `exports/` los TSV que ninguna exportación referencia (D6.5). Quedan
 * cuando falla el borrado del archivo tras un borrado en cascada, cuando no se
 * guarda la fila de una exportación o cuando falla su verificación al releerlo.
 * Se ejecuta al arrancar y supone una sola instancia de la API (fase A), igual
 * que la limpieza de importaciones.
 */
@Injectable()
export class ExportCleanupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ExportCleanupService.name);

  constructor(
    private readonly store: ArtifactStore,
    private readonly repository: ExportsRepository,
    @Inject(EXPORT_OPTIONS)
    private readonly options: ExportOptions,
  ) {}

  async onApplicationBootstrap() {
    if (!this.options.autoStart) {
      return;
    }
    try {
      const removed = await this.removeOrphanExports();
      if (removed > 0) {
        this.logger.log({ code: 'EXPORT_ORPHANS_REMOVED', removed });
      }
    } catch {
      // No impide arrancar: se volverá a intentar en el próximo arranque.
      this.logger.error({ code: 'EXPORT_ORPHAN_CLEANUP_FAILED' });
    }
  }

  /** Devuelve cuántos archivos se borraron. */
  removeOrphanExports(now = Date.now()): Promise<number> {
    return removeOrphans(
      {
        list: () => this.store.listExports(),
        findReferenced: (keys) =>
          this.repository.findReferencedArtifactKeys(keys),
        remove: (key) => this.store.removeExport(key),
      },
      now,
    );
  }
}
