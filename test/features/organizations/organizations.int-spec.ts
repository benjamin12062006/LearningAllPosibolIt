import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import { PrismaService } from '../../../src/database/prisma.service.js';
import { OrganizationsRepository } from '../../../src/organizations/organizations.repository.js';
import { ProjectsRepository } from '../../../src/projects/projects.repository.js';
import {
  UsersRepository,
  type LocalUser,
} from '../../../src/users/users.repository.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';

const page = { limit: 100, offset: 0 };

describe('Organización personal y lecturas por membresía con PostgreSQL temporal', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let prisma: PrismaService;
  let organizations: OrganizationsRepository;
  let projects: ProjectsRepository;
  let owner: LocalUser;
  let other: LocalUser;

  beforeAll(async () => {
    database = await createTestDatabase();
    prisma = new PrismaService(database.connection);
    await prisma.onModuleInit();
    organizations = new OrganizationsRepository(prisma);
    projects = new ProjectsRepository(prisma);
  });
  beforeEach(async () => {
    await database.connection.pool.query(
      'TRUNCATE estadistica_forms.app_users CASCADE',
    );
    const users = new UsersRepository(prisma);
    owner = await users.provision(alice);
    other = await users.provision(bob);
  });
  afterAll(async () => {
    try {
      await prisma?.onModuleDestroy();
    } finally {
      await database?.close();
    }
  });

  it('el primer proyecto crea la organización personal y los siguientes la reutilizan', async () => {
    expect(await organizations.findMemberships(owner.id, page)).toEqual([]);

    const first = await projects.create(owner.id, 'Primero', projectInput);
    const second = await projects.create(owner.id, 'Segundo', projectInput);

    const memberships = await organizations.findMemberships(owner.id, page);
    expect(memberships).toEqual([
      {
        id: expect.any(String),
        name: 'Personal',
        kind: 'personal',
        role: 'owner',
        createdAt: expect.any(String),
        archivedAt: null,
      },
    ]);
    const listed = await projects.findAllInOrganization(
      owner.id,
      memberships[0].id,
      page,
    );
    expect(listed.map(({ id }) => id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
  });

  it('crear un proyecto para un perfil inexistente no deja una organización a medias', async () => {
    await expect(
      projects.create(
        '00000000-0000-4000-8000-00000000dead',
        'Nadie',
        projectInput,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PROFILE_NOT_FOUND' }),
    });

    const { rows } = await database.connection.pool.query<{ total: number }>(
      'SELECT count(*)::int AS total FROM estadistica_forms.organizations',
    );
    expect(rows[0].total).toBe(0);
  });

  it('una organización o proyecto ajeno no devuelve filas aunque se consulte el repositorio directamente', async () => {
    const own = await projects.create(owner.id, 'Propio', projectInput);
    const foreign = await projects.create(other.id, 'Ajeno', projectInput);
    const [foreignOrganization] = await organizations.findMemberships(
      other.id,
      page,
    );

    expect(
      await organizations.findMembership(owner.id, foreignOrganization.id),
    ).toBeNull();
    expect(
      await projects.findAllInOrganization(
        owner.id,
        foreignOrganization.id,
        page,
      ),
    ).toEqual([]);
    expect(await projects.findMemberAccess(owner.id, foreign.id)).toBeNull();
    expect(await projects.findMemberAccess(owner.id, own.id)).toEqual({
      organizationId: expect.any(String),
      role: 'owner',
    });
  });

  it('un miembro añadido a la organización ajena la ve con su rol, sin ver la del otro', async () => {
    await projects.create(owner.id, 'Propio', projectInput);
    const shared = await projects.create(other.id, 'Compartido', projectInput);
    const [sharedOrganization] = await organizations.findMemberships(
      other.id,
      page,
    );
    await database.connection.pool.query(
      `INSERT INTO estadistica_forms.organization_members
         (organization_id, user_id, role, created_at)
       VALUES ($1, $2, 'viewer', '2026-11-02T12:00:00.000Z')`,
      [sharedOrganization.id, owner.id],
    );

    const memberships = await organizations.findMemberships(owner.id, page);
    expect(memberships.map(({ role }) => role).sort()).toEqual([
      'owner',
      'viewer',
    ]);
    expect(await projects.findMemberAccess(owner.id, shared.id)).toEqual({
      organizationId: sharedOrganization.id,
      role: 'viewer',
    });
    expect(await organizations.findMemberships(other.id, page)).toHaveLength(1);
  });

  it('un proyecto heredado sin organización todavía no es visible por membresía', async () => {
    const legacy = '00000000-0000-4000-8000-000000000003';
    await database.connection.pool.query(
      `INSERT INTO estadistica_forms.projects (id, name, owner_id, created_at)
       VALUES ($1, 'Heredado', $2, '2026-01-01')`,
      [legacy, owner.id],
    );

    expect(await projects.findMemberAccess(owner.id, legacy)).toBeNull();
    expect(await projects.findByOwner(owner.id, legacy)).not.toBeNull();
  });
});
