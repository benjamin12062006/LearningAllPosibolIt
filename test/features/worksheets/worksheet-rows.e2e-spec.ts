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
import type { Worksheet } from '../../../src/worksheets/worksheets.types.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';
import {
  columnIdsOf,
  FIXTURE_COLUMNS,
  ROW_IDS,
  SECOND_REVISION_ID,
  seedTwoRevisions,
} from './support/row-fixtures.js';

const THIRD_REVISION_ID = '00000000-0000-4000-8000-0000000003a3';

describe('Consulta de filas por HTTP, con guard y persistencia reales', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let base: string;
  let worksheet: Worksheet;
  let organizationId: string;
  let ownerId: string;
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
    ownerId = (await users.provision(alice)).id;
    await users.provision(bob);

    const project = await app
      .get(ProjectsRepository)
      .create(ownerId, 'Tienda', projectInput);
    const [organization] = await app
      .get(OrganizationsRepository)
      .findMemberships(ownerId, { limit: 1, offset: 0 });
    organizationId = organization.id;
    base = `/api/v1/organizations/${organizationId}/projects/${project.id}`;

    const { body: created } = await request(app.getHttpServer())
      .post(`${base}/workbooks`)
      .auth('alice-session', { type: 'bearer' })
      .send({ name: 'Libro' })
      .expect(201);
    const { body } = await request(app.getHttpServer())
      .post(`${base}/workbooks/${created.workbook.id}/worksheets`)
      .auth('alice-session', { type: 'bearer' })
      .send({ name: 'Inventario', columns: FIXTURE_COLUMNS })
      .expect(201);
    worksheet = body.worksheet;
    await seedTwoRevisions(
      database.connection.pool,
      worksheet,
      organizationId,
      ownerId,
    );
  });
  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await database?.close();
    }
  });

  function query(body: object, session = 'alice-session') {
    return request(app.getHttpServer())
      .post(`${base}/worksheets/${worksheet.id}/rows/query`)
      .auth(session, { type: 'bearer' })
      .send(body);
  }

  it('sin opciones lee la revisión actual con todas las columnas y null explícito', async () => {
    const col = columnIdsOf(worksheet);
    const { body } = await query({}).expect(200);

    expect(body).toMatchObject({
      revisionId: SECOND_REVISION_ID,
      schemaVersion: 1,
      nextCursor: null,
    });
    expect(body.items.map(({ rowId }: { rowId: string }) => rowId)).toEqual([
      ROW_IDS.a,
      ROW_IDS.b,
      ROW_IDS.d,
      ROW_IDS.e,
    ]);
    expect(body.items[3]).toEqual({
      rowId: ROW_IDS.e,
      values: {
        [col.sku]: 'E-005',
        [col.price]: '1.5',
        [col.quantity]: null,
        [col.since]: null,
        [col.active]: null,
      },
      problems: [],
    });
  });

  it('pagina con cursor sin repetir ni perder filas, y el cursor sigue en su revisión aunque cambie el head', async () => {
    const pageOne = await query({ limit: 3 }).expect(200);
    expect(pageOne.body.items).toHaveLength(3);
    expect(pageOne.body.nextCursor).toEqual(expect.any(String));

    // Otra revisión pasa a ser la actual entre las dos páginas.
    await database.connection.pool.query(
      `INSERT INTO estadistica_forms.worksheet_revisions
         (id, organization_id, worksheet_id, sequence, schema_version, source,
          row_count, created_by, created_at)
       VALUES ($1, $2, $3, 3, 1, 'changeset', 4, $4, '2026-11-04T13:00:00.000Z')`,
      [THIRD_REVISION_ID, organizationId, worksheet.id, ownerId],
    );
    await database.connection.pool.query(
      `UPDATE estadistica_forms.worksheets SET head_revision_id = $2, generation = 3
       WHERE id = $1`,
      [worksheet.id, THIRD_REVISION_ID],
    );

    const pageTwo = await query({
      limit: 3,
      cursor: pageOne.body.nextCursor,
    }).expect(200);
    expect(pageTwo.body.revisionId).toBe(SECOND_REVISION_ID);
    expect(pageTwo.body.nextCursor).toBeNull();
    const all = [...pageOne.body.items, ...pageTwo.body.items].map(
      ({ rowId }: { rowId: string }) => rowId,
    );
    expect(all).toEqual([ROW_IDS.a, ROW_IDS.b, ROW_IDS.d, ROW_IDS.e]);

    await query({})
      .expect(200)
      .expect(({ body }) => expect(body.revisionId).toBe(THIRD_REVISION_ID));
  });

  it('un cursor no sirve con otro filtro, otra revisión o si está manipulado', async () => {
    const col = columnIdsOf(worksheet);
    const { body } = await query({ limit: 1 }).expect(200);

    for (const misuse of [
      { cursor: body.nextCursor, filter: { column: col.sku, op: 'is_null' } },
      { cursor: body.nextCursor, revisionId: worksheet.headRevision.id },
      { cursor: 'manipulado' },
    ]) {
      await query(misuse)
        .expect(400)
        .expect(({ body: error }) =>
          expect(error).toMatchObject(publicError('WORKSHEET_CURSOR_INVALID')),
        );
    }
  });

  it('lee una revisión antigua por su ID y rechaza una revisión ajena', async () => {
    await query({ revisionId: worksheet.headRevision.id })
      .expect(200)
      .expect(({ body }) =>
        expect(body.items.map(({ rowId }: { rowId: string }) => rowId)).toEqual(
          [ROW_IDS.a, ROW_IDS.b, ROW_IDS.c, ROW_IDS.d],
        ),
      );
    await query({ revisionId: '00000000-0000-4000-8000-00000000beef' })
      .expect(404)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('WORKSHEET_REVISION_NOT_FOUND')),
      );
  });

  it('un filtro inválido responde 400 con el campo de cada problema', async () => {
    const col = columnIdsOf(worksheet);
    const { body } = await query({
      filter: {
        and: [
          { column: col.price, op: 'contains', value: '1' },
          { column: col.since, op: 'gt', value: 'ayer' },
        ],
      },
    }).expect(400);

    expect(body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(body.issues).toEqual([
      expect.objectContaining({
        field: 'filter.and.0.op',
        code: 'ROW_FILTER_OPERATOR_INVALID',
      }),
      expect.objectContaining({
        field: 'filter.and.1.value',
        code: 'ROW_FILTER_VALUE_INVALID',
      }),
    ]);
    await query({ limit: 101 }).expect(400);
    await query({ sort: [{ columnId: col.sku, direction: 'up' }] }).expect(400);
  });

  it('fuera de la organización responde 404 y una hoja inexistente también', async () => {
    await query({}, 'bob-session')
      .expect(404)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('PROJECT_NOT_FOUND')),
      );
    await request(app.getHttpServer())
      .post(
        `${base}/worksheets/00000000-0000-4000-8000-00000000beef/rows/query`,
      )
      .auth('alice-session', { type: 'bearer' })
      .send({})
      .expect(404)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('WORKSHEET_NOT_FOUND')),
      );
  });
});
