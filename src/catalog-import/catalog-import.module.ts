import { Module } from '@nestjs/common';
import { resolve } from 'node:path';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { UsersModule } from '../users/users.module.js';
import { ArtifactStore } from './artifact.store.js';
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
  imports: [AuthModule, PrismaModule, ProjectsModule, UsersModule],
  controllers: [CatalogImportController],
  providers: [
    ArtifactStore,
    CatalogImportRepository,
    CatalogImportService,
    CatalogImportWorker,
    ImportAccessGuard,
    ImportUploadInterceptor,
    {
      provide: CATALOG_IMPORT_OPTIONS,
      useFactory: (): CatalogImportOptions => ({
        root: resolve(
          process.env.CATALOG_IMPORT_ROOT?.trim() || '.data/catalog-import',
        ),
        autoStart: true,
        pollMs: 1000,
        shutdownMs: 5000,
      }),
    },
  ],
})
export class CatalogImportModule {}
