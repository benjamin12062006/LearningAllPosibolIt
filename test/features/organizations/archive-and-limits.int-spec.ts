import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedIdentity } from '../../../src/auth/authenticated-request.js';
import { PrismaService } from '../../../src/database/prisma.service.js';
import { createInvitationToken } from '../../../src/organizations/invitations.js';
import { ORGANIZATION_LIMITS } from '../../../src/organizations/organization-limits.js';
import { OrganizationInvitationsRepository } from '../../../src/organizations/organization-invitations.repository.js';
import type { OrganizationRole } from '../../../src/organizations/organization-roles.js';
import { OrganizationsRepository } from '../../../src/organizations/organizations.repository.js';
import { ProjectsRepository } from '../../../src/projects/projects.repository.js';
import {
  UsersRepository,
  type LocalUser,
} from '../../../src/users/users.repository.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';

const carol: AuthenticatedIdentity = {
  ...alice,
  subject: 'carol',
  email: 'carol@example.test',
};
const NOW = '2026-11-03T12:00:00.000Z';
const NEXT_WEEK = '2026-11-10T12:00:00.000Z';
const LATER = '2026-11-04T12:00:00.000Z';
const page = { limit: 100, offset: 0 };

function rejectedWith(code: string) {
  return { response: expect.objectContaining({ code }) };
}

