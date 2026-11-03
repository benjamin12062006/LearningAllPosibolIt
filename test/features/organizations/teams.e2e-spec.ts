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
import type { AuthenticatedIdentity } from '../../../src/auth/authenticated-request.js';
import { DescopeService } from '../../../src/auth/descope.service.js';
import { configureHttp } from '../../../src/configure-http.js';
import { publicError } from '../../../src/common/http/public-error.js';
import { POSTGRESQL_CONNECTION } from '../../../src/database/postgresql.connection.js';
import { permissionsFor } from '../../../src/organizations/organization-roles.js';
import { OrganizationsModule } from '../../../src/organizations/organizations.module.js';
import { UsersService } from '../../../src/users/users.service.js';
import { alice, bob } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';

const carol: AuthenticatedIdentity = {
  ...alice,
  subject: 'carol',
  email: 'carol@example.test',
};
/** Sesión válida sin claim de correo (F37: Descope no lo garantiza). */
const noEmail: AuthenticatedIdentity = {
  issuer: alice.issuer,
  subject: 'no-email',
};
const SESSIONS: Record<string, AuthenticatedIdentity> = {
  'alice-session': alice,
  'bob-session': bob,
  'carol-session': carol,
  'no-email-session': noEmail,
};
const ORGANIZATIONS = '/api/v1/organizations';
const ACCEPT = '/api/v1/invitations/accept';

