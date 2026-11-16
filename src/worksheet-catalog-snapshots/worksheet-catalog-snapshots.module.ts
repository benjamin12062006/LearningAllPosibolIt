import { Module } from '@nestjs/common';
import { ArtifactsModule } from '../artifacts/artifacts.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogImportModule } from '../catalog-import/catalog-import.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { UsersModule } from '../users/users.module.js';
import { WorksheetsModule } from '../worksheets/worksheets.module.js';
import { CatalogWorksheetService } from './catalog-worksheet.service.js';
import { WorksheetCatalogSnapshotsController } from './worksheet-catalog-snapshots.controller.js';
import { WorksheetCatalogSnapshotsRepository } from './worksheet-catalog-snapshots.repository.js';
import { WorksheetCatalogSnapshotsService } from './worksheet-catalog-snapshots.service.js';

/**
 * El adaptador de hojas a catálogo (E5.4, ficha 04, C35). Depende de hojas y
 * de la importación de catálogo; ninguno de los dos depende de él.
 */
@Module({
  imports: [
    ArtifactsModule,
    AuthModule,
    CatalogImportModule,
    PrismaModule,
    UsersModule,
    WorksheetsModule,
  ],
  controllers: [WorksheetCatalogSnapshotsController],
  providers: [
    WorksheetCatalogSnapshotsRepository,
    WorksheetCatalogSnapshotsService,
    CatalogWorksheetService,
  ],
  // Los usa la capa GraphQL, igual que el controlador REST.
  exports: [WorksheetCatalogSnapshotsService, CatalogWorksheetService],
})
export class WorksheetCatalogSnapshotsModule {}
