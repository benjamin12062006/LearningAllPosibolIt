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
import { ChangesetsModule } from '../../../src/changesets/changesets.module.js';
import { publicError } from '../../../src/common/http/public-error.js';
import { configureHttp } from '../../../src/configure-http.js';
import { POSTGRESQL_CONNECTION } from '../../../src/database/postgresql.connection.js';
import type { OrganizationRole } from '../../../src/organizations/organization-roles.js';
import { OrganizationsRepository } from '../../../src/organizations/organizations.repository.js';
import { ProjectsModule } from '../../../src/projects/projects.module.js';
import { ProjectsRepository } from '../../../src/projects/projects.repository.js';
import { UsersService } from '../../../src/users/users.service.js';
import { WorksheetImportsModule } from '../../../src/worksheet-imports/worksheet-imports.module.js';
import { WorksheetsModule } from '../../../src/worksheets/worksheets.module.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';

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

/** El archivo de este mes: el `;` y la coma decimal son los del proveedor. */
const MONTHLY_CSV =
  'Código;Importe;Activo\nA-1;10,50;sí\nB-2;3,00;no\nC-3;;sí\n';

/**
 * H3 (plan 02 de cierre, P10): plantillas de mapeo. Se guarda el mapeo con
 * nombre y se repite con el archivo siguiente, que solo pone lo suyo.
 */
