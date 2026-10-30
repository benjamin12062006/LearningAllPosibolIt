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
import { ProjectsModule } from '../../../src/projects/projects.module.js';
import { ProjectsService } from '../../../src/projects/projects.service.js';
import type { Project } from '../../../src/projects/projects.types.js';
import { UsersService } from '../../../src/users/users.service.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';

describe('Projects HTTP con guard, DTOs, servicios y persistencia reales', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let projects: ProjectsService;
  const validateSession = jest.fn<DescopeService['validateSession']>();
  const api = '/api/v1/projects';

  beforeAll(async () => {
    database = await createTestDatabase();
    const module = await Test.createTestingModule({ imports: [ProjectsModule] })
      .overrideProvider(POSTGRESQL_CONNECTION)
      .useValue(database.connection)
      .overrideProvider(DescopeService)
      .useValue({ validateSession })
      .compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
    projects = app.get(ProjectsService);
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
    await users.provision(alice);
    await users.provision(bob);
  });
  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await database?.close();
    }
  });

  it('sin Bearer responde 401 antes del proveedor y del servicio de negocio', async () => {
    const create = jest.spyOn(projects, 'create');

    await request(app.getHttpServer())
      .post(api)
      .send(projectInput)
      .expect(401)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('AUTH_SESSION_REQUIRED')),
      );

    expect(validateSession).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(await projects.findAll(alice)).toEqual([]);
  });

  it('rechaza un token inválido sin escribir proyectos', async () => {
    const create = jest.spyOn(projects, 'create');

    await request(app.getHttpServer())
      .post(api)
      .auth('invalid', { type: 'bearer' })
      .send(projectInput)
      .expect(401)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('AUTH_SESSION_INVALID')),
      );

    expect(validateSession).toHaveBeenCalledWith('invalid');
    expect(create).not.toHaveBeenCalled();
    expect(await projects.findAll(alice)).toEqual([]);
  });

  it('crea, lista y consulta un proyecto con nombre y códigos normalizados', async () => {
    const response = await request(app.getHttpServer())
      .post(api)
      .auth('alice-session', { type: 'bearer' })
      .send({
        ...projectInput,
        name: ' Tienda A ',
        country: ' us ',
        currency: ' usd ',
      })
      .expect(201);
    const { body }: { body: { project: Project } } = response;

    expect(body.project).toEqual({
      ...projectInput,
      id: expect.any(String),
      createdAt: expect.any(String),
      configurationStatus: 'ready',
    });
    await request(app.getHttpServer())
      .get(api)
      .auth('alice-session', { type: 'bearer' })
      .expect(200, { projects: [body.project] });
    await request(app.getHttpServer())
      .get(`${api}/${body.project.id}`)
      .auth('alice-session', { type: 'bearer' })
      .expect(200, body);
    await request(app.getHttpServer())
      .get(api)
      .auth('bob-session', { type: 'bearer' })
      .expect(200, { projects: [] });
  });

  it('Alice no puede leer ni modificar el ID de Bob; la fila queda intacta', async () => {
    const foreign = await projects.create(bob, projectInput);

    await request(app.getHttpServer())
      .get(`${api}/${foreign.id}`)
      .auth('alice-session', { type: 'bearer' })
      .expect(404)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('PROJECT_NOT_FOUND')),
      );
    await request(app.getHttpServer())
      .patch(`${api}/${foreign.id}`)
      .auth('alice-session', { type: 'bearer' })
      .send({ name: 'Intrusión' })
      .expect(404);

    expect(await projects.findOwned(bob, foreign.id)).toEqual(foreign);
    expect(await projects.findAll(alice)).toEqual([]);
  });

  it('POST autenticado sin cuerpo devuelve 400 y no escribe', async () => {
    await request(app.getHttpServer())
      .post(api)
      .auth('alice-session', { type: 'bearer' })
      .expect(400);
    expect(await projects.findAll(alice)).toEqual([]);
  });

  it('el perfil ausente conserva 404 y el contrato bilingüe', async () => {
    await database.connection.pool.query(
      'TRUNCATE estadistica_forms.app_users CASCADE',
    );
    await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .auth('alice-session', { type: 'bearer' })
      .expect(404)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('PROFILE_NOT_FOUND')),
      );
  });

  it.each([
    ['configuración ausente', { name: 'Sin configuración' }],
    ['propietario enviado por cliente', { ...projectInput, ownerId: 'bob' }],
    ['nombre vacío', { ...projectInput, name: '   ' }],
    ['nombre demasiado largo', { ...projectInput, name: 'a'.repeat(121) }],
    ['país inexistente', { ...projectInput, country: 'ZZ' }],
    ['moneda inexistente', { ...projectInput, currency: 'ZZZ' }],
    ['perfil desconocido', { ...projectInput, channelProfile: 'other' }],
    ['país nulo', { ...projectInput, country: null }],
  ])('POST devuelve 400 y no persiste: %s', async (_label, input) => {
    await request(app.getHttpServer())
      .post(api)
      .auth('alice-session', { type: 'bearer' })
      .send(input)
      .expect(400);

    expect(await projects.findAll(alice)).toEqual([]);
  });

  it.each([
    {},
    { country: 'BO' },
    { country: 'BO', currency: 'BOB' },
    { name: null },
    { currency: null },
    { ownerId: 'bob' },
    { country: 'ZZ', currency: 'USD', channelProfile: 'google_merchant' },
  ])('PATCH inválido devuelve 400 y conserva la fila: %j', async (input) => {
    const original = await projects.create(alice, projectInput);

    await request(app.getHttpServer())
      .patch(`${api}/${original.id}`)
      .auth('alice-session', { type: 'bearer' })
      .send(input)
      .expect(400);

    expect(await projects.findOwned(alice, original.id)).toEqual(original);
  });

  it('actualiza configuración completa y renombra sin perderla', async () => {
    const original = await projects.create(alice, projectInput);
    const configured = { ...original, country: 'BO', currency: 'BOB' };

    await request(app.getHttpServer())
      .patch(`${api}/${original.id}`)
      .auth('alice-session', { type: 'bearer' })
      .send({
        country: 'bo',
        currency: 'bob',
        channelProfile: 'google_merchant',
      })
      .expect(200, { project: configured });
    await request(app.getHttpServer())
      .patch(`${api}/${original.id}`)
      .auth('alice-session', { type: 'bearer' })
      .send({ name: ' Nuevo nombre ' })
      .expect(200, { project: { ...configured, name: 'Nuevo nombre' } });
  });

  it('completa la configuración de una fila anterior conservando su ID', async () => {
    const inherited = {
      id: '00000000-0000-4000-8000-000000000003',
      name: 'Anterior',
      createdAt: '2026-01-01',
    };
    const owner = await app.get(UsersService).findCurrent(alice);
    await database.connection.pool.query(
      'INSERT INTO estadistica_forms.projects (id,name,owner_id,created_at) VALUES ($1,$2,$3,$4)',
      [inherited.id, inherited.name, owner.id, inherited.createdAt],
    );
    await request(app.getHttpServer())
      .get(`${api}/${inherited.id}`)
      .auth('alice-session', { type: 'bearer' })
      .expect(200, {
        project: {
          ...inherited,
          country: null,
          currency: null,
          channelProfile: null,
          configurationStatus: 'required',
        },
      });
    await expect(
      projects.requireConfigured(alice, inherited.id),
    ).rejects.toMatchObject({
      response: { code: 'PROJECT_CONFIGURATION_REQUIRED' },
    });

    await request(app.getHttpServer())
      .patch(`${api}/${inherited.id}`)
      .auth('alice-session', { type: 'bearer' })
      .send(projectInput)
      .expect(200);

    expect(await projects.requireConfigured(alice, inherited.id)).toMatchObject(
      {
        id: inherited.id,
        ...projectInput,
        configurationStatus: 'ready',
      },
    );
  });

  it('las rutas de espacios retiradas responden 404', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/statistical-spaces')
      .auth('alice-session', { type: 'bearer' })
      .expect(404);
    await request(app.getHttpServer())
      .post('/api/v1/statistical-spaces')
      .auth('alice-session', { type: 'bearer' })
      .send({ name: 'Retirado' })
      .expect(404);
    expect(await projects.findAll(alice)).toEqual([]);
  });

  it('valida UUID y devuelve 404 para un ID válido ausente', async () => {
    await request(app.getHttpServer())
      .get(`${api}/invalid`)
      .auth('alice-session', { type: 'bearer' })
      .expect(400);
    await request(app.getHttpServer())
      .get(`${api}/00000000-0000-4000-8000-000000000099`)
      .auth('alice-session', { type: 'bearer' })
      .expect(404);
  });

  it('comparte prefijo, versión y CORS con el servidor productivo', async () => {
    await request(app.getHttpServer())
      .get('/projects')
      .auth('alice-session', { type: 'bearer' })
      .expect(404);
    await request(app.getHttpServer())
      .options(api)
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'PATCH')
      .expect('Access-Control-Allow-Origin', 'http://localhost:3000')
      .expect(204);
  });
});
