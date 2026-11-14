import { Module } from '@nestjs/common';
import { ArtifactsModule } from '../artifacts/artifacts.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { UsersModule } from '../users/users.module.js';
import { WorksheetsModule } from '../worksheets/worksheets.module.js';
import { WorksheetExportCleanupService } from './worksheet-export-cleanup.service.js';
import { WorksheetExportsController } from './worksheet-exports.controller.js';
import { WorksheetExportsRepository } from './worksheet-exports.repository.js';
import { WorksheetExportsService } from './worksheet-exports.service.js';
import {
  WORKSHEET_EXPORT_OPTIONS,
  type WorksheetExportOptions,
} from './worksheet-exports.types.js';

/**
 * Exportar revisiones de hojas a CSV o XLSX (E5.3). Lee las filas con el
 * repositorio de hojas; ni hojas ni importaciones dependen de este módulo.
 */
@Module({
  imports: [
    ArtifactsModule,
    AuthModule,
    PrismaModule,
    UsersModule,
    WorksheetsModule,
  ],
  controllers: [WorksheetExportsController],
  providers: [
    WorksheetExportCleanupService,
    WorksheetExportsRepository,
    WorksheetExportsService,
    {
      provide: WORKSHEET_EXPORT_OPTIONS,
      useFactory: (): WorksheetExportOptions => ({ autoStart: true }),
    },
  ],
  // Lo usa la capa GraphQL, igual que el controlador REST.
  exports: [WorksheetExportsService],
})
export class WorksheetExportsModule {}
