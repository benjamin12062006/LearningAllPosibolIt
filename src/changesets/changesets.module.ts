import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { UsersModule } from '../users/users.module.js';
import { ChangesetsController } from './changesets.controller.js';
import { ChangesetsRepository } from './changesets.repository.js';
import { ChangesetsService } from './changesets.service.js';

/**
 * Borradores de hojas (E4). Depende de hojas (bloqueo del proyecto, columnas
 * y validación de filas) y de organizaciones; ninguno de los dos depende de
 * este módulo. Cuando haya un segundo ámbito (catálogo de productos, E8), la
 * coordinación de aplicar pasará a un módulo propio ([11]).
 */
@Module({
  imports: [AuthModule, PrismaModule, UsersModule],
  controllers: [ChangesetsController],
  providers: [ChangesetsRepository, ChangesetsService],
  // Lo usa la capa GraphQL, igual que el controlador REST.
  exports: [ChangesetsService],
})
export class ChangesetsModule {}
