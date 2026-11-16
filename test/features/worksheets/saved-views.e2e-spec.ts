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
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { AuthenticatedIdentity } from '../../../src/auth/authenticated-request.js';
import { DescopeService } from '../../../src/auth/descope.service.js';
import { publicError } from '../../../src/common/http/public-error.js';
import { configureHttp } from '../../../src/configure-http.js';
import { POSTGRESQL_CONNECTION } from '../../../src/database/postgresql.connection.js';
import type { OrganizationRole } from '../../../src/organizations/organization-roles.js';
import { OrganizationsRepository } from '../../../src/organizations/organizations.repository.js';
import { ProjectsModule } from '../../../src/projects/projects.module.js';
import { ProjectsRepository } from '../../../src/projects/projects.repository.js';
import { UsersService } from '../../../src/users/users.service.js';
import { WorksheetsModule } from '../../../src/worksheets/worksheets.module.js';
import type { Worksheet } from '../../../src/worksheets/worksheets.types.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';
import {
  columnIdsOf,
  FIXTURE_COLUMNS,
  seedTwoRevisions,
  type FixtureColumnIds,
} from './support/row-fixtures.js';

const carol: AuthenticatedIdentity = {
  ...alice,
  subject: 'carol',
  email: 'carol@example.test',
};
const SESSIONS: Record<string, AuthenticatedIdentity> = {
  'alice-session': alice,
  'bob-session': bob,
  'carol-session': carol,
};
type Session = 'alice-session' | 'bob-session' | 'carol-session';
type Method = 'get' | 'post' | 'put' | 'delete';

type RowsBody = {
  items: { rowId: string; values: Record<string, unknown> }[];
  nextCursor: string | null;
};

/**
 * H4 (plan 02 de cierre, P10): vistas guardadas. La hoja tiene cuatro filas
 * vivas (A, B, D y E de `seedTwoRevisions`). Alice es la dueña; Bob entra con
 * el rol de cada prueba; Carol es de otra organización.
 */