describe('Equipos e invitaciones por HTTP, con guard y persistencia reales', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let userIds: Record<string, string>;
  const validateSession = jest.fn<DescopeService['validateSession']>();

  beforeAll(async () => {
    database = await createTestDatabase();
    const module = await Test.createTestingModule({
      imports: [OrganizationsModule],
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
    await database.connection.pool.query(
      'TRUNCATE estadistica_forms.app_users CASCADE',
    );
    const users = app.get(UsersService);
    userIds = {};
    for (const [session, identity] of Object.entries(SESSIONS)) {
      userIds[session] = (await users.provision(identity)).id;
    }
  });
  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await database?.close();
    }
  });

  it('recorrido completo: crear, invitar, aceptar, ascender, transferir y salir', async () => {
    const created = await call('alice-session', 'post', ORGANIZATIONS)
      .send({ name: ' Tienda ' })
      .expect(201);
    expect(created.body).toEqual({
      organization: {
        id: expect.any(String),
        name: 'Tienda',
        kind: 'team',
        createdAt: expect.any(String),
        archivedAt: null,
      },
      access: { role: 'owner', permissions: [...permissionsFor('owner')] },
    });
    const team = `${ORGANIZATIONS}/${created.body.organization.id}`;

    const invited = await call('alice-session', 'post', `${team}/invitations`)
      .send({ email: ' Bob@Example.test ', role: 'editor' })
      .expect(201);
    expect(invited.body).toEqual({
      invitation: {
        id: expect.any(String),
        email: 'bob@example.test',
        role: 'editor',
        createdAt: expect.any(String),
        expiresAt: expect.any(String),
      },
      token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    await call('alice-session', 'get', `${team}/invitations`).expect(200, {
      invitations: [invited.body.invitation],
      page: { limit: 20, offset: 0, hasMore: false },
    });

    await call('bob-session', 'post', ACCEPT)
      .send({ token: invited.body.token })
      .expect(201)
      .expect(({ body }) =>
        expect(body.access).toEqual({
          role: 'editor',
          permissions: [...permissionsFor('editor')],
        }),
      );

    await call(
      'alice-session',
      'patch',
      `${team}/members/${userIds['bob-session']}`,
    )
      .send({ role: 'owner' })
      .expect(200)
      .expect(({ body }) =>
        expect(body.member).toMatchObject({
          userId: userIds['bob-session'],
          email: 'bob@example.test',
          role: 'owner',
        }),
      );
    await call(
      'alice-session',
      'delete',
      `${team}/members/${userIds['alice-session']}`,
    ).expect(204);

    await call('alice-session', 'get', team).expect(404);
    await call('bob-session', 'get', `${team}/members`)
      .expect(200)
      .expect(({ body }) =>
        expect(body.members.map(({ role }: { role: string }) => role)).toEqual([
          'owner',
        ]),
      );
  });

  it('un editor ve a los miembros pero no gestiona ni invita: 403', async () => {
    const team = await teamWith('bob-session', 'editor');

    await call('bob-session', 'get', `${team}/members`).expect(200);
    for (const [method, path, body] of [
      ['get', `${team}/invitations`, undefined],
      [
        'post',
        `${team}/invitations`,
        { email: 'carol@example.test', role: 'viewer' },
      ],
      [
        'patch',
        `${team}/members/${userIds['alice-session']}`,
        { role: 'viewer' },
      ],
    ] as const) {
      await call('bob-session', method, path)
        .send(body)
        .expect(403)
        .expect(({ body: error }) =>
          expect(error).toMatchObject(publicError('FORBIDDEN')),
        );
    }
  });

  it('quien no es miembro recibe 404 en todas las rutas de la organización', async () => {
    const team = await teamWith();

    for (const [method, path] of [
      ['get', `${team}/members`],
      ['get', `${team}/invitations`],
      ['post', `${team}/invitations`],
      ['patch', `${team}/members/${userIds['alice-session']}`],
      ['delete', `${team}/members/${userIds['alice-session']}`],
    ] as const) {
      await call('carol-session', method, path)
        .send(
          method === 'post'
            ? { email: 'x@example.test', role: 'viewer' }
            : { role: 'viewer' },
        )
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('ORGANIZATION_NOT_FOUND')),
        );
    }
  });

  it('el último owner no puede salir: 409', async () => {
    const team = await teamWith();

    await call(
      'alice-session',
      'delete',
      `${team}/members/${userIds['alice-session']}`,
    )
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('ORGANIZATION_LAST_OWNER')),
      );
  });

  it('aceptar con otro correo o sin correo en la sesión: 403; token inventado: 404', async () => {
    const team = await teamWith();
    const { body } = await call('alice-session', 'post', `${team}/invitations`)
      .send({ email: 'carol@example.test', role: 'viewer' })
      .expect(201);

    for (const session of ['bob-session', 'no-email-session']) {
      await call(session, 'post', ACCEPT)
        .send({ token: body.token })
        .expect(403)
        .expect(({ body: error }) =>
          expect(error).toMatchObject(publicError('INVITATION_EMAIL_MISMATCH')),
        );
    }
    await call('carol-session', 'post', ACCEPT)
      .send({ token: 'A'.repeat(43) })
      .expect(404);
    await call('carol-session', 'post', ACCEPT)
      .send({ token: 'corto' })
      .expect(400);
    await call('carol-session', 'post', ACCEPT)
      .send({ token: body.token })
      .expect(201);
  });

  it('revocar una invitación la invalida', async () => {
    const team = await teamWith();
    const { body } = await call('alice-session', 'post', `${team}/invitations`)
      .send({ email: 'carol@example.test', role: 'viewer' })
      .expect(201);

    await call(
      'alice-session',
      'delete',
      `${team}/invitations/${body.invitation.id}`,
    ).expect(204);
    await call('carol-session', 'post', ACCEPT)
      .send({ token: body.token })
      .expect(404);
  });

  it('valida nombre, correo y rol', async () => {
    const team = await teamWith();

    await call('alice-session', 'post', ORGANIZATIONS)
      .send({ name: '   ' })
      .expect(400);
    await call('alice-session', 'post', `${team}/invitations`)
      .send({ email: 'no-es-correo', role: 'viewer' })
      .expect(400);
    await call('alice-session', 'post', `${team}/invitations`)
      .send({ email: 'carol@example.test', role: 'superuser' })
      .expect(400);
  });

  it('archivar y restaurar: solo owner, la personal no se archiva y archivada no admite invitaciones', async () => {
    const team = await teamWith('bob-session', 'admin');
    const invitation = { email: 'carol@example.test', role: 'viewer' };

    await call('bob-session', 'post', `${team}/archive`)
      .expect(403)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('FORBIDDEN')),
      );
    await call('alice-session', 'post', `${team}/archive`)
      .expect(200)
      .expect(({ body }) =>
        expect(body.organization.archivedAt).toEqual(expect.any(String)),
      );
    await call('bob-session', 'get', team).expect(200);
    await call('alice-session', 'post', `${team}/invitations`)
      .send(invitation)
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('ORGANIZATION_ARCHIVED')),
      );

    await call('alice-session', 'post', `${team}/restore`)
      .expect(200)
      .expect(({ body }) => expect(body.organization.archivedAt).toBeNull());
    await call('alice-session', 'post', `${team}/invitations`)
      .send(invitation)
      .expect(201);

    await database.connection.pool.query(
      `INSERT INTO estadistica_forms.organizations
         (id, name, personal_owner_id, created_at)
       VALUES ('00000000-0000-4000-8000-0000000000aa', 'Personal', $1, '2026-11-03')`,
      [userIds['carol-session']],
    );
    await database.connection.pool.query(
      `INSERT INTO estadistica_forms.organization_members
         (organization_id, user_id, role, created_at)
       VALUES ('00000000-0000-4000-8000-0000000000aa', $1, 'owner', '2026-11-03')`,
      [userIds['carol-session']],
    );
    await call(
      'carol-session',
      'post',
      `${ORGANIZATIONS}/00000000-0000-4000-8000-0000000000aa/archive`,
    )
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject(
          publicError('ORGANIZATION_PERSONAL_NOT_ARCHIVABLE'),
        ),
      );
  });

  function call(
    session: string,
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
  ) {
    return request(app.getHttpServer())
      [method](path)
      .auth(session, { type: 'bearer' });
  }

  /** Organización de Alice; opcionalmente con otra persona y su rol. */
  async function teamWith(session?: string, role?: string): Promise<string> {
    const { body } = await call('alice-session', 'post', ORGANIZATIONS)
      .send({ name: 'Equipo' })
      .expect(201);
    if (session && role) {
      await database.connection.pool.query(
        `INSERT INTO estadistica_forms.organization_members
           (organization_id, user_id, role, created_at)
         VALUES ($1, $2, $3, '2026-11-02T12:00:00.000Z')`,
        [body.organization.id, userIds[session], role],
      );
    }
    return `${ORGANIZATIONS}/${body.organization.id}`;
  }
});
