import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ExportsModule } from '../exports/exports.module.js';
import { FeedsModule } from '../feeds/feeds.module.js';
import { FeedViewerController } from './feed-viewer.controller.js';
import { FeedViewerService } from './feed-viewer.service.js';

/**
 * Visor del feed (plan E6, V1). Depende de exportaciones y feeds, que son los
 * dueños de los archivos y de sus permisos; ellos no dependen de este módulo.
 */
@Module({
  imports: [AuthModule, ExportsModule, FeedsModule],
  controllers: [FeedViewerController],
  providers: [FeedViewerService],
})
export class FeedViewerModule {}
