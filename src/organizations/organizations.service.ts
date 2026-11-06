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
import { UsersService } from '../users/users.service.js';
import { permissionsFor, type OrganizationRole } from './organization-roles.js';
import { OrganizationsRepository } from './organizations.repository.js';
import type { OrganizationMembership } from './organizations.types.js';

/**
 * El rol se lee de la base en cada petición, no del JWT: depende de la
 * organización y una revocación no puede esperar a que caduque el token.
 */
@Injectable()
export class OrganizationsService {
  constructor(
    private readonly usersService: UsersService,
    private readonly repository: OrganizationsRepository,
  ) {}

  async findAll(identity: AuthenticatedIdentity, query?: Partial<PageRequest>) {
    const user = await this.usersService.findCurrent(identity);
    const page = resolvePage(query);
    const rows = await this.repository.findMemberships(
      user.id,
      fetchWindow(page),
    );
    return toPage(rows, page);
  }

  async findOne(identity: AuthenticatedIdentity, organizationId: string) {
    const user = await this.usersService.findCurrent(identity);
    const { role, ...organization } = await this.requireMembership(
      user.id,
      organizationId,
    );
    return {
      organization,
      access: { role, permissions: permissionsFor(role) },
    };
  }

  /** Organización de equipo; quien la crea queda como `owner`. */
  async create(identity: AuthenticatedIdentity, name: string) {
    const user = await this.usersService.findCurrent(identity);
    const { role, ...organization } = await this.repository.createTeam(
      user.id,
      name,
    );
    return {
      organization,
      access: { role, permissions: permissionsFor(role) },
    };
  }

  async findMembers(
    identity: AuthenticatedIdentity,
    organizationId: string,
    query?: Partial<PageRequest>,
  ) {
    const user = await this.usersService.findCurrent(identity);
    await this.requireMembership(user.id, organizationId);

    const page = resolvePage(query);
    const rows = await this.repository.findMembers(
      user.id,
      organizationId,
      fetchWindow(page),
    );
    return toPage(rows, page);
  }

  /** Permisos, último owner y dueño personal se deciden con las filas bloqueadas, en el repositorio. */
  async changeRole(
    identity: AuthenticatedIdentity,
    organizationId: string,
    targetUserId: string,
    role: OrganizationRole,
  ) {
    const user = await this.usersService.findCurrent(identity);
    return this.repository.changeRole(
      user.id,
      organizationId,
      targetUserId,
      role,
    );
  }

  async removeMember(
    identity: AuthenticatedIdentity,
    organizationId: string,
    targetUserId: string,
  ) {
    const user = await this.usersService.findCurrent(identity);
    await this.repository.removeMember(user.id, organizationId, targetUserId);
  }

  /** Archivar (`true`) o restaurar (`false`); solo un owner (plan 03, A2). */
  async setArchived(
    identity: AuthenticatedIdentity,
    organizationId: string,
    archived: boolean,
  ) {
    const user = await this.usersService.findCurrent(identity);
    const { role, ...organization } = await this.repository.setArchived(
      user.id,
      organizationId,
      archived,
    );
    return {
      organization,
      access: { role, permissions: permissionsFor(role) },
    };
  }

  /** Una organización donde el usuario no es miembro responde 404, como si no existiera. */
  async requireMembership(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationMembership> {
    const membership = await this.repository.findMembership(
      userId,
      organizationId,
    );
    if (!membership) {
      throw apiError(ErrorCodes.ORGANIZATION_NOT_FOUND);
    }
    return membership;
  }
}
