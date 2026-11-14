import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DescopeService } from '../../../src/auth/descope.service.js';
import { configureHttp } from '../../../src/configure-http.js';
import { publicError } from '../../../src/common/http/public-error.js';
import { POSTGRESQL_CONNECTION } from '../../../src/database/postgresql.connection.js';
import { OrganizationsRepository } from '../../../src/organizations/organizations.repository.js';
import { ProjectsModule } from '../../../src/projects/projects.module.js';
import { ProjectsRepository } from '../../../src/projects/projects.repository.js';
import { UsersService } from '../../../src/users/users.service.js';
import { WorksheetsModule } from '../../../src/worksheets/worksheets.module.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';

const UNKNOWN_ID = '00000000-0000-4000-8000-00000000beef';
const firstPage = { limit: 20, offset: 0, hasMore: false };
const columns = [
  { name: 'SKU', type: 'text', required: true },
  { name: 'Precio', type: 'decimal' },
];

describe('Hojas vacías por HTTP, con guard y persistencia reales', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let base: string;
  let bobId: string;
  let organizationId: string;
  const validateSession = jest.fn<DescopeService['validateSession']>();

  beforeAll(async () => {
    database = await createTestDatabase();
    const module = await Test.createTestingModule({
      imports: [ProjectsModule, WorksheetsModule],
    })
      .overrideProvider(POSTGRESQL_CONNECTION)
      .useValue(database.connection)
      .overrideProvider(DescopeService)
      .useValue({ validateSession })
      .compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
  });
  beforeEach(async () => {
    validateSession.mockReset().mockImplementation(async (token) => {
      const identity =
        token === 'alice-session'
          ? alice
          : token === 'bob-session'
            ? bob
            : null;
      if (!identity) throw new Error('Sesión de prueba inválida');
      return {
        jwt: token,
        token: {
          sub: identity.subject,
          iss: identity.issuer,
          email: identity.email,
        },
      };
    });
    await database.connection.pool.query(
      'TRUNCATE estadistica_forms.app_users CASCADE',
    );
    const users = app.get(UsersService);
    const owner = await users.provision(alice);
    bobId = (await users.provision(bob)).id;

    const project = await app
      .get(ProjectsRepository)
      .create(owner.id, 'Tienda', projectInput);
    const [organization] = await app
      .get(OrganizationsRepository)
      .findMemberships(owner.id, { limit: 1, offset: 0 });
    organizationId = organization.id;
    base = `/api/v1/organizations/${organizationId}/projects/${project.id}`;
  });
  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await database?.close();
    }
  });

  function call(session: string, method: 'get' | 'post', path: string) {
    return request(app.getHttpServer())
      [method](`${base}${path}`)
      .auth(session, { type: 'bearer' });
  }

  async function createWorkbook() {
    const { body } = await call('alice-session', 'post', '/workbooks')
      .send({ name: ' Libro ' })
      .expect(201);
    return body.workbook;
  }

  it('crea un libro y una hoja vacía, la lista y lee sus metadatos', async () => {
    const workbook = await createWorkbook();
    expect(workbook).toEqual({
      id: expect.any(String),
      projectId: expect.any(String),
      name: 'Libro',
      createdAt: expect.any(String),
      archivedAt: null,
    });

    const created = await call(
      'alice-session',
      'post',
      `/workbooks/${workbook.id}/worksheets`,
    )
      .send({ name: 'Inventario', columns })
      .expect(201);
    expect(created.body.capabilities).toEqual({ write: true, approve: true });
    expect(
      created.body.worksheet.columns.map(
        ({ name, required }: { name: string; required: boolean }) => [
          name,
          required,
        ],
      ),
    ).toEqual([
      ['SKU', true],
      ['Precio', false],
    ]);

    await call('alice-session', 'get', '/workbooks').expect(200, {
      workbooks: [workbook],
      page: firstPage,
    });
    const { columns: _columns, ...summary } = created.body.worksheet;
    await call(
      'alice-session',
      'get',
      `/workbooks/${workbook.id}/worksheets`,
    ).expect(200, { worksheets: [summary], page: firstPage });
    await call(
      'alice-session',
      'get',
      `/worksheets/${created.body.worksheet.id}`,
    ).expect(200, created.body);
  });

  it('un viewer lee con capabilities sin escritura y recibe 403 al crear', async () => {
    const workbook = await createWorkbook();
    const { body } = await call(
      'alice-session',
      'post',
      `/workbooks/${workbook.id}/worksheets`,
    )
      .send({ name: 'Inventario', columns: [] })
      .expect(201);
    await database.connection.pool.query(
      `INSERT INTO estadistica_forms.organization_members
         (organization_id, user_id, role, created_at)
       VALUES ($1, $2, 'viewer', '2026-11-03T12:00:00.000Z')`,
      [organizationId, bobId],
    );

    await call('bob-session', 'get', `/worksheets/${body.worksheet.id}`)
      .expect(200)
      .expect(({ body: read }) =>
        expect(read.capabilities).toEqual({ write: false, approve: false }),
      );
    await call('bob-session', 'post', '/workbooks')
      .send({ name: 'Otro' })
      .expect(403)
      .expect(({ body: error }) =>
        expect(error).toMatchObject(publicError('FORBIDDEN')),
      );
  });

  it('fuera de la organización todo responde 404', async () => {
    const workbook = await createWorkbook();

    await call('bob-session', 'get', '/workbooks')
      .expect(404)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('PROJECT_NOT_FOUND')),
      );
    await call('bob-session', 'post', '/workbooks')
      .send({ name: 'Intrusión' })
      .expect(404);
    await call('alice-session', 'get', `/workbooks/${UNKNOWN_ID}/worksheets`)
      .expect(404)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('WORKBOOK_NOT_FOUND')),
      );
    await call('alice-session', 'get', `/worksheets/${UNKNOWN_ID}`)
      .expect(404)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('WORKSHEET_NOT_FOUND')),
      );
    await request(app.getHttpServer())
      .get(
        `/api/v1/organizations/${UNKNOWN_ID}/projects/${workbook.projectId}/workbooks`,
      )
      .auth('alice-session', { type: 'bearer' })
      .expect(404);
  });

  it('valida nombre, tipos y columnas repetidas; sin sesión, 401', async () => {
    const workbook = await createWorkbook();
    const path = `/workbooks/${workbook.id}/worksheets`;

    await call('alice-session', 'post', path)
      .send({
        name: 'Hoja',
        columns: [...columns, { name: ' sku ', type: 'integer' }],
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body).toMatchObject({ code: 'VALIDATION_FAILED' });
        expect(body.issues).toEqual([
          expect.objectContaining({
            field: 'columns.2.name',
            code: 'WORKSHEET_COLUMN_DUPLICATE',
          }),
        ]);
      });
    for (const invalid of [
      { name: '   ', columns: [] },
      { name: 'Hoja', columns: [{ name: 'X', type: 'formula' }] },
      { name: 'Hoja', columns: [{ name: '', type: 'text' }] },
      { name: 'Hoja' },
      {
        name: 'Hoja',
        columns: Array.from({ length: 201 }, (_, index) => ({
          name: `c${index}`,
          type: 'text',
        })),
      },
    ]) {
      await call('alice-session', 'post', path).send(invalid).expect(400);
    }
    await request(app.getHttpServer()).get(`${base}/workbooks`).expect(401);
  });
});
