import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { UsersModule } from '../users/users.module.js';
import { ProjectMembershipController } from './project-membership.controller.js';
import { ProjectMembershipService } from './project-membership.service.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsRepository } from './projects.repository.js';
import { ProjectsService } from './projects.service.js';

/** Un proyecto pertenece a una organización: este módulo depende de `OrganizationsModule`, no al revés. */
@Module({
  imports: [AuthModule, PrismaModule, UsersModule, OrganizationsModule],
  controllers: [ProjectsController, ProjectMembershipController],
  providers: [ProjectsRepository, ProjectsService, ProjectMembershipService],
  // `ProjectMembershipService` también lo usa la capa GraphQL.
  exports: [ProjectsService, ProjectMembershipService],
})
export class ProjectsModule {}
