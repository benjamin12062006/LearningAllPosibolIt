import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { CatalogImportRepository } from '../../../src/catalog-import/catalog-import.repository.js';
import { PrismaService } from '../../../src/database/prisma.service.js';
import type { Ruleset } from '../../../src/evaluations/engine/ruleset.js';
import type { Project } from '../../../src/projects/projects.types.js';
import { ProjectsRepository } from '../../../src/projects/projects.repository.js';
import { RulesetsRepository } from '../../../src/rulesets/rulesets.repository.js';
import {
  UsersRepository,
  type LocalUser,
} from '../../../src/users/users.repository.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';

const RULESET: Ruleset = {
  mapping: [
    { attribute: 'title', column: 'Nombre' },
    { attribute: 'price', column: 'Precio' },
  ],
  rules: [
    { type: 'exclude_when', attribute: 'id', operator: 'equals', value: 'X' },
    { type: 'build_title', template: '{title}' },
    { type: 'clean_text', attributes: ['title'] },
  ],
};

const conflict = (code: string, status: number) =>
  expect.objectContaining({
    status,
    response: expect.objectContaining({ code }),
  });

describe('RulesetsRepository con Prisma y PostgreSQL temporal', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let prisma: PrismaService;
  let repository: RulesetsRepository;
  let projects: ProjectsRepository;
  let owner: LocalUser;
  let other: LocalUser;
  let project: Project;

  beforeAll(async () => {
    database = await createTestDatabase();
    prisma = new PrismaService(database.connection);
    await prisma.onModuleInit();
    repository = new RulesetsRepository(prisma);
    projects = new ProjectsRepository(prisma);
  });
  beforeEach(async () => {
    await database.connection.pool.query(
      'TRUNCATE estadistica_forms.app_users CASCADE',
    );
    const users = new UsersRepository(prisma);
    owner = await users.provision(alice);
    other = await users.provision(bob);
    project = await projects.create(owner.id, 'Tienda', projectInput);
  });
  afterAll(async () => {
    try {
      await prisma?.onModuleDestroy();
    } finally {
      await database?.close();
    }
  });

  it('guarda revisiones crecientes por proyecto y conserva el orden de las reglas', async () => {
    const first = await repository.create(owner.id, project.id, RULESET);
    const second = await repository.create(owner.id, project.id, RULESET);
    const otherProject = await projects.create(owner.id, 'Otra', projectInput);
    const firstOfOther = await repository.create(
      owner.id,
      otherProject.id,
      RULESET,
    );

    expect([first.revision, second.revision]).toEqual([1, 2]);
    expect(firstOfOther.revision).toBe(1);
    expect(await repository.findByRevision(project.id, 1)).toEqual(first);
    expect(first).toMatchObject({
      mapping: RULESET.mapping,
      rules: RULESET.rules,
    });
  });

  // PGlite es de una sola conexión y el servidor de pruebas multiplexa las
  // transacciones sobre ella: aquí se ejecutan una tras otra. Esta prueba pasa
  // también sin `FOR UPDATE`, así que no demuestra el bloqueo (bitácora 02).
  it('asigna números distintos a guardados simultáneos', async () => {
    const saved = await Promise.all(
      Array.from({ length: 5 }, () =>
        repository.create(owner.id, project.id, RULESET),
      ),
    );
    expect(saved.map((version) => version.revision).sort()).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it('traduce una colisión de revisión a 409 y no guarda nada', async () => {
    await repository.create(owner.id, project.id, RULESET);
    // Fuerza el caso que el bloqueo evita: otra transacción ya ocupó el número.
    const internals = repository as unknown as {
      nextRevision: () => Promise<number>;
    };
    jest.spyOn(internals, 'nextRevision').mockResolvedValueOnce(1);

    await expect(
      repository.create(owner.id, project.id, RULESET),
    ).rejects.toEqual(conflict('RULESET_REVISION_CONFLICT', 409));
    expect(
      await repository.findAllByProject(project.id, { limit: 10, offset: 0 }),
    ).toHaveLength(1);
  });

  it('responde 404 con un proyecto ajeno y 409 sin configuración', async () => {
    await expect(
      repository.create(other.id, project.id, RULESET),
    ).rejects.toEqual(conflict('PROJECT_NOT_FOUND', 404));

    await database.connection.pool.query(
      `UPDATE estadistica_forms.projects
       SET country = NULL, currency = NULL, channel_profile = NULL
       WHERE id = $1`,
      [project.id],
    );
    await expect(
      repository.create(owner.id, project.id, RULESET),
    ).rejects.toEqual(conflict('PROJECT_CONFIGURATION_REQUIRED', 409));
  });

  it('lista de la revisión más reciente a la más antigua dentro de la ventana', async () => {
    for (let index = 0; index < 3; index += 1) {
      await repository.create(owner.id, project.id, RULESET);
    }
    const page = await repository.findAllByProject(project.id, {
      limit: 2,
      offset: 1,
    });
    expect(page.map((version) => version.revision)).toEqual([2, 1]);
    expect(await repository.findByRevision(project.id, 9)).toBeNull();
  });

  it('rechaza en la base una revisión no positiva o un JSON que no es arreglo', async () => {
    const insert = (revision: number, rules: string) =>
      database.connection.pool.query(
        `INSERT INTO estadistica_forms.ruleset_versions
           (id, project_id, revision, mapping, rules, created_at)
         VALUES (gen_random_uuid(), $1, $2, '[]', $3::jsonb, 'x')`,
        [project.id, revision, rules],
      );
    await expect(insert(0, '[]')).rejects.toMatchObject({ code: '23514' });
    await expect(insert(1, '{"0":{}}')).rejects.toMatchObject({
      code: '23514',
    });
  });

  it('no entrega una versión guardada con forma inválida', async () => {
    const saved = await repository.create(owner.id, project.id, RULESET);
    await database.connection.pool.query(
      `UPDATE estadistica_forms.ruleset_versions
       SET rules = '[{"type":"desconocida"}]' WHERE id = $1`,
      [saved.id],
    );
    await expect(repository.findByRevision(project.id, 1)).rejects.toThrow(
      'forma inválida',
    );
  });

  it('borra las versiones al borrar el proyecto', async () => {
    await repository.create(owner.id, project.id, RULESET);
    await new CatalogImportRepository(prisma).deleteProject(
      owner.id,
      project.id,
    );
    const { rows } = await database.connection.pool.query(
      'SELECT count(*)::int AS count FROM estadistica_forms.ruleset_versions',
    );
    expect(rows[0].count).toBe(0);
  });
});
