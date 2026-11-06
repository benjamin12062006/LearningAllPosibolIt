import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { UsersModule } from '../users/users.module.js';
import { OrganizationInvitationsController } from './organization-invitations.controller.js';
import { OrganizationInvitationsRepository } from './organization-invitations.repository.js';
import { OrganizationInvitationsService } from './organization-invitations.service.js';
import { OrganizationsController } from './organizations.controller.js';
import { OrganizationsRepository } from './organizations.repository.js';
import { OrganizationsService } from './organizations.service.js';

/** Solo depende de usuarios: proyectos y lo que venga después dependen de él. */
@Module({
  imports: [AuthModule, PrismaModule, UsersModule],
  controllers: [OrganizationsController, OrganizationInvitationsController],
  providers: [
    OrganizationsRepository,
    OrganizationsService,
    OrganizationInvitationsRepository,
    OrganizationInvitationsService,
  ],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
