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
import {
  createInvitationToken,
  expiresAtFrom,
  hashInvitationToken,
  normalizeEmail,
} from './invitations.js';
import { OrganizationInvitationsRepository } from './organization-invitations.repository.js';
import { can, type OrganizationRole } from './organization-roles.js';
import { OrganizationsService } from './organizations.service.js';

/**
 * Invitaciones de un solo uso que caducan (C8, C9, F35). El envío del correo
 * queda fuera: la API devuelve el token una sola vez y la web arma el enlace.
 */
@Injectable()
export class OrganizationInvitationsService {
  constructor(
    private readonly usersService: UsersService,
    private readonly organizationsService: OrganizationsService,
    private readonly repository: OrganizationInvitationsRepository,
  ) {}

  async invite(
    identity: AuthenticatedIdentity,
    organizationId: string,
    input: Readonly<{ email: string; role: OrganizationRole }>,
  ) {
    const user = await this.usersService.findCurrent(identity);
    const now = new Date();
    const { token, hash } = createInvitationToken();

    const invitation = await this.repository.create({
      actorId: user.id,
      organizationId,
      email: input.email,
      role: input.role,
      tokenHash: hash,
      now: now.toISOString(),
      expiresAt: expiresAtFrom(now),
    });
    return { invitation, token };
  }

  async findPending(
    identity: AuthenticatedIdentity,
    organizationId: string,
    query?: Partial<PageRequest>,
  ) {
    const user = await this.usersService.findCurrent(identity);
    const membership = await this.organizationsService.requireMembership(
      user.id,
      organizationId,
    );
    if (!can(membership.role, 'members.manage')) {
      throw apiError(ErrorCodes.FORBIDDEN);
    }

    const page = resolvePage(query);
    const rows = await this.repository.findPending(
      organizationId,
      new Date().toISOString(),
      fetchWindow(page),
    );
    return toPage(rows, page);
  }

  async revoke(
    identity: AuthenticatedIdentity,
    organizationId: string,
    invitationId: string,
  ) {
    const user = await this.usersService.findCurrent(identity);
    await this.repository.revoke(
      user.id,
      organizationId,
      invitationId,
      new Date().toISOString(),
    );
  }

  /**
   * El correo sale de la sesión, nunca del cuerpo (C10). Descope no garantiza
   * que venga ni que esté verificado (F37): sin correo, la invitación no se
   * puede aceptar.
   */
  async accept(identity: AuthenticatedIdentity, token: string) {
    const user = await this.usersService.findCurrent(identity);
    const organizationId = await this.repository.accept({
      userId: user.id,
      sessionEmail: identity.email ? normalizeEmail(identity.email) : null,
      tokenHash: hashInvitationToken(token),
      now: new Date().toISOString(),
    });
    return this.organizationsService.findOne(identity, organizationId);
  }
}
