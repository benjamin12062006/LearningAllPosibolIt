import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { UsersModule } from '../users/users.module.js';
import { SavedViewsController } from './saved-views.controller.js';
import { SavedViewsRepository } from './saved-views.repository.js';
import { SavedViewsService } from './saved-views.service.js';
import { WorksheetRowsRepository } from './worksheet-rows.repository.js';
import { WorksheetRowsService } from './worksheet-rows.service.js';
import { WorksheetsController } from './worksheets.controller.js';
import { WorksheetsRepository } from './worksheets.repository.js';
import { WorksheetsService } from './worksheets.service.js';

/**
 * Usa las funciones de bloqueo y permisos de organizaciones directamente; no
 * necesita sus servicios. Nada de organizaciones ni de proyectos depende de
 * este módulo; los borradores de E4 sí, y por eso exporta el repositorio. Las
 * exportaciones (E5.3) leen las filas de una revisión con la misma consulta
 * que `rows/query`.
 */
@Module({
  imports: [AuthModule, PrismaModule, UsersModule],
  controllers: [WorksheetsController, SavedViewsController],
  providers: [
    WorksheetsRepository,
    WorksheetsService,
    WorksheetRowsRepository,
    WorksheetRowsService,
    SavedViewsRepository,
    SavedViewsService,
  ],
  exports: [
    WorksheetsRepository,
    WorksheetRowsRepository,
    // Los usa la capa GraphQL, igual que los controladores REST.
    WorksheetsService,
    WorksheetRowsService,
    SavedViewsService,
  ],
})
export class WorksheetsModule {}
