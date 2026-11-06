import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import type { AuthenticatedIdentity } from '../../../src/auth/authenticated-request.js';
import { PrismaService } from '../../../src/database/prisma.service.js';
import { createInvitationToken } from '../../../src/organizations/invitations.js';
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
const NOW = '2026-11-02T12:00:00.000Z';
const NEXT_WEEK = '2026-11-09T12:00:00.000Z';
const LATER = '2026-11-03T12:00:00.000Z';
const page = { limit: 100, offset: 0 };

function rejectedWith(code: string) {
  return { response: expect.objectContaining({ code }) };
}

describe('Equipos, roles e invitaciones con PostgreSQL temporal', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let prisma: PrismaService;
  let organizations: OrganizationsRepository;
  let invitations: OrganizationInvitationsRepository;
  let owner: LocalUser;
  let member: LocalUser;
  let outsider: LocalUser;
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
    outsider = await users.provision(carol);
    teamId = (await organizations.createTeam(owner.id, 'Tienda')).id;
  });
  afterAll(async () => {
    try {
      await prisma?.onModuleDestroy();
    } finally {
      await database?.close();
    }
  });

  async function addMember(userId: string, role: OrganizationRole) {
    await database.connection.pool.query(
      `INSERT INTO estadistica_forms.organization_members
         (organization_id, user_id, role, created_at)
       VALUES ($1, $2, $3, $4)`,
      [teamId, userId, role, NOW],
    );
  }

  function invite(email: string, role: OrganizationRole = 'editor') {
    const { token, hash } = createInvitationToken();
    const created = invitations.create({
      actorId: owner.id,
      organizationId: teamId,
      email,
      role,
      tokenHash: hash,
      now: NOW,
      expiresAt: NEXT_WEEK,
    });
    return created.then((invitation) => ({ invitation, hash }));
  }

  describe('último owner', () => {
    it('el único owner no puede salir ni degradarse', async () => {
      await expect(
        organizations.removeMember(owner.id, teamId, owner.id),
      ).rejects.toMatchObject(rejectedWith('ORGANIZATION_LAST_OWNER'));
      await expect(
        organizations.changeRole(owner.id, teamId, owner.id, 'admin'),
      ).rejects.toMatchObject(rejectedWith('ORGANIZATION_LAST_OWNER'));
    });

    it('con dos owners, el primero que se degrada lo consigue y el segundo ya es el último', async () => {
      await addMember(member.id, 'owner');

      await organizations.changeRole(owner.id, teamId, member.id, 'admin');
      await expect(
        organizations.changeRole(member.id, teamId, owner.id, 'admin'),
      ).rejects.toMatchObject(rejectedWith('FORBIDDEN'));
      await expect(
        organizations.removeMember(owner.id, teamId, owner.id),
      ).rejects.toMatchObject(rejectedWith('ORGANIZATION_LAST_OWNER'));
    });

    it('transferir la propiedad: ascender a otro owner y después salir', async () => {
      await addMember(member.id, 'admin');

      await organizations.changeRole(owner.id, teamId, member.id, 'owner');
      await organizations.removeMember(owner.id, teamId, owner.id);

      const members = await organizations.findMembers(member.id, teamId, page);
      expect(members.map(({ userId, role }) => [userId, role])).toEqual([
        [member.id, 'owner'],
      ]);
    });

    it('la persona dueña de su organización personal sigue siéndolo aunque haya otro owner', async () => {
      await new ProjectsRepository(prisma).create(owner.id, 'P', projectInput);
      const personal = (
        await organizations.findMemberships(owner.id, page)
      ).find(({ kind }) => kind === 'personal');
      await database.connection.pool.query(
        `INSERT INTO estadistica_forms.organization_members
           (organization_id, user_id, role, created_at)
         VALUES ($1, $2, 'owner', $3)`,
        [personal?.id, member.id, NOW],
      );

      await expect(
        organizations.changeRole(member.id, personal!.id, owner.id, 'viewer'),
      ).rejects.toMatchObject(rejectedWith('ORGANIZATION_PERSONAL_OWNER'));
      await expect(
        organizations.removeMember(owner.id, personal!.id, owner.id),
      ).rejects.toMatchObject(rejectedWith('ORGANIZATION_PERSONAL_OWNER'));
    });
  });

  describe('gestión de miembros', () => {
    it('un admin cambia a un editor pero no toca al owner', async () => {
      await addMember(member.id, 'admin');
      await addMember(outsider.id, 'editor');

      expect(
        await organizations.changeRole(
          member.id,
          teamId,
          outsider.id,
          'viewer',
        ),
      ).toMatchObject({ userId: outsider.id, role: 'viewer' });
      await expect(
        organizations.removeMember(member.id, teamId, owner.id),
      ).rejects.toMatchObject(rejectedWith('FORBIDDEN'));
    });

    it('fuera de la organización: 404; destino que no es miembro: MEMBER_NOT_FOUND', async () => {
      await expect(
        organizations.removeMember(outsider.id, teamId, owner.id),
      ).rejects.toMatchObject(rejectedWith('ORGANIZATION_NOT_FOUND'));
      await expect(
        organizations.removeMember(owner.id, teamId, outsider.id),
      ).rejects.toMatchObject(rejectedWith('MEMBER_NOT_FOUND'));
      expect(
        await organizations.findMembers(outsider.id, teamId, page),
      ).toEqual([]);
    });
  });

  describe('invitaciones', () => {
    it('invitar otra vez el mismo correo deja una sola pendiente, la nueva', async () => {
      const first = await invite('carol@example.test');
      const second = await invite('carol@example.test', 'viewer');

      const pending = await invitations.findPending(teamId, NOW, page);
      expect(pending).toEqual([second.invitation]);
      await expect(
        invitations.accept({
          userId: outsider.id,
          sessionEmail: 'carol@example.test',
          tokenHash: first.hash,
          now: LATER,
        }),
      ).rejects.toMatchObject(rejectedWith('INVITATION_NOT_FOUND'));
    });

    it('no invita a quien ya es miembro ni deja invitar sin permiso', async () => {
      await addMember(member.id, 'editor');

      await expect(invite('bob@example.test')).rejects.toMatchObject(
        rejectedWith('MEMBER_ALREADY_EXISTS'),
      );
      await expect(
        invitations.create({
          actorId: member.id,
          organizationId: teamId,
          email: 'carol@example.test',
          role: 'viewer',
          tokenHash: createInvitationToken().hash,
          now: NOW,
          expiresAt: NEXT_WEEK,
        }),
      ).rejects.toMatchObject(rejectedWith('FORBIDDEN'));
    });

    it('aceptar crea la membresía con el rol invitado y consume la invitación una sola vez', async () => {
      const { hash } = await invite('carol@example.test', 'manager');
      const acceptance = {
        userId: outsider.id,
        sessionEmail: 'carol@example.test',
        tokenHash: hash,
        now: LATER,
      };

      expect(await invitations.accept(acceptance)).toBe(teamId);
      expect(
        await organizations.findMembership(outsider.id, teamId),
      ).toMatchObject({ role: 'manager' });
      await expect(invitations.accept(acceptance)).rejects.toMatchObject(
        rejectedWith('INVITATION_NOT_FOUND'),
      );
      expect(await invitations.findPending(teamId, LATER, page)).toEqual([]);
    });

    it('con otro correo o sin correo responde 403 y la invitación sigue pendiente', async () => {
      const { hash, invitation } = await invite('carol@example.test');

      for (const sessionEmail of ['bob@example.test', null]) {
        await expect(
          invitations.accept({
            userId: member.id,
            sessionEmail,
            tokenHash: hash,
            now: LATER,
          }),
        ).rejects.toMatchObject(rejectedWith('INVITATION_EMAIL_MISMATCH'));
      }
      expect(await invitations.findPending(teamId, LATER, page)).toEqual([
        invitation,
      ]);
    });

    it('caducada o revocada responde igual que si no existiera', async () => {
      const expired = await invite('carol@example.test');
      await expect(
        invitations.accept({
          userId: outsider.id,
          sessionEmail: 'carol@example.test',
          tokenHash: expired.hash,
          now: NEXT_WEEK,
        }),
      ).rejects.toMatchObject(rejectedWith('INVITATION_NOT_FOUND'));

      const revoked = await invite('carol@example.test');
      await invitations.revoke(owner.id, teamId, revoked.invitation.id, NOW);
      await expect(
        invitations.accept({
          userId: outsider.id,
          sessionEmail: 'carol@example.test',
          tokenHash: revoked.hash,
          now: LATER,
        }),
      ).rejects.toMatchObject(rejectedWith('INVITATION_NOT_FOUND'));
    });

    it('si ya es miembro no consume la invitación', async () => {
      const { hash, invitation } = await invite('carol@example.test');
      await addMember(outsider.id, 'viewer');

      await expect(
        invitations.accept({
          userId: outsider.id,
          sessionEmail: 'carol@example.test',
          tokenHash: hash,
          now: LATER,
        }),
      ).rejects.toMatchObject(rejectedWith('MEMBER_ALREADY_EXISTS'));
      expect(await invitations.findPending(teamId, LATER, page)).toEqual([
        invitation,
      ]);
    });

    it('solo el owner revoca una invitación de owner', async () => {
      await addMember(member.id, 'admin');
      const { invitation } = await invite('carol@example.test', 'owner');

      await expect(
        invitations.revoke(member.id, teamId, invitation.id, NOW),
      ).rejects.toMatchObject(rejectedWith('FORBIDDEN'));
      await invitations.revoke(owner.id, teamId, invitation.id, NOW);
      await expect(
        invitations.revoke(owner.id, teamId, invitation.id, NOW),
      ).rejects.toMatchObject(rejectedWith('INVITATION_NOT_FOUND'));
    });
  });
});