describe('Plantillas de mapeo por HTTP', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let base: string;
  let organizationId: string;
  let bobId: string;
  let worksheetId: string;
  let otherWorksheetId: string;
  let sku: string;
  let price: string;
  let active: string;
  let total: string;
  const validateSession = jest.fn<DescopeService['validateSession']>();

  const pool = () => database.connection.pool;

  function send(
    method: 'get' | 'post' | 'delete',
    path: string,
    session: Session = 'alice-session',
  ) {
    return request(app.getHttpServer())
      [method](`${base}${path}`)
      .auth(session, { type: 'bearer' });
  }

  const mapping = () => ({
    mode: 'append',
    decimalSeparator: ',',
    booleanLabels: { true: ['sí'], false: ['no'] },
    columns: [
      { header: 'Código', columnId: sku },
      { header: 'Importe', columnId: price },
      { header: 'Activo', columnId: active },
    ],
  });

  async function saveTemplate(name = 'Proveedor mensual', session?: Session) {
    const { body } = await send(
      'post',
      `/worksheets/${worksheetId}/import-mappings`,
      session,
    )
      .send({ name, mapping: mapping() })
      .expect(201);
    return body.importMapping as { id: string; name: string };
  }

  function importWith(
    fields: Record<string, string>,
    content = MONTHLY_CSV,
    session: Session = 'alice-session',
  ) {
    let call = send(
      'post',
      `/worksheets/${worksheetId}/imports`,
      session,
    ).attach('file', Buffer.from(content, 'utf8'), 'productos.csv');
    for (const [name, value] of Object.entries(fields)) {
      call = call.field(name, value);
    }
    return call;
  }

  async function setBobRole(role: OrganizationRole) {
    await pool().query(
      `INSERT INTO estadistica_forms.organization_members
         (organization_id, user_id, role, created_at)
       VALUES ($1, $2, $3, '2026-11-14T09:00:00.000Z')
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = $3`,
      [organizationId, bobId, role],
    );
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    const module = await Test.createTestingModule({
      imports: [
        ProjectsModule,
        WorksheetsModule,
        ChangesetsModule,
        WorksheetImportsModule,
      ],
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
    const columns = [
      { name: 'SKU', type: 'text', required: true },
      { name: 'Precio', type: 'decimal' },
      { name: 'Activo', type: 'boolean' },
      {
        name: 'Total',
        type: 'calculated',
        formula: {
          expression: { column: 'Precio' },
          scale: 2,
          rounding: 'half_up',
        },
      },
    ];
    const { body } = await send(
      'post',
      `/workbooks/${workbook.workbook.id}/worksheets`,
    )
      .send({ name: 'Inventario', columns })
      .expect(201);
    worksheetId = body.worksheet.id;
    [sku, price, active, total] = body.worksheet.columns.map(
      ({ id }: { id: string }) => id,
    );
    const { body: other } = await send(
      'post',
      `/workbooks/${workbook.workbook.id}/worksheets`,
    )
      .send({ name: 'Otra', columns: [{ name: 'SKU', type: 'text' }] })
      .expect(201);
    otherWorksheetId = other.worksheet.id;
  });
  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await database?.close();
    }
  });

  describe('guardar, listar y leer', () => {
    it('guarda la plantilla con el mapeo completo y la lista', async () => {
      const saved = await saveTemplate(' Proveedor mensual ');

      expect(saved).toEqual({
        id: expect.any(String),
        worksheetId,
        name: 'Proveedor mensual',
        mapping: { ...mapping(), matchColumnId: null },
        createdBy: expect.any(String),
        createdAt: expect.any(String),
      });
      const { body: list } = await send(
        'get',
        `/worksheets/${worksheetId}/import-mappings`,
      ).expect(200);
      expect(list).toEqual({
        importMappings: [saved],
        page: { limit: 20, offset: 0, hasMore: false },
      });
      const { body: one } = await send(
        'get',
        `/import-mappings/${saved.id}`,
      ).expect(200);
      expect(one.importMapping).toEqual(saved);
      const { rows } = await pool().query(
        `SELECT action FROM estadistica_forms.audit_events WHERE resource_id = $1`,
        [saved.id],
      );
      expect(rows).toEqual([{ action: 'import_mapping.created' }]);
    });

    it('el nombre es único en la hoja, no entre hojas', async () => {
      await saveTemplate('Proveedor');

      await send('post', `/worksheets/${worksheetId}/import-mappings`)
        .send({ name: 'PROVEEDOR', mapping: mapping() })
        .expect(409)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('IMPORT_MAPPING_NAME_TAKEN')),
        );
      const { body: other } = await send(
        'get',
        `/worksheets/${otherWorksheetId}`,
      ).expect(200);
      await send('post', `/worksheets/${otherWorksheetId}/import-mappings`)
        .send({
          name: 'Proveedor',
          mapping: {
            mode: 'append',
            columns: [
              { header: 'sku', columnId: other.worksheet.columns[0].id },
            ],
          },
        })
        .expect(201);
    });

    it('no guarda lo que depende del archivo ni un mapeo mal formado', async () => {
      const fields = async (extra: Record<string, unknown>) => {
        const { body } = await send(
          'post',
          `/worksheets/${worksheetId}/import-mappings`,
        )
          .send({ name: 'Mal', mapping: { ...mapping(), ...extra } })
          .expect(400);
        expect(body.code).toBe('IMPORT_OPTIONS_INVALID');
        return body.issues.map(({ field }: { field: string }) => field);
      };

      expect(await fields({ title: 'Marzo', excludeRows: [1] })).toEqual([
        'mapping.title',
        'mapping.excludeRows',
      ]);
      expect(await fields({ delimiter: 'semicolon' })).toEqual([
        'mapping.delimiter',
      ]);
      expect(await fields({ mode: 'reemplazar' })).toEqual(['mapping.mode']);
      for (const body of [
        {},
        { name: '', mapping: mapping() },
        { name: 'Sin mapeo' },
        { name: 'Lista', mapping: [mapping()] },
        { name: 'Extra', mapping: mapping(), otro: 1 },
      ]) {
        await send('post', `/worksheets/${worksheetId}/import-mappings`)
          .send(body)
          .expect(400);
      }
    });

    it('no guarda una plantilla con columnas que la hoja no tiene o no se escriben', async () => {
      const { body } = await send(
        'post',
        `/worksheets/${worksheetId}/import-mappings`,
      )
        .send({
          name: 'Columnas',
          mapping: {
            mode: 'upsert',
            matchColumnId: randomUUID(),
            columns: [
              { header: 'Código', columnId: sku },
              { header: 'Total', columnId: total },
              { header: 'Otra', columnId: randomUUID() },
            ],
          },
        })
        .expect(400);

      expect(body.code).toBe('IMPORT_MAPPING_INVALID');
      expect(body.issues.map(({ field }: { field: string }) => field)).toEqual([
        'mapping.columns.1',
        'mapping.columns.2',
        'mapping.matchColumnId',
      ]);
    });
  });

  describe('importar con la plantilla', () => {
    it('basta el archivo: la plantilla pone el mapeo y la importación lo guarda', async () => {
      const template = await saveTemplate();

      const { body } = await importWith({
        mappingId: template.id,
        options: JSON.stringify({ delimiter: 'semicolon' }),
      }).expect(201);

      expect(body.import.options).toEqual({
        ...mapping(),
        matchColumnId: null,
        format: 'csv',
        delimiter: 'semicolon',
        title: 'Importar CSV',
        excludeRows: [],
      });
      expect(body.import.report).toMatchObject({ rows: 3, inserted: 3 });
      const { body: diff } = await send(
        'get',
        `/changesets/${body.changeset.id}/diff`,
      ).expect(200);
      expect(JSON.stringify(diff)).toContain('10.50');
    });

    it('la petición pone el título y las exclusiones de este archivo', async () => {
      const template = await saveTemplate();

      const { body } = await importWith({
        mappingId: template.id,
        options: JSON.stringify({
          delimiter: 'semicolon',
          title: 'Marzo',
          excludeRows: [3],
        }),
      }).expect(201);

      expect(body.import.options).toMatchObject({
        title: 'Marzo',
        excludeRows: [3],
      });
      expect(body.changeset.title).toBe('Marzo');
      expect(body.import.report).toMatchObject({ rows: 3, inserted: 2 });
    });

    it('repetir en la petición algo de la plantilla es un error', async () => {
      const template = await saveTemplate();

      const { body } = await importWith({
        mappingId: template.id,
        options: JSON.stringify({ delimiter: 'semicolon', mode: 'upsert' }),
      }).expect(400);

      expect(body).toMatchObject(publicError('IMPORT_OPTIONS_INVALID'));
      expect(body.issues.map(({ field }: { field: string }) => field)).toEqual([
        'mode',
      ]);
    });

    it('un JSON mal formado no se toma por «sin opciones»', async () => {
      const template = await saveTemplate();

      await importWith({ mappingId: template.id, options: '{no es json' })
        .expect(400)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('IMPORT_OPTIONS_INVALID')),
        );
      const { rows } = await pool().query(
        'SELECT count(*)::int AS n FROM estadistica_forms.worksheet_imports',
      );
      expect(rows[0].n).toBe(0);
    });

    it('una plantilla de otra hoja, una que no existe o un id mal formado', async () => {
      const { body: other } = await send(
        'get',
        `/worksheets/${otherWorksheetId}`,
      ).expect(200);
      const { body: foreign } = await send(
        'post',
        `/worksheets/${otherWorksheetId}/import-mappings`,
      )
        .send({
          name: 'De la otra',
          mapping: {
            mode: 'append',
            columns: [
              { header: 'Código', columnId: other.worksheet.columns[0].id },
            ],
          },
        })
        .expect(201);

      for (const mappingId of [foreign.importMapping.id, randomUUID()]) {
        await importWith({ mappingId })
          .expect(404)
          .expect(({ body }) =>
            expect(body).toMatchObject(publicError('IMPORT_MAPPING_NOT_FOUND')),
          );
      }
      await importWith({ mappingId: 'no-es-uuid' })
        .expect(400)
        .expect(({ body }) => expect(body.issues[0].field).toBe('mappingId'));
    });

    it('si la hoja perdió una columna de la plantilla, la importación lo dice', async () => {
      const template = await saveTemplate();
      // Como si la columna se hubiera borrado después de guardar la plantilla.
      await pool().query(
        `UPDATE estadistica_forms.worksheet_import_mappings
         SET mapping = jsonb_set(mapping, '{columns,1,columnId}', to_jsonb($2::text))
         WHERE id = $1`,
        [template.id, randomUUID()],
      );

      const { body } = await importWith({
        mappingId: template.id,
        options: JSON.stringify({ delimiter: 'semicolon' }),
      }).expect(400);

      expect(body).toMatchObject(publicError('IMPORT_MAPPING_INVALID'));
    });

    it('la vista previa dice qué columnas encuentra y qué cabeceras faltan', async () => {
      const template = await saveTemplate();

      const { body } = await send(
        'post',
        `/worksheets/${worksheetId}/imports/preview`,
      )
        .attach(
          'file',
          Buffer.from('Código;Importe\nA-1;1,00\n', 'utf8'),
          'productos.csv',
        )
        .field('delimiter', 'semicolon')
        .field('mappingId', template.id)
        .expect(200);

      expect(body.preview.template).toEqual({
        id: template.id,
        name: 'Proveedor mensual',
        columns: [
          { header: 'Código', columnId: sku },
          { header: 'Importe', columnId: price },
        ],
        missingHeaders: ['Activo'],
      });
      const { body: plain } = await send(
        'post',
        `/worksheets/${worksheetId}/imports/preview`,
      )
        .attach('file', Buffer.from(MONTHLY_CSV, 'utf8'), 'productos.csv')
        .field('delimiter', 'semicolon')
        .expect(200);
      expect(plain.preview).not.toHaveProperty('template');
    });
  });

  describe('borrar', () => {
    it('borra la plantilla; las importaciones que la usaron conservan sus opciones', async () => {
      const template = await saveTemplate();
      const { body: imported } = await importWith({
        mappingId: template.id,
        options: JSON.stringify({ delimiter: 'semicolon' }),
      }).expect(201);

      await send('delete', `/import-mappings/${template.id}`).expect(204);

      await send('get', `/import-mappings/${template.id}`)
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('IMPORT_MAPPING_NOT_FOUND')),
        );
      await send('delete', `/import-mappings/${template.id}`).expect(404);
      const { body } = await send(
        'get',
        `/worksheet-imports/${imported.import.id}`,
      ).expect(200);
      expect(body.import.options.columns).toEqual(mapping().columns);
      const { rows } = await pool().query(
        `SELECT action FROM estadistica_forms.audit_events
         WHERE resource_id = $1 ORDER BY created_at, action`,
        [template.id],
      );
      expect(rows.map(({ action }) => action)).toEqual([
        'import_mapping.created',
        'import_mapping.deleted',
      ]);
    });
  });

  describe('acceso', () => {
    it('una hoja archivada no admite plantillas nuevas ni borrarlas; sí leerlas', async () => {
      const template = await saveTemplate();
      await send('post', `/worksheets/${worksheetId}/archive`).expect(200);

      await send('post', `/worksheets/${worksheetId}/import-mappings`)
        .send({ name: 'Nueva', mapping: mapping() })
        .expect(409)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('WORKSHEET_ARCHIVED')),
        );
      await send('delete', `/import-mappings/${template.id}`)
        .expect(409)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('WORKSHEET_ARCHIVED')),
        );
      await send('get', `/worksheets/${worksheetId}/import-mappings`).expect(
        200,
      );
      await send('get', `/import-mappings/${template.id}`).expect(200);
    });

    it('un Viewer lee; guardar y borrar piden Editor', async () => {
      const template = await saveTemplate();

      await setBobRole('viewer');
      await send(
        'get',
        `/worksheets/${worksheetId}/import-mappings`,
        'bob-session',
      ).expect(200);
      await send(
        'get',
        `/import-mappings/${template.id}`,
        'bob-session',
      ).expect(200);
      await send(
        'post',
        `/worksheets/${worksheetId}/import-mappings`,
        'bob-session',
      )
        .send({ name: 'De Bob', mapping: mapping() })
        .expect(403);
      await send('delete', `/import-mappings/${template.id}`, 'bob-session')
        .expect(403)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('FORBIDDEN')),
        );

      await setBobRole('editor');
      await saveTemplate('De Bob', 'bob-session');
      await send(
        'delete',
        `/import-mappings/${template.id}`,
        'bob-session',
      ).expect(204);
    });

    it('otra organización recibe 404 y sin sesión, 401', async () => {
      const template = await saveTemplate();

      await send(
        'get',
        `/worksheets/${worksheetId}/import-mappings`,
        'carol-session',
      ).expect(404);
      await send('get', `/import-mappings/${template.id}`, 'carol-session')
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('IMPORT_MAPPING_NOT_FOUND')),
        );
      await send(
        'post',
        `/worksheets/${worksheetId}/import-mappings`,
        'carol-session',
      )
        .send({ name: 'De Carol', mapping: mapping() })
        .expect(404);
      await send(
        'delete',
        `/import-mappings/${template.id}`,
        'carol-session',
      ).expect(404);
      await request(app.getHttpServer())
        .get(`${base}/worksheets/${worksheetId}/import-mappings`)
        .expect(401);
      await send('get', `/worksheets/${randomUUID()}/import-mappings`)
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('WORKSHEET_NOT_FOUND')),
        );
    });
  });
});
