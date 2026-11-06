import { Module } from '@nestjs/common';
import { ArtifactsModule } from '../artifacts/artifacts.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { UsersModule } from '../users/users.module.js';
import { FeedCleanupService } from './feed-cleanup.service.js';
import { FeedDeliveryController } from './feed-delivery.controller.js';
import { FeedDeliveryService } from './feed-delivery.service.js';
import { FeedsController } from './feeds.controller.js';
import { FeedsRepository } from './feeds.repository.js';
import { FeedsService } from './feeds.service.js';
import { FEED_OPTIONS, type FeedOptions } from './feeds.types.js';

/**
 * Feed del proyecto y sus publicaciones (incremento 5). Lee la tabla de
 * exportaciones con su propio repositorio, como exportaciones lee la de
 * evaluaciones: no depende de `ExportsModule`.
 */
@Module({
  imports: [
    ArtifactsModule,
    AuthModule,
    OutboxModule,
    PrismaModule,
    ProjectsModule,
    UsersModule,
  ],
  controllers: [FeedsController, FeedDeliveryController],
  providers: [
    FeedCleanupService,
    FeedDeliveryService,
    FeedsRepository,
    FeedsService,
    {
      provide: FEED_OPTIONS,
      useFactory: (): FeedOptions => ({ autoStart: true, retainedFiles: 3 }),
    },
  ],
  // La actualización automática publica con las mismas reglas (E5).
  exports: [FeedsService],
})
export class FeedsModule {}
