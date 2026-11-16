import { Module } from '@nestjs/common';
import { ArtifactsModule } from '../artifacts/artifacts.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogImportModule } from '../catalog-import/catalog-import.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { EvaluationsModule } from '../evaluations/evaluations.module.js';
import { ExportsModule } from '../exports/exports.module.js';
import { FeedsModule } from '../feeds/feeds.module.js';
import { DEFAULT_REFRESH_RETRY } from '../jobs/refresh-retry.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { RemoteSourceModule } from '../remote-source/remote-source.module.js';
import { UsersModule } from '../users/users.module.js';
import { FeedRefreshScheduler } from './feed-refresh.scheduler.js';
import { FeedRefreshSteps } from './feed-refresh.steps.js';
import { FeedRefreshWorker } from './feed-refresh.worker.js';
import { FeedRefreshesController } from './feed-refreshes.controller.js';
import { FeedRefreshesRepository } from './feed-refreshes.repository.js';
import { FeedRefreshesService } from './feed-refreshes.service.js';
import {
  FEED_REFRESH_OPTIONS,
  type FeedRefreshOptions,
} from './feed-refreshes.types.js';

/**
 * Actualización de los feeds (incremento 5, E4–E5): descarga la fuente, la
 * importa, la evalúa, la exporta y la publica con los servicios de esas
 * features. Está por encima de ellas: las usa y ninguna depende de esta.
 */
@Module({
  imports: [
    ArtifactsModule,
    AuthModule,
    CatalogImportModule,
    EvaluationsModule,
    ExportsModule,
    FeedsModule,
    PrismaModule,
    ProjectsModule,
    RemoteSourceModule,
    UsersModule,
  ],
  controllers: [FeedRefreshesController],
  providers: [
    FeedRefreshesRepository,
    FeedRefreshesService,
    FeedRefreshScheduler,
    FeedRefreshSteps,
    FeedRefreshWorker,
    {
      provide: FEED_REFRESH_OPTIONS,
      useFactory: (): FeedRefreshOptions => ({
        autoStart: true,
        pollMs: 5_000,
        waitMs: 5_000,
        leaseMs: 5 * 60_000,
        shutdownMs: 5_000,
        retry: DEFAULT_REFRESH_RETRY,
        clock: () => new Date(),
      }),
    },
  ],
  // Lo usa la capa GraphQL, igual que el controlador REST.
  exports: [FeedRefreshesService],
})
export class FeedRefreshesModule {}
