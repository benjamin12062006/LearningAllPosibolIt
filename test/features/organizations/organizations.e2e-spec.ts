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
import { permissionsFor } from '../../../src/organizations/organization-roles.js';
import { ProjectsModule } from '../../../src/projects/projects.module.js';
import type { Project } from '../../../src/projects/projects.types.js';
import { UsersService } from '../../../src/users/users.service.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';

const ORGANIZATIONS = '/api/v1/organizations';
const PROJECTS = '/api/v1/projects';
const UNKNOWN_ID = '00000000-0000-4000-8000-00000000beef';
const firstPage = { limit: 20, offset: 0, hasMore: false };

describe('Organizaciones y acceso por membresía, con guard y persistencia reales', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  const validateSession = jest.fn<DescopeService['validateSession']>();

  beforeAll(async () => {
    database = await createTestDatabase();
    // ProjectsModule importa OrganizationsModule: monta las dos familias de rutas.
    const module = await Test.createTestingModule({ imports: [ProjectsModule] })
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
      const identity = identityFor(token);
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

  it('sin Bearer responde 401 antes del proveedor', async () => {
    for (const path of [
      ORGANIZATIONS,
      `${ORGANIZATIONS}/${UNKNOWN_ID}`,
      `${ORGANIZATIONS}/${UNKNOWN_ID}/projects`,
      `${PROJECTS}/${UNKNOWN_ID}/access`,
    ]) {
      await request(app.getHttpServer())
        .get(path)
        .expect(401)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('AUTH_SESSION_REQUIRED')),
        );
    }
    expect(validateSession).not.toHaveBeenCalled();
  });

  it('el primer proyecto aparece dentro de la organización personal de quien lo crea', async () => {
    const project = await createProject('alice-session');

    const listed = await get('alice-session', ORGANIZATIONS).expect(200);
    const organization = listed.body.organizations[0];
    expect(listed.body).toEqual({
      organizations: [
        {
          id: expect.any(String),
          name: 'Personal',
          kind: 'personal',
          role: 'owner',
          createdAt: expect.any(String),
        },
      ],
      page: firstPage,
    });

    const { role, ...withoutRole } = organization;
    await get('alice-session', `${ORGANIZATIONS}/${organization.id}`).expect(
      200,
      {
        organization: withoutRole,
        access: { role, permissions: [...permissionsFor('owner')] },
      },
    );
    await get(
      'alice-session',
      `${ORGANIZATIONS}/${organization.id}/projects`,
    ).expect(200, { projects: [project], page: firstPage });
    const aliceUser = await app.get(UsersService).findCurrent(alice);
    await get('alice-session', `${PROJECTS}/${project.id}/access`).expect(200, {
      access: {
        actorId: aliceUser.id,
        organizationId: organization.id,
        projectId: project.id,
        role: 'owner',
        permissions: [...permissionsFor('owner')],
      },
    });
  });

  it('la organización y el proyecto de otra persona responden 404, como si no existieran', async () => {
    const project = await createProject('alice-session');
    const organizationId = await onlyOrganizationOf('alice-session');

    await get('bob-session', ORGANIZATIONS).expect(200, {
      organizations: [],
      page: firstPage,
    });
    for (const path of [
      `${ORGANIZATIONS}/${organizationId}`,
      `${ORGANIZATIONS}/${organizationId}/projects`,
    ]) {
      await get('bob-session', path)
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('ORGANIZATION_NOT_FOUND')),
        );
    }
    await get('bob-session', `${PROJECTS}/${project.id}/access`)
      .expect(404)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('PROJECT_NOT_FOUND')),
      );
  });

  it('el rol se lee en cada petición: dar acceso y revocarlo surte efecto con el mismo token', async () => {
    const project = await createProject('alice-session');
    const organizationId = await onlyOrganizationOf('alice-session');
    const bobUser = await app.get(UsersService).findCurrent(bob);

    await database.connection.pool.query(
      `INSERT INTO estadistica_forms.organization_members
         (organization_id, user_id, role, created_at)
       VALUES ($1, $2, 'viewer', '2026-11-02T12:00:00.000Z')`,
      [organizationId, bobUser.id],
    );
    await get('bob-session', `${ORGANIZATIONS}/${organizationId}`)
      .expect(200)
      .expect(({ body }) =>
        expect(body.access).toEqual({
          role: 'viewer',
          permissions: ['organization.read'],
        }),
      );
    await get('bob-session', `${ORGANIZATIONS}/${organizationId}/projects`)
      .expect(200)
      .expect(({ body }) => expect(body.projects).toEqual([project]));

    await database.connection.pool.query(
      `DELETE FROM estadistica_forms.organization_members
       WHERE organization_id = $1 AND user_id = $2`,
      [organizationId, bobUser.id],
    );
    await get('bob-session', `${PROJECTS}/${project.id}/access`).expect(404);
  });

  it('rechaza identificadores que no son UUID', async () => {
    for (const path of [
      `${ORGANIZATIONS}/no-uuid`,
      `${ORGANIZATIONS}/no-uuid/projects`,
      `${PROJECTS}/no-uuid/access`,
    ]) {
      await get('alice-session', path)
        .expect(400)
        .expect(({ body }) =>
          expect(body).toMatchObject({ code: 'INVALID_UUID' }),
        );
    }
  });

  it('las rutas existentes de proyectos conservan su respuesta, sin campos nuevos', async () => {
    const project = await createProject('alice-session');

    expect(Object.keys(project).sort()).toEqual(
      [
        'channelProfile',
        'configurationStatus',
        'country',
        'createdAt',
        'currency',
        'id',
        'name',
      ].sort(),
    );
    await get('alice-session', `${PROJECTS}/${project.id}`).expect(200, {
      project,
    });
  });

  function get(session: string, path: string) {
    return request(app.getHttpServer())
      .get(path)
      .auth(session, { type: 'bearer' });
  }

  async function createProject(session: string): Promise<Project> {
    const response = await request(app.getHttpServer())
      .post(PROJECTS)
      .auth(session, { type: 'bearer' })
      .send(projectInput)
      .expect(201);
    return response.body.project;
  }

  async function onlyOrganizationOf(session: string): Promise<string> {
    const response = await get(session, ORGANIZATIONS).expect(200);
    return response.body.organizations[0].id;
  }
});

function identityFor(token: string) {
  if (token === 'alice-session') return alice;
  if (token === 'bob-session') return bob;
  return null;
}