describe('Vistas guardadas por HTTP', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let base: string;
  let organizationId: string;
  let bobId: string;
  let worksheet: Worksheet;
  let col: FixtureColumnIds;
  const validateSession = jest.fn<DescopeService['validateSession']>();

  const pool = () => database.connection.pool;

  function send(
    method: Method,
    path: string,
    session: Session = 'alice-session',
  ) {
    return request(app.getHttpServer())
      [method](`${base}${path}`)
      .auth(session, { type: 'bearer' });
  }

  /** Los activos, del precio más alto al más bajo, solo con SKU y precio. */
  const activeByPrice = () => ({
    filter: { column: col.active, op: 'equals', value: true },
    sort: [{ columnId: col.price, direction: 'desc' }],
    columns: [col.sku, col.price],
  });

  async function saveView(
    name: string,
    visibility: 'personal' | 'team',
    session: Session = 'alice-session',
    query: object = activeByPrice(),
  ) {
    const { body } = await send(
      'post',
      `/worksheets/${worksheet.id}/saved-views`,
      session,
    )
      .send({ name, visibility, query })
      .expect(201);
    return body.savedView as { id: string; name: string; canEdit: boolean };
  }

  function rows(body: object, session: Session = 'alice-session') {
    return send('post', `/worksheets/${worksheet.id}/rows/query`, session).send(
      body,
    );
  }

  const skus = (body: RowsBody) => body.items.map((row) => row.values[col.sku]);

  async function setBobRole(role: OrganizationRole) {
    await pool().query(
      `INSERT INTO estadistica_forms.organization_members
         (organization_id, user_id, role, created_at)
       VALUES ($1, $2, $3, '2026-11-14T09:00:00.000Z')
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = $3`,
      [organizationId, bobId, role],
    );
  }

  const viewNames = async (session: Session) =>
    (
      await send(
        'get',
        `/worksheets/${worksheet.id}/saved-views`,
        session,
      ).expect(200)
    ).body.savedViews
      .map((view: { name: string }) => view.name)
      .sort();

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
      const identity = SESSIONS[token];
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
    await pool().query('TRUNCATE estadistica_forms.app_users CASCADE');
    const users = app.get(UsersService);
    const owner = await users.provision(alice);
    bobId = (await users.provision(bob)).id;
    await users.provision(carol);
    const project = await app
      .get(ProjectsRepository)
      .create(owner.id, 'Tienda', projectInput);
    const [organization] = await app
      .get(OrganizationsRepository)
      .findMemberships(owner.id, { limit: 1, offset: 0 });
    organizationId = organization.id;
    base = `/api/v1/organizations/${organizationId}/projects/${project.id}`;

    const { body: workbook } = await send('post', '/workbooks')
      .send({ name: 'Libro' })
      .expect(201);
    const { body } = await send(
      'post',
      `/workbooks/${workbook.workbook.id}/worksheets`,
    )
      .send({ name: 'Inventario', columns: FIXTURE_COLUMNS })
      .expect(201);
    worksheet = body.worksheet;
    col = columnIdsOf(worksheet);
    await seedTwoRevisions(pool(), worksheet, organizationId, owner.id);
  });
  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await database?.close();
    }
  });

  describe('guardar y leer', () => {
    it('guarda la vista con su consulta y la lista', async () => {
      const saved = await saveView(' Activos por precio ', 'personal');

      expect(saved).toEqual({
        id: expect.any(String),
        worksheetId: worksheet.id,
        ownerId: expect.any(String),
        name: 'Activos por precio',
        visibility: 'personal',
        query: activeByPrice(),
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        canEdit: true,
      });
      const { body } = await send(
        'get',
        `/worksheets/${worksheet.id}/saved-views`,
      ).expect(200);
      expect(body).toEqual({
        savedViews: [saved],
        page: { limit: 20, offset: 0, hasMore: false },
      });
      const { body: one } = await send(
        'get',
        `/saved-views/${saved.id}`,
      ).expect(200);
      expect(one.savedView).toEqual(saved);
    });

    it('valida la consulta contra las columnas de la hoja, como rows/query', async () => {
      const { body } = await send(
        'post',
        `/worksheets/${worksheet.id}/saved-views`,
      )
        .send({
          name: 'Mala',
          visibility: 'personal',
          query: {
            filter: { column: col.price, op: 'contains', value: '1' },
            sort: [{ columnId: randomUUID(), direction: 'asc' }],
          },
        })
        .expect(400);

      expect(body.code).toBe('VALIDATION_FAILED');
      const fields = body.issues.map(({ field }: { field: string }) => field);
      expect(fields).toContain('query.filter.op');
      expect(
        fields.some((field: string) => field.startsWith('query.sort')),
      ).toBe(true);
      for (const invalid of [
        {},
        { name: 'Sin consulta', visibility: 'personal' },
        { name: 'X', visibility: 'publica', query: {} },
        { name: '', visibility: 'personal', query: {} },
        { name: 'X', visibility: 'personal', query: { otro: 1 } },
      ]) {
        await send('post', `/worksheets/${worksheet.id}/saved-views`)
          .send(invalid)
          .expect(400);
      }
    });

    it('el nombre es único entre las vistas de cada persona', async () => {
      await setBobRole('editor');
      await saveView('Mía', 'personal');

      await send('post', `/worksheets/${worksheet.id}/saved-views`)
        .send({ name: 'MÍA', visibility: 'team', query: {} })
        .expect(409)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('SAVED_VIEW_NAME_TAKEN')),
        );
      await saveView('Mía', 'personal', 'bob-session');
    });
  });

  describe('leer filas con una vista', () => {
    it('da las mismas filas que mandar la consulta', async () => {
      const view = await saveView('Activos', 'personal');

      const { body: viaView } = await rows({ viewId: view.id }).expect(200);
      const { body: direct } = await rows(activeByPrice()).expect(200);

      expect(viaView).toEqual(direct);
      // Activos en la revisión actual: A (10.50) y E no tiene «Activo»; B es false.
      expect(skus(viaView)).toEqual(['A-001']);
      expect(Object.keys(viaView.items[0].values).sort()).toEqual(
        [col.sku, col.price].sort(),
      );
    });

    it('el cursor sigue con la vista y la revisión', async () => {
      const view = await saveView('Por SKU', 'personal', 'alice-session', {
        sort: [{ columnId: col.sku, direction: 'asc' }],
      });

      const { body: first } = await rows({ viewId: view.id, limit: 2 }).expect(
        200,
      );
      const { body: second } = await rows({
        viewId: view.id,
        limit: 2,
        cursor: first.nextCursor,
      }).expect(200);

      expect([...skus(first), ...skus(second)]).toEqual([
        '50%_off',
        'A-001',
        'B-002',
        'E-005',
      ]);
      expect(second.nextCursor).toBeNull();
      // El cursor de la vista no vale para otra consulta.
      await rows({ cursor: first.nextCursor, limit: 2 }).expect(400);
    });

    it('con viewId no se manda la consulta; una vista de otra hoja o inexistente da 404', async () => {
      const view = await saveView('Activos', 'personal');

      const { body } = await rows({
        viewId: view.id,
        filter: { column: col.sku, op: 'is_null' },
        columns: [col.sku],
      }).expect(400);
      expect(body.code).toBe('VALIDATION_FAILED');
      expect(body.issues.map(({ field }: { field: string }) => field)).toEqual([
        'filter',
        'columns',
      ]);

      const { body: other } = await send(
        'post',
        `/workbooks/${worksheet.workbookId}/worksheets`,
      )
        .send({ name: 'Otra', columns: [{ name: 'SKU', type: 'text' }] })
        .expect(201);
      for (const viewId of [view.id, randomUUID()]) {
        await send('post', `/worksheets/${other.worksheet.id}/rows/query`)
          .send(viewId === view.id ? { viewId } : { viewId })
          .expect(404)
          .expect(({ body: error }) =>
            expect(error).toMatchObject(publicError('SAVED_VIEW_NOT_FOUND')),
          );
      }
      await rows({ viewId: randomUUID() }).expect(404);
      await rows({ viewId: 'no-es-uuid' }).expect(400);
    });

    it('si la hoja perdió una columna de la vista, leer lo dice', async () => {
      const view = await saveView('Activos', 'personal');
      // Como si la columna se hubiera borrado después de guardar la vista.
      await pool().query(
        `UPDATE estadistica_forms.worksheet_saved_views
         SET query = jsonb_set(query, '{columns,1}', to_jsonb($2::text))
         WHERE id = $1`,
        [view.id, randomUUID()],
      );

      const { body } = await rows({ viewId: view.id }).expect(400);

      expect(body.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('quién ve qué', () => {
    it('una vista personal solo la ve su autor; una del equipo, todos', async () => {
      await setBobRole('viewer');
      const personal = await saveView('Solo mía', 'personal');
      const team = await saveView('Para todos', 'team');

      expect(await viewNames('alice-session')).toEqual([
        'Para todos',
        'Solo mía',
      ]);
      expect(await viewNames('bob-session')).toEqual(['Para todos']);
      await send('get', `/saved-views/${personal.id}`, 'bob-session')
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('SAVED_VIEW_NOT_FOUND')),
        );
      await rows({ viewId: personal.id }, 'bob-session').expect(404);
      const { body } = await send(
        'get',
        `/saved-views/${team.id}`,
        'bob-session',
      ).expect(200);
      expect(body.savedView.canEdit).toBe(false);
      await rows({ viewId: team.id }, 'bob-session').expect(200);
    });

    it('un Viewer guarda vistas personales, no del equipo', async () => {
      await setBobRole('viewer');

      await saveView('De Bob', 'personal', 'bob-session');
      await send(
        'post',
        `/worksheets/${worksheet.id}/saved-views`,
        'bob-session',
      )
        .send({ name: 'Del equipo', visibility: 'team', query: {} })
        .expect(403)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('FORBIDDEN')),
        );
    });
  });

  describe('cambiar y borrar', () => {
    const replacement = () => ({
      name: 'Todos por SKU',
      visibility: 'team',
      query: { sort: [{ columnId: col.sku, direction: 'asc' }] },
    });

    it('su autor la cambia entera y la borra', async () => {
      const view = await saveView('Activos', 'personal');

      const { body } = await send('put', `/saved-views/${view.id}`)
        .send(replacement())
        .expect(200);
      expect(body.savedView).toMatchObject({
        id: view.id,
        ...replacement(),
        canEdit: true,
      });
      const { body: read } = await rows({ viewId: view.id }).expect(200);
      expect(skus(read)).toHaveLength(4);

      await send('delete', `/saved-views/${view.id}`).expect(204);
      await send('get', `/saved-views/${view.id}`).expect(404);
      await send('delete', `/saved-views/${view.id}`).expect(404);
    });

    it('una del equipo de otro: un Editor no puede tocarla y un Manager sí', async () => {
      const team = await saveView('Para todos', 'team');

      await setBobRole('editor');
      await send('put', `/saved-views/${team.id}`, 'bob-session')
        .send(replacement())
        .expect(403);
      await send('delete', `/saved-views/${team.id}`, 'bob-session').expect(
        403,
      );

      await setBobRole('manager');
      const { body } = await send(
        'get',
        `/saved-views/${team.id}`,
        'bob-session',
      ).expect(200);
      expect(body.savedView.canEdit).toBe(true);
      const { body: replaced } = await send(
        'put',
        `/saved-views/${team.id}`,
        'bob-session',
      )
        .send(replacement())
        .expect(200);
      // Sigue siendo de Alice: el nombre se comprueba entre sus vistas.
      expect(replaced.savedView.ownerId).not.toBe(bobId);
      await send('delete', `/saved-views/${team.id}`, 'bob-session').expect(
        204,
      );
    });

    it('la personal de otro no existe para un Manager', async () => {
      const personal = await saveView('Solo mía', 'personal');
      await setBobRole('manager');

      await send('put', `/saved-views/${personal.id}`, 'bob-session')
        .send(replacement())
        .expect(404);
      await send('delete', `/saved-views/${personal.id}`, 'bob-session').expect(
        404,
      );
    });

    it('cambiarla valida la consulta y no repite el nombre de otra propia', async () => {
      const view = await saveView('Activos', 'personal');
      await saveView('Otra', 'personal');

      await send('put', `/saved-views/${view.id}`)
        .send({ ...replacement(), name: 'otra' })
        .expect(409);
      await send('put', `/saved-views/${view.id}`)
        .send({
          ...replacement(),
          query: { columns: [randomUUID()] },
        })
        .expect(400)
        .expect(({ body }) => expect(body.code).toBe('VALIDATION_FAILED'));
      await send('put', `/saved-views/${view.id}`)
        .send({ ...replacement(), name: 'ACTIVOS' })
        .expect(200);
    });
  });

  describe('acceso', () => {
    it('en una hoja archivada se guardan y usan vistas: no cambian valores', async () => {
      await send('post', `/worksheets/${worksheet.id}/archive`).expect(200);

      const view = await saveView('Archivo', 'personal');
      await rows({ viewId: view.id }).expect(200);
    });

    it('otra organización recibe 404, sin sesión 401 y una hoja que no existe 404', async () => {
      const team = await saveView('Para todos', 'team');

      await send(
        'get',
        `/worksheets/${worksheet.id}/saved-views`,
        'carol-session',
      )
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('PROJECT_NOT_FOUND')),
        );
      for (const [method, path] of [
        ['get', `/saved-views/${team.id}`],
        ['put', `/saved-views/${team.id}`],
        ['delete', `/saved-views/${team.id}`],
        ['post', `/worksheets/${worksheet.id}/saved-views`],
      ] as const) {
        await send(method, path, 'carol-session')
          .send({ name: 'De Carol', visibility: 'personal', query: {} })
          .expect(404);
        await request(app.getHttpServer())
          [method](`${base}${path}`)
          .send({ name: 'X', visibility: 'personal', query: {} })
          .expect(401);
      }
      await send('get', `/worksheets/${randomUUID()}/saved-views`)
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('WORKSHEET_NOT_FOUND')),
        );
      await send('post', `/worksheets/${randomUUID()}/saved-views`)
        .send({ name: 'X', visibility: 'personal', query: {} })
        .expect(404);
    });
  });
});
