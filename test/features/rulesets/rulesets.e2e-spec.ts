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
import { publicError } from '../../../src/common/http/public-error.js';
import { configureHttp } from '../../../src/configure-http.js';
import { POSTGRESQL_CONNECTION } from '../../../src/database/postgresql.connection.js';
import { ProjectsService } from '../../../src/projects/projects.service.js';
import { RulesetsModule } from '../../../src/rulesets/rulesets.module.js';
import { UsersService } from '../../../src/users/users.service.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';
import { bodyWithRules, rulesetBody } from './support/ruleset-fixtures.js';

describe('Rulesets HTTP con guard, DTOs, servicios y persistencia reales', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let projectId: string;
  const validateSession = jest.fn<DescopeService['validateSession']>();
  const rulesetsOf = (id: string) => `/api/v1/projects/${id}/rulesets`;

  const asAlice = () => request(app.getHttpServer());
  const post = (body: unknown, token = 'alice-session', id = projectId) =>
    asAlice()
      .post(rulesetsOf(id))
      .auth(token, { type: 'bearer' })
      .send(body as object);
  const get = (path: string, token = 'alice-session') =>
    asAlice()
      .get(`${rulesetsOf(projectId)}${path}`)
      .auth(token, { type: 'bearer' });

  beforeAll(async () => {
    database = await createTestDatabase();
    const module = await Test.createTestingModule({ imports: [RulesetsModule] })
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
      const identities: Record<string, typeof alice> = {
        'alice-session': alice,
        'bob-session': bob,
      };
      const identity = identities[token];
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
    await users.provision(alice);
    await users.provision(bob);
    projectId = (await app.get(ProjectsService).create(alice, projectInput)).id;
  });
  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await database?.close();
    }
  });

  it('sin Bearer responde 401 sin guardar nada', async () => {
    await asAlice()
      .post(rulesetsOf(projectId))
      .send(rulesetBody())
      .expect(401)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('AUTH_SESSION_REQUIRED')),
      );
    await get('')
      .expect(200)
      .expect(({ body }) => expect(body.rulesets).toEqual([]));
  });

  it('crea revisiones 1 y 2 con 201 y devuelve mapeo y reglas en orden', async () => {
    const first = await post(rulesetBody()).expect(201);
    const second = await post(rulesetBody()).expect(201);

    expect(first.body.ruleset).toMatchObject({
      revision: 1,
      mapping: rulesetBody().mapping,
      rules: [
        { type: 'clean_text', attributes: ['title', 'brand'] },
        { type: 'build_title', template: '{brand} {title}' },
        {
          type: 'exclude_when',
          attribute: 'id',
          operator: 'equals',
          value: 'X1',
        },
        {
          type: 'exclude_when',
          attribute: 'brand',
          operator: 'is_empty',
          value: '',
        },
      ],
    });
    expect(second.body.ruleset.revision).toBe(2);
  });

  it.each([
    ['null', [null]],
    ['un type __proto__', [JSON.parse('{"type":"__proto__"}')]],
    ['una cadena', ['clean_text']],
  ])('responde 400, nunca 500, a una regla %s', async (_label, rules) => {
    await post(bodyWithRules(rules))
      .expect(400)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('VALIDATION_FAILED')),
      );
  });

  it('informa cada incoherencia entre mapeo y reglas como un issue con su atributo', async () => {
    const { body } = await post({
      mapping: [
        { attribute: 'title', column: 'Nombre' },
        { attribute: 'title', column: 'Otro' },
      ],
      rules: [{ type: 'build_title', template: '{color} {}' }],
    }).expect(400);

    expect(body.code).toBe('VALIDATION_FAILED');
    expect(
      body.issues.map(
        (issue: { field: string; code: string }) =>
          `${issue.field}:${issue.code}`,
      ),
    ).toEqual([
      'mapping.title:RULESET_MAPPING_DUPLICATE',
      'rules.0.color:RULESET_REFERENCE_INVALID',
      'rules.0.{}:RULESET_REFERENCE_INVALID',
      'mapping.description:RULESET_REQUIRED_ATTRIBUTE_MISSING',
      'mapping.link:RULESET_REQUIRED_ATTRIBUTE_MISSING',
      'mapping.image_link:RULESET_REQUIRED_ATTRIBUTE_MISSING',
      'mapping.price:RULESET_REQUIRED_ATTRIBUTE_MISSING',
      'mapping.availability:RULESET_REQUIRED_ATTRIBUTE_MISSING',
    ]);
    await get('')
      .expect(200)
      .expect(({ body: list }) => expect(list.rulesets).toEqual([]));
  });

  it('responde 404 a otro propietario y 400 a un ID de proyecto inválido', async () => {
    await post(rulesetBody()).expect(201);

    await post(rulesetBody(), 'bob-session')
      .expect(404)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('PROJECT_NOT_FOUND')),
      );
    await get('', 'bob-session').expect(404);
    await get('/1', 'bob-session')
      .expect(404)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('PROJECT_NOT_FOUND')),
      );
    await post(rulesetBody(), 'alice-session', 'no-es-uuid')
      .expect(400)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('INVALID_UUID')),
      );
  });

  it('responde 409 si el proyecto no tiene configuración', async () => {
    await database.connection.pool.query(
      `UPDATE estadistica_forms.projects
       SET country = NULL, currency = NULL, channel_profile = NULL`,
    );
    await post(rulesetBody())
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject(
          publicError('PROJECT_CONFIGURATION_REQUIRED'),
        ),
      );
  });

  it('lista paginado de la más reciente a la más antigua y consulta una revisión', async () => {
    for (let index = 0; index < 3; index += 1) {
      await post(rulesetBody()).expect(201);
    }

    await get('?limit=2')
      .expect(200)
      .expect(({ body }) => {
        expect(
          body.rulesets.map(
            (ruleset: { revision: number }) => ruleset.revision,
          ),
        ).toEqual([3, 2]);
        expect(body.page).toEqual({ limit: 2, offset: 0, hasMore: true });
      });
    await get('/2')
      .expect(200)
      .expect(({ body }) => expect(body.ruleset.revision).toBe(2));
  });

  it.each(['4', '0', '-1', 'abc', '1.5', '99999999999'])(
    'responde 404 a la revisión %j',
    async (revision) => {
      await post(rulesetBody()).expect(201);
      await get(`/${revision}`)
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('RULESET_NOT_FOUND')),
        );
    },
  );
});
