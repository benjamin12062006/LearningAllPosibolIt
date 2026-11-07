import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ArtifactStore } from '../artifacts/artifact.store.js';
import { removeOrphans } from '../artifacts/remove-orphans.js';
import { WorksheetExportsRepository } from './worksheet-exports.repository.js';
import {
  WORKSHEET_EXPORT_OPTIONS,
  type WorksheetExportOptions,
} from './worksheet-exports.types.js';

/**
 * Retira de `worksheet-exports/` los archivos que ninguna exportación
 * referencia (D20): quedan si no se guarda la fila o falla el borrado del
 * archivo. Se ejecuta al arrancar, como la limpieza de los TSV.
 */
@Injectable()
export class WorksheetExportCleanupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WorksheetExportCleanupService.name);

  constructor(
    private readonly store: ArtifactStore,
    private readonly repository: WorksheetExportsRepository,
    @Inject(WORKSHEET_EXPORT_OPTIONS)
    private readonly options: WorksheetExportOptions,
  ) {}

  async onApplicationBootstrap() {
    if (!this.options.autoStart) {
      return;
    }
    try {
      const removed = await this.removeOrphanExports();
      if (removed > 0) {
        this.logger.log({ code: 'WORKSHEET_EXPORT_ORPHANS_REMOVED', removed });
      }
    } catch {
      // No impide arrancar: se volverá a intentar en el próximo arranque.
      this.logger.error({ code: 'WORKSHEET_EXPORT_ORPHAN_CLEANUP_FAILED' });
    }
  }

  /** Devuelve cuántos archivos se borraron. */
  removeOrphanExports(now = Date.now()): Promise<number> {
    return removeOrphans(
      {
        list: () => this.store.listWorksheetExports(),
        findReferenced: (keys) =>
          this.repository.findReferencedArtifactKeys(keys),
        remove: (key) => this.store.removeWorksheetExport(key),
      },
      now,
    );
  }
}
