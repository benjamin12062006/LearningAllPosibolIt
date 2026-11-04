import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ArtifactStore } from '../artifacts/artifact.store.js';
import { removeOrphans } from '../artifacts/remove-orphans.js';
import { FeedsRepository } from './feeds.repository.js';
import { FEED_OPTIONS, type FeedOptions } from './feeds.types.js';

/**
 * Retira de `feeds/` los archivos que ninguna versión referencia (D14). Quedan
 * cuando falla el borrado tras un conflicto al publicar, tras la retención o
 * tras borrar un proyecto. Se ejecuta al arrancar, como las limpiezas de
 * importaciones y exportaciones.
 */
@Injectable()
export class FeedCleanupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(FeedCleanupService.name);

  constructor(
    private readonly store: ArtifactStore,
    private readonly repository: FeedsRepository,
    @Inject(FEED_OPTIONS)
    private readonly options: FeedOptions,
  ) {}

  async onApplicationBootstrap() {
    if (!this.options.autoStart) {
      return;
    }
    try {
      const removed = await this.removeOrphanFiles();
      if (removed > 0) {
        this.logger.log({ code: 'FEED_ORPHANS_REMOVED', removed });
      }
    } catch {
      // No impide arrancar: se volverá a intentar en el próximo arranque.
      this.logger.error({ code: 'FEED_ORPHAN_CLEANUP_FAILED' });
    }
  }

  /** Devuelve cuántos archivos se borraron. */
  removeOrphanFiles(now = Date.now()): Promise<number> {
    return removeOrphans(
      {
        list: () => this.store.listFeedVersions(),
        findReferenced: (keys) =>
          this.repository.findReferencedArtifactKeys(keys),
        remove: (key) => this.store.removeFeedVersion(key),
      },
      now,
    );
  }
}
