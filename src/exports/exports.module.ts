import { Module } from '@nestjs/common';
import { ArtifactsModule } from '../artifacts/artifacts.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { UsersModule } from '../users/users.module.js';
import { ExportCleanupService } from './export-cleanup.service.js';
import { ExportsController } from './exports.controller.js';
import { ExportsRepository } from './exports.repository.js';
import { ExportsService } from './exports.service.js';
import { EXPORT_OPTIONS, type ExportOptions } from './exports.types.js';

/**
 * Exportación TSV de una evaluación revisada (incremento 3). Lee las tablas de
 * evaluaciones con su propio repositorio, como evaluaciones lee las de
 * importación: no depende de `EvaluationsModule`.
 */
@Module({
  imports: [
    ArtifactsModule,
    AuthModule,
    PrismaModule,
    ProjectsModule,
    UsersModule,
  ],
  controllers: [ExportsController],
  providers: [
    ExportCleanupService,
    ExportsRepository,
    ExportsService,
    {
      provide: EXPORT_OPTIONS,
      useFactory: (): ExportOptions => ({ autoStart: true }),
    },
  ],
  // La actualización automática del feed exporta con las mismas reglas.
  exports: [ExportsService],
})
export class ExportsModule {}
