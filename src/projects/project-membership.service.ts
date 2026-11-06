import { Injectable } from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import {
  fetchWindow,
  resolvePage,
  toPage,
  type PageRequest,
} from '../common/http/pagination.js';
import { permissionsFor } from '../organizations/organization-roles.js';
import { OrganizationsService } from '../organizations/organizations.service.js';
import { UsersService } from '../users/users.service.js';
import { ProjectsRepository } from './projects.repository.js';
import type { ProjectAccess } from './projects.types.js';

/**
 * Lecturas de proyectos por membresía (ampliación E1.1). Convive con
 * `ProjectsService`, que sigue resolviendo por propietario para las rutas
 * existentes. Cuando E1.2 pase esas rutas a membresía, este servicio y
 * `ProjectsService` se unen.
 */
@Injectable()
export class ProjectMembershipService {
  constructor(
    private readonly usersService: UsersService,
    private readonly organizationsService: OrganizationsService,
    private readonly projectsRepository: ProjectsRepository,
  ) {}

  async findAllInOrganization(
    identity: AuthenticatedIdentity,
    organizationId: string,
    query?: Partial<PageRequest>,
  ) {
    const user = await this.usersService.findCurrent(identity);
    await this.organizationsService.requireMembership(user.id, organizationId);

    const page = resolvePage(query);
    const rows = await this.projectsRepository.findAllInOrganization(
      user.id,
      organizationId,
      fetchWindow(page),
    );
    return toPage(rows, page);
  }

  /**
   * Contexto de acceso que usarán hojas, revisiones e IA. Un proyecto de otra
   * organización responde 404, igual que uno que no existe.
   */
  async resolveAccess(
    identity: AuthenticatedIdentity,
    projectId: string,
  ): Promise<ProjectAccess> {
    const user = await this.usersService.findCurrent(identity);
    const member = await this.projectsRepository.findMemberAccess(
      user.id,
      projectId,
    );
    if (!member) {
      throw apiError(ErrorCodes.PROJECT_NOT_FOUND);
    }
    return {
      actorId: user.id,
      organizationId: member.organizationId,
      projectId,
      role: member.role,
      permissions: permissionsFor(member.role),
    };
  }
}
