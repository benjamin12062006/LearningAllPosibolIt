import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { UsersModule } from '../users/users.module.js';
import { WorksheetImportsController } from './worksheet-imports.controller.js';
import { WorksheetImportsRepository } from './worksheet-imports.repository.js';
import { WorksheetImportsService } from './worksheet-imports.service.js';

/**
 * Importar archivos a hojas (E5). Depende de las funciones de hojas y de
 * borradores; ninguno de los dos depende de este módulo.
 */
@Module({
  imports: [AuthModule, PrismaModule, UsersModule],
  controllers: [WorksheetImportsController],
  providers: [WorksheetImportsRepository, WorksheetImportsService],
})
export class WorksheetImportsModule {}
