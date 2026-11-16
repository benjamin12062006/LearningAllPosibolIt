import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { UsersModule } from '../users/users.module.js';
import { ImportMappingsController } from './import-mappings.controller.js';
import { ImportMappingsRepository } from './import-mappings.repository.js';
import { ImportMappingsService } from './import-mappings.service.js';
import { WorksheetImportsController } from './worksheet-imports.controller.js';
import { WorksheetImportsRepository } from './worksheet-imports.repository.js';
import { WorksheetImportsService } from './worksheet-imports.service.js';

/**
 * Importar archivos a hojas (E5). Depende de las funciones de hojas y de
 * borradores; ninguno de los dos depende de este módulo. Incluye las
 * plantillas de mapeo (H3), que solo sirven para importar.
 */
@Module({
  imports: [AuthModule, PrismaModule, UsersModule],
  controllers: [WorksheetImportsController, ImportMappingsController],
  providers: [
    WorksheetImportsRepository,
    WorksheetImportsService,
    ImportMappingsRepository,
    ImportMappingsService,
  ],
  // Los usa la capa GraphQL, igual que los controladores REST.
  exports: [WorksheetImportsService, ImportMappingsService],
})
export class WorksheetImportsModule {}
