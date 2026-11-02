import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import { readFile } from 'node:fs/promises';
import { PrismaService } from '../../../src/database/prisma.service.js';
import {
  UsersRepository,
  type LocalUser,
} from '../../../src/users/users.repository.js';
import { ProjectsRepository } from '../../../src/projects/projects.repository.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';

describe('ProjectsRepository con Prisma y PostgreSQL temporal', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let prisma: PrismaService;
  let repository: ProjectsRepository;
  let owner: LocalUser;
  let other: LocalUser;

  beforeAll(async () => {
    database = await createTestDatabase();
    prisma = new PrismaService(database.connection);
    await prisma.onModuleInit();
    repository = new ProjectsRepository(prisma);
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

  it('persiste la configuración, conserva fechas y ordena por fecha e ID descendentes', async () => {
    const first = await repository.create(owner.id, 'Primero', projectInput);
    const second = await repository.create(owner.id, 'Segundo', projectInput);
    const tiedDate = '2026-10-25T12:00:00.000Z';
    await database.connection.pool.query(
      'UPDATE estadistica_forms.projects SET created_at=$1',
      [tiedDate],
    );

    const projects = await repository.findAllByOwner(owner.id, {
      limit: 100,
      offset: 0,
    });

    expect(projects.map(({ id }) => id)).toEqual(
      [first.id, second.id].sort().reverse(),
    );
    expect(projects).toHaveLength(2);
    expect(await repository.findByOwner(owner.id, first.id)).toEqual({
      ...first,
      createdAt: tiedDate,
    });
    expect(first).toMatchObject({
      country: 'US',
      currency: 'USD',
      configurationStatus: 'ready',
    });
  });

  it('filtra lectura y escritura por propietario, incluso con SQL directo al repositorio', async () => {
    const own = await repository.create(owner.id, 'Propio', projectInput);
    const foreign = await repository.create(other.id, 'Ajeno', projectInput);

    expect(
      await repository.findAllByOwner(owner.id, { limit: 100, offset: 0 }),
    ).toEqual([own]);
    expect(await repository.findByOwner(owner.id, foreign.id)).toBeNull();
    expect(
      await repository.update(owner.id, foreign.id, { name: 'Intrusión' }),
    ).toBeNull();
    expect(await repository.findByOwner(other.id, foreign.id)).toEqual(foreign);
  });

  it('completa un heredado y permite renombrarlo conservando ID y fecha', async () => {
    const id = '00000000-0000-4000-8000-000000000003';
    await database.connection.pool.query(
      'INSERT INTO estadistica_forms.projects (id,name,owner_id,created_at) VALUES ($1,$2,$3,$4)',
      [id, 'Heredado', owner.id, '2026-01-01'],
    );
    const inherited = await repository.findByOwner(owner.id, id);
    expect(inherited).toMatchObject({
      country: null,
      currency: null,
      channelProfile: null,
      configurationStatus: 'required',
    });

    await repository.update(owner.id, id, projectInput);
    const updated = await repository.update(owner.id, id, {
      name: 'Renombrado',
    });

    expect(updated).toEqual({
      ...inherited,
      ...projectInput,
      name: 'Renombrado',
      configurationStatus: 'ready',
    });
  });

  it.each([
    ['US', null, null],
    ['us', 'USD', 'google_merchant'],
    ['US', 'usd', 'google_merchant'],
    ['US', 'USD', 'unknown'],
  ])(
    'la base rechaza configuración incoherente: %j %j %j',
    async (country, currency, channel) => {
      const project = await repository.create(owner.id, 'Válido', projectInput);

      await expect(
        database.connection.pool.query(
          'UPDATE estadistica_forms.projects SET country=$1, currency=$2, channel_profile=$3 WHERE id=$4',
          [country, currency, channel, project.id],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      expect(await repository.findByOwner(owner.id, project.id)).toEqual(
        project,
      );
    },
  );

  it('la FK impide insertar un proyecto huérfano', async () => {
    await expect(
      database.connection.pool.query(
        "INSERT INTO estadistica_forms.projects (id,name,owner_id,created_at) VALUES ('orphan','Huérfano','missing','2026-10-25')",
      ),
    ).rejects.toMatchObject({ code: '23503' });
    expect(
      await repository.findAllByOwner(owner.id, { limit: 100, offset: 0 }),
    ).toEqual([]);
  });

  it('Prisma no reaplica las migraciones al repetir deploy', async () => {
    await database.migrate();
    const { rows } = await database.connection.pool.query(
      'SELECT migration_name, rolled_back_at FROM estadistica_forms._prisma_migrations ORDER BY migration_name',
    );
    expect(rows).toHaveLength(10);
    expect(rows.every((row) => row.rolled_back_at === null)).toBe(true);
  });
});

it('la migración aditiva conserva exactamente los espacios y propietarios anteriores', async () => {
  const database = await createTestDatabase({ migrate: false });
  try {
    for (const migration of [
      '20261022000100_create_app_users',
      '20261022000200_create_statistical_spaces',
      '20261022000300_index_statistical_spaces_owner',
    ]) {
      await database.connection.pool.query(
        await readFile(`prisma/migrations/${migration}/migration.sql`, 'utf8'),
      );
    }
    await database.connection.pool.query(
      "INSERT INTO estadistica_forms.app_users (id,identity_issuer,identity_subject,created_at,updated_at) VALUES ('alice','issuer','alice','old-date','old-date'),('bob','issuer','bob','other-date','other-date')",
    );
    await database.connection.pool.query(
      "INSERT INTO estadistica_forms.statistical_spaces (id,name,owner_id,created_at) VALUES ('old-a','Espacio A','alice','2026-01-01'),('old-b','Espacio B','bob','2026-02-01')",
    );
    const before = await database.connection.pool.query(
      'SELECT id,name,owner_id,created_at FROM estadistica_forms.statistical_spaces ORDER BY id',
    );

    await database.connection.pool.query(
      await readFile(
        'prisma/migrations/20261025000100_configure_projects/migration.sql',
        'utf8',
      ),
    );

    const after = await database.connection.pool.query(
      'SELECT id,name,owner_id,created_at FROM estadistica_forms.projects ORDER BY id',
    );
    expect(after.rows).toEqual(before.rows);
    const { rows } = await database.connection.pool.query(
      'SELECT country,currency,channel_profile FROM estadistica_forms.projects',
    );
    expect(rows).toEqual([
      { country: null, currency: null, channel_profile: null },
      { country: null, currency: null, channel_profile: null },
    ]);
    const { rows: tables } = await database.connection.pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='estadistica_forms'",
    );
    expect(tables).toEqual(expect.arrayContaining([{ tablename: 'projects' }]));
    expect(tables).not.toEqual(
      expect.arrayContaining([{ tablename: 'statistical_spaces' }]),
    );
    const { rows: indexes } = await database.connection.pool.query(
      "SELECT indexname FROM pg_indexes WHERE schemaname='estadistica_forms' AND tablename='projects'",
    );
    expect(indexes).toEqual(
      expect.arrayContaining([{ indexname: 'idx_projects_owner_created' }]),
    );
  } finally {
    await database.close();
  }
});
