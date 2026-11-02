import { Module } from '@nestjs/common';
import { ArtifactsModule } from '../artifacts/artifacts.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { UsersModule } from '../users/users.module.js';
import { ArtifactCleanupService } from './artifact-cleanup.service.js';
import { CatalogImportController } from './catalog-import.controller.js';
import { CatalogImportRepository } from './catalog-import.repository.js';
import { CatalogImportService } from './catalog-import.service.js';
import { CatalogImportWorker } from './catalog-import.worker.js';
import { ImportAccessGuard } from './import-access.guard.js';
import { ImportUploadInterceptor } from './import-upload.interceptor.js';
import {
  CATALOG_IMPORT_OPTIONS,
  type CatalogImportOptions,
} from './import.types.js';

@Module({
  imports: [
    ArtifactsModule,
    AuthModule,
    PrismaModule,
    ProjectsModule,
    UsersModule,
  ],
  controllers: [CatalogImportController],
  providers: [
    ArtifactCleanupService,
    CatalogImportRepository,
    CatalogImportService,
    CatalogImportWorker,
    ImportAccessGuard,
    ImportUploadInterceptor,
    {
      provide: CATALOG_IMPORT_OPTIONS,
      useFactory: (): CatalogImportOptions => ({
        autoStart: true,
        pollMs: 1000,
        shutdownMs: 5000,
      }),
    },
  ],
  exports: [CatalogImportService],
})
export class CatalogImportModule {}
