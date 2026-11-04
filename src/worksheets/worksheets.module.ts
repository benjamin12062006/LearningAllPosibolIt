import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { UsersModule } from '../users/users.module.js';
import { WorksheetRowsRepository } from './worksheet-rows.repository.js';
import { WorksheetRowsService } from './worksheet-rows.service.js';
import { WorksheetsController } from './worksheets.controller.js';
import { WorksheetsRepository } from './worksheets.repository.js';
import { WorksheetsService } from './worksheets.service.js';

/**
 * Usa las funciones de bloqueo y permisos de organizaciones directamente; no
 * necesita sus servicios. Nada de organizaciones ni de proyectos depende de
 * este módulo.
 */
@Module({
  imports: [AuthModule, PrismaModule, UsersModule],
  controllers: [WorksheetsController],
  providers: [
    WorksheetsRepository,
    WorksheetsService,
    WorksheetRowsRepository,
    WorksheetRowsService,
  ],
})
export class WorksheetsModule {}
