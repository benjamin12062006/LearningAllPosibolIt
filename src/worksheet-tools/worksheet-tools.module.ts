import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { UsersModule } from '../users/users.module.js';
import { WorksheetsModule } from '../worksheets/worksheets.module.js';
import { WorksheetToolsController } from './worksheet-tools.controller.js';
import { WorksheetToolsRepository } from './worksheet-tools.repository.js';
import { WorksheetToolsService } from './worksheet-tools.service.js';

@Module({
  imports: [AuthModule, PrismaModule, UsersModule, WorksheetsModule],
  controllers: [WorksheetToolsController],
  providers: [WorksheetToolsRepository, WorksheetToolsService],
  // El repositorio lo usa el worker del agente para limpiar lo caducado.
  exports: [WorksheetToolsService, WorksheetToolsRepository],
})
export class WorksheetToolsModule {}
