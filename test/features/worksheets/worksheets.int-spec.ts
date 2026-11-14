import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import { CatalogImportRepository } from '../../../src/catalog-import/catalog-import.repository.js';
import { PrismaService } from '../../../src/database/prisma.service.js';
import type { OrganizationRole } from '../../../src/organizations/organization-roles.js';
import { OrganizationsRepository } from '../../../src/organizations/organizations.repository.js';
import { ProjectsRepository } from '../../../src/projects/projects.repository.js';
import {
  UsersRepository,
  type LocalUser,
} from '../../../src/users/users.repository.js';
import { newWorksheet } from './support/new-worksheet-fixture.js';
import { WorksheetsRepository } from '../../../src/worksheets/worksheets.repository.js';
import type { ProjectScope } from '../../../src/worksheets/worksheets.types.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';

const page = { limit: 100, offset: 0 };
const columns = [
  { name: 'SKU', type: 'text' as const, required: true },
  { name: 'Precio', type: 'decimal' as const, required: false },
];

function rejectedWith(code: string) {
  return { response: expect.objectContaining({ code }) };
}

describe('Libros y hojas vacías con PostgreSQL temporal', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let prisma: PrismaService;
  let worksheets: WorksheetsRepository;
  let owner: LocalUser;
  let other: LocalUser;
  let scope: ProjectScope;
  let otherScope: ProjectScope;

  beforeAll(async () => {
    database = await createTestDatabase();
    prisma = new PrismaService(database.connection);
    await prisma.onModuleInit();
    worksheets = new WorksheetsRepository(prisma);
  });
  beforeEach(async () => {
    await database.connection.pool.query(
      'TRUNCATE estadistica_forms.app_users CASCADE',
    );
    const users = new UsersRepository(prisma);
    owner = await users.provision(alice);
    other = await users.provision(bob);
    scope = await projectScopeOf(owner);
    otherScope = await projectScopeOf(other);
  });
  afterAll(async () => {
    try {
      await prisma?.onModuleDestroy();
    } finally {
      await database?.close();
    }
  });

  async function projectScopeOf(user: LocalUser): Promise<ProjectScope> {
    const project = await new ProjectsRepository(prisma).create(
      user.id,
      'Tienda',
      projectInput,
    );
    const [organization] = await new OrganizationsRepository(
      prisma,
    ).findMemberships(user.id, page);
    return { organizationId: organization.id, projectId: project.id };
  }

  async function setRole(userId: string, role: OrganizationRole) {
    await database.connection.pool.query(
      `INSERT INTO estadistica_forms.organization_members
         (organization_id, user_id, role, created_at)
       VALUES ($1, $2, $3, '2026-11-03T12:00:00.000Z')
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = excluded.role`,
      [scope.organizationId, userId, role],
    );
  }

  async function count(table: string) {
    const { rows } = await database.connection.pool.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM estadistica_forms.${table}`,
    );
    return rows[0].total;
  }

  it('crea la hoja con sus columnas, una revisión 1 vacía y el head apuntando a ella', async () => {
    const workbook = await worksheets.createWorkbook(owner.id, scope, 'Libro');
    const { worksheet } = await worksheets.createWorksheet(
      owner.id,
      scope,
      workbook.id,
      newWorksheet('Inventario', columns),
    );

    expect(worksheet).toEqual({
      id: expect.any(String),
      workbookId: workbook.id,
      name: 'Inventario',
      mode: 'free',
      schemaVersion: 1,
      generation: 1,
      headRevision: {
        id: expect.any(String),
        sequence: 1,
        rowCount: 0,
        createdAt: expect.any(String),
      },
      createdAt: expect.any(String),
      archivedAt: null,
      workbookArchivedAt: null,
      duplicatedFrom: null,
      openedFromCatalog: null,
      columns: [
        {
          id: expect.any(String),
          name: 'SKU',
          type: 'text',
          position: 0,
          required: true,
        },
        {
          id: expect.any(String),
          name: 'Precio',
          type: 'decimal',
          position: 1,
          required: false,
        },
      ],
    });
    expect(
      await worksheets.findWorksheet(owner.id, scope, worksheet.id),
    ).toEqual(worksheet);
  });

  it('si una inserción falla no queda nada: ni hoja sin revisión ni columnas sueltas', async () => {
    const workbook = await worksheets.createWorkbook(owner.id, scope, 'Libro');
    const valid = newWorksheet('Rota', columns);
    // Dos columnas en la misma posición: la restricción única de la base falla
    // en mitad de la transacción, después de insertar la hoja.
    const broken = {
      ...valid,
      columns: valid.columns.map((column) => ({ ...column, position: 0 })),
    };

    await expect(
      worksheets.createWorksheet(owner.id, scope, workbook.id, broken),
    ).rejects.toThrow();
    expect(await count('worksheets')).toBe(0);
    expect(await count('worksheet_column_versions')).toBe(0);
    expect(await count('worksheet_revisions')).toBe(0);
  });

  it('nombres repetidos dan 409 sin distinguir mayúsculas', async () => {
    const workbook = await worksheets.createWorkbook(owner.id, scope, 'Libro');
    await worksheets.createWorksheet(
      owner.id,
      scope,
      workbook.id,
      newWorksheet('Inventario', []),
    );

    await expect(
      worksheets.createWorkbook(owner.id, scope, ' libro '),
    ).rejects.toMatchObject(rejectedWith('WORKBOOK_NAME_TAKEN'));
    await expect(
      worksheets.createWorksheet(
        owner.id,
        scope,
        workbook.id,
        newWorksheet('INVENTARIO', []),
      ),
    ).rejects.toMatchObject(rejectedWith('WORKSHEET_NAME_TAKEN'));
  });

  it('otra organización no ve ni escribe nada, aunque conozca los IDs', async () => {
    const workbook = await worksheets.createWorkbook(owner.id, scope, 'Libro');
    const { worksheet } = await worksheets.createWorksheet(
      owner.id,
      scope,
      workbook.id,
      newWorksheet('Inventario', columns),
    );
    const mixedScope = {
      organizationId: otherScope.organizationId,
      projectId: scope.projectId,
    };

    expect(await worksheets.findAccess(other.id, scope)).toBeNull();
    expect(await worksheets.findAccess(owner.id, mixedScope)).toBeNull();
    expect(await worksheets.findWorkbooks(other.id, scope, page)).toEqual([]);
    expect(
      await worksheets.findWorksheet(other.id, scope, worksheet.id),
    ).toBeNull();
    expect(
      await worksheets.findWorksheet(other.id, otherScope, worksheet.id),
    ).toBeNull();
    await expect(
      worksheets.createWorkbook(other.id, scope, 'Intrusión'),
    ).rejects.toMatchObject(rejectedWith('PROJECT_NOT_FOUND'));
    await expect(
      worksheets.createWorksheet(
        other.id,
        otherScope,
        workbook.id,
        newWorksheet('Intrusión', []),
      ),
    ).rejects.toMatchObject(rejectedWith('WORKBOOK_NOT_FOUND'));
  });

  it('un viewer lee pero no crea; con la organización archivada nadie crea', async () => {
    await worksheets.createWorkbook(owner.id, scope, 'Libro');
    await setRole(other.id, 'viewer');

    expect(await worksheets.findWorkbooks(other.id, scope, page)).toHaveLength(
      1,
    );
    await expect(
      worksheets.createWorkbook(other.id, scope, 'Otro'),
    ).rejects.toMatchObject(rejectedWith('FORBIDDEN'));

    const organizations = new OrganizationsRepository(prisma);
    const team = await organizations.createTeam(owner.id, 'Equipo');
    const teamScope = {
      organizationId: team.id,
      projectId: '00000000-0000-4000-8000-0000000000c1',
    };
    await database.connection.pool.query(
      `INSERT INTO estadistica_forms.projects
         (id, name, owner_id, organization_id, created_at)
       VALUES ($1, 'De equipo', $2, $3, '2026-11-03T12:00:00.000Z')`,
      [teamScope.projectId, owner.id, team.id],
    );
    await organizations.setArchived(owner.id, team.id, true);

    await expect(
      worksheets.createWorkbook(owner.id, teamScope, 'Otro'),
    ).rejects.toMatchObject(rejectedWith('ORGANIZATION_ARCHIVED'));
    expect(await worksheets.findAccess(owner.id, teamScope)).toEqual({
      role: 'owner',
      isArchived: true,
    });
  });

  it('borrar un proyecto con libros responde 409 y conserva libros y revisiones', async () => {
    const workbook = await worksheets.createWorkbook(owner.id, scope, 'Libro');
    await worksheets.createWorksheet(
      owner.id,
      scope,
      workbook.id,
      newWorksheet('Inventario', columns),
    );

    await expect(
      new CatalogImportRepository(prisma).deleteProject(
        owner.id,
        scope.projectId,
      ),
    ).rejects.toMatchObject(rejectedWith('PROJECT_HAS_WORKBOOKS'));
    expect(await count('workbooks')).toBe(1);
    expect(await count('worksheet_revisions')).toBe(1);
  });

  it('un proyecto sin libros se sigue borrando como antes', async () => {
    await new CatalogImportRepository(prisma).deleteProject(
      owner.id,
      scope.projectId,
    );

    expect(await worksheets.findAccess(owner.id, scope)).toBeNull();
  });
});