describe('Archivar organizaciones y cuotas mínimas con PostgreSQL temporal', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let prisma: PrismaService;
  let organizations: OrganizationsRepository;
  let invitations: OrganizationInvitationsRepository;
  let owner: LocalUser;
  let member: LocalUser;
  let invitee: LocalUser;
  let teamId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    prisma = new PrismaService(database.connection);
    await prisma.onModuleInit();
    organizations = new OrganizationsRepository(prisma);
    invitations = new OrganizationInvitationsRepository(prisma);
  });
  beforeEach(async () => {
    await database.connection.pool.query(
      'TRUNCATE estadistica_forms.app_users CASCADE',
    );
    const users = new UsersRepository(prisma);
    owner = await users.provision(alice);
    member = await users.provision(bob);
    invitee = await users.provision(carol);
    teamId = (await organizations.createTeam(owner.id, 'Tienda')).id;
    await addMember(teamId, member.id, 'editor');
  });
  afterAll(async () => {
    try {
      await prisma?.onModuleDestroy();
    } finally {
      await database?.close();
    }
  });

  async function addMember(
    organizationId: string,
    userId: string,
    role: OrganizationRole,
  ) {
    await database.connection.pool.query(
      `INSERT INTO estadistica_forms.organization_members
         (organization_id, user_id, role, created_at)
       VALUES ($1, $2, $3, $4)`,
      [organizationId, userId, role, NOW],
    );
  }

  function invite(email: string, organizationId = teamId) {
    const { hash } = createInvitationToken();
    return invitations
      .create({
        actorId: owner.id,
        organizationId,
        email,
        role: 'viewer',
        tokenHash: hash,
        now: NOW,
        expiresAt: NEXT_WEEK,
      })
      .then((invitation) => ({ invitation, hash }));
  }

  /** Usuarios sueltos para llenar plazas sin pasar por invitaciones. */
  async function fillWithMembers(organizationId: string, count: number) {
    for (let index = 0; index < count; index++) {
      const id = randomUUID();
      await database.connection.pool.query(
        `INSERT INTO estadistica_forms.app_users
           (id, identity_issuer, identity_subject, created_at, updated_at)
         VALUES ($1, 'https://identity.example.test', $1, $2, $2)`,
        [id, NOW],
      );
      await addMember(organizationId, id, 'viewer');
    }
  }

  describe('archivar', () => {
    it('una organización archivada se lee, pero no admite ningún cambio de miembros ni invitaciones', async () => {
      const pending = await invite('carol@example.test');
      const archived = await organizations.setArchived(owner.id, teamId, true);
      expect(archived.archivedAt).toEqual(expect.any(String));

      const writes: [string, () => Promise<unknown>][] = [
        ['invitar', () => invite('otra@example.test')],
        [
          'revocar',
          () =>
            invitations.revoke(owner.id, teamId, pending.invitation.id, NOW),
        ],
        [
          'aceptar',
          () =>
            invitations.accept({
              userId: invitee.id,
              sessionEmail: 'carol@example.test',
              tokenHash: pending.hash,
              now: LATER,
            }),
        ],
        [
          'cambiar rol',
          () => organizations.changeRole(owner.id, teamId, member.id, 'viewer'),
        ],
        [
          'quitar',
          () => organizations.removeMember(owner.id, teamId, member.id),
        ],
      ];
      for (const [, write] of writes) {
        await expect(write()).rejects.toMatchObject(
          rejectedWith('ORGANIZATION_ARCHIVED'),
        );
      }

      expect(
        await organizations.findMembers(member.id, teamId, page),
      ).toHaveLength(2);
      expect(await invitations.findPending(teamId, NOW, page)).toEqual([
        pending.invitation,
      ]);
    });

    it('archivar dos veces conserva la fecha y restaurar devuelve las escrituras', async () => {
      const first = await organizations.setArchived(owner.id, teamId, true);
      const second = await organizations.setArchived(owner.id, teamId, true);
      expect(second.archivedAt).toBe(first.archivedAt);

      const restored = await organizations.setArchived(owner.id, teamId, false);
      expect(restored.archivedAt).toBeNull();
      await organizations.changeRole(owner.id, teamId, member.id, 'viewer');
    });

    it('solo un owner archiva; quien no es miembro recibe 404', async () => {
      await database.connection.pool.query(
        `UPDATE estadistica_forms.organization_members SET role = 'admin'
         WHERE organization_id = $1 AND user_id = $2`,
        [teamId, member.id],
      );

      await expect(
        organizations.setArchived(member.id, teamId, true),
      ).rejects.toMatchObject(rejectedWith('FORBIDDEN'));
      await expect(
        organizations.setArchived(invitee.id, teamId, true),
      ).rejects.toMatchObject(rejectedWith('ORGANIZATION_NOT_FOUND'));
    });

    it('quien no es miembro recibe 404 aunque la organización esté archivada', async () => {
      await organizations.setArchived(owner.id, teamId, true);

      await expect(
        organizations.removeMember(invitee.id, teamId, member.id),
      ).rejects.toMatchObject(rejectedWith('ORGANIZATION_NOT_FOUND'));
    });

    it('una organización personal no se archiva', async () => {
      await new ProjectsRepository(prisma).create(owner.id, 'P', projectInput);
      const personal = (
        await organizations.findMemberships(owner.id, page)
      ).find(({ kind }) => kind === 'personal');

      await expect(
        organizations.setArchived(owner.id, personal!.id, true),
      ).rejects.toMatchObject(
        rejectedWith('ORGANIZATION_PERSONAL_NOT_ARCHIVABLE'),
      );
    });
  });

  describe('cuotas', () => {
    it('una persona es owner de como mucho 10 equipos, archivados incluidos', async () => {
      const limit = ORGANIZATION_LIMITS.teamOrganizationsPerOwner;
      for (let created = 1; created < limit; created++) {
        await organizations.createTeam(owner.id, `Equipo ${created}`);
      }
      await organizations.setArchived(owner.id, teamId, true);

      await expect(
        organizations.createTeam(owner.id, 'Uno más'),
      ).rejects.toMatchObject(rejectedWith('TEAM_ORGANIZATIONS_LIMIT'));
      await organizations.createTeam(member.id, 'De otra persona');
    });

    it('las invitaciones pendientes ocupan plaza y reinvitar el mismo correo no ocupa otra', async () => {
      const seats = ORGANIZATION_LIMITS.seatsPerOrganization;
      // Owner y editor ya ocupan 2; una invitación pendiente ocupa la última.
      await fillWithMembers(teamId, seats - 3);
      await invite('carol@example.test');

      await expect(invite('otra@example.test')).rejects.toMatchObject(
        rejectedWith('ORGANIZATION_SEATS_LIMIT'),
      );
      await invite('carol@example.test');
    });

    it('una invitación caducada deja de ocupar plaza', async () => {
      const seats = ORGANIZATION_LIMITS.seatsPerOrganization;
      await fillWithMembers(teamId, seats - 3);
      await database.connection.pool.query(
        `INSERT INTO estadistica_forms.organization_invitations
           (id, organization_id, email_normalized, role, token_hash, invited_by, created_at, expires_at)
         VALUES ($1, $2, 'vieja@example.test', 'viewer', $3, $4, $5, $5)`,
        [randomUUID(), teamId, createInvitationToken().hash, owner.id, NOW],
      );

      await invite('carol@example.test');
    });

    it('aceptar con la organización llena responde 409 y no consume la invitación', async () => {
      const seats = ORGANIZATION_LIMITS.seatsPerOrganization;
      const pending = await invite('carol@example.test');
      await fillWithMembers(teamId, seats - 2);

      await expect(
        invitations.accept({
          userId: invitee.id,
          sessionEmail: 'carol@example.test',
          tokenHash: pending.hash,
          now: LATER,
        }),
      ).rejects.toMatchObject(rejectedWith('ORGANIZATION_SEATS_LIMIT'));
      expect(await invitations.findPending(teamId, LATER, page)).toEqual([
        pending.invitation,
      ]);
    });
  });
});
