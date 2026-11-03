import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { CurrentIdentity } from '../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../auth/descope-session.guard.js';
import { PaginationQueryDto } from '../common/http/pagination.js';
import { uuidParamPipe } from '../common/http/validation-errors.js';
import { ProjectMembershipService } from './project-membership.service.js';

/** Rutas de proyectos que se resuelven por membresía (ampliación E1.1). */
@Controller()
@UseGuards(DescopeSessionGuard)
export class ProjectMembershipController {
  constructor(private readonly membershipService: ProjectMembershipService) {}

  @Get('organizations/:organizationId/projects')
  async findAllInOrganization(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Query() query: PaginationQueryDto,
  ) {
    const { items, page } = await this.membershipService.findAllInOrganization(
      identity,
      organizationId,
      query,
    );
    return { projects: items, page };
  }

  @Get('projects/:id/access')
  async findAccess(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('id', uuidParamPipe('id')) id: string,
  ) {
    return { access: await this.membershipService.resolveAccess(identity, id) };
  }
}
