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
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { ArtifactStore } from '../../../src/artifacts/artifact.store.js';
import { ARTIFACT_STORE_OPTIONS } from '../../../src/artifacts/artifacts.types.js';
import type { AuthenticatedIdentity } from '../../../src/auth/authenticated-request.js';
import { DescopeService } from '../../../src/auth/descope.service.js';
import { CatalogImportModule } from '../../../src/catalog-import/catalog-import.module.js';
import { CATALOG_IMPORT_OPTIONS } from '../../../src/catalog-import/import.types.js';
import { publicError } from '../../../src/common/http/public-error.js';
import { configureHttp } from '../../../src/configure-http.js';
import { POSTGRESQL_CONNECTION } from '../../../src/database/postgresql.connection.js';
import { EvaluationsModule } from '../../../src/evaluations/evaluations.module.js';
import { EVALUATION_OPTIONS } from '../../../src/evaluations/evaluations.types.js';
import { EvaluationWorker } from '../../../src/evaluations/evaluations.worker.js';
import { ExportsModule } from '../../../src/exports/exports.module.js';
import { EXPORT_OPTIONS } from '../../../src/exports/exports.types.js';
import { FeedsModule } from '../../../src/feeds/feeds.module.js';
import { FEED_OPTIONS } from '../../../src/feeds/feeds.types.js';
import type { OrganizationRole } from '../../../src/organizations/organization-roles.js';
import { ProjectsModule } from '../../../src/projects/projects.module.js';
import { ProjectsService } from '../../../src/projects/projects.service.js';
import { RulesetsModule } from '../../../src/rulesets/rulesets.module.js';
import { UsersService } from '../../../src/users/users.service.js';
import {
  insertReadySnapshot,
  mixedCatalog,
} from '../evaluations/support/snapshot-fixtures.js';
import { rulesetBody } from '../rulesets/support/ruleset-fixtures.js';
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

/**
 * C6 (E1.2): las rutas antiguas de `/projects/:projectId/…` deciden por la
 * membresía y el rol en la organización del proyecto, no por quién lo creó.
 * Alice crea el proyecto en su organización personal; Bob entra con cada rol;
 * Carol es de otra organización.
 */
describe('Acceso por membresía en las rutas de proyectos (C6, E1.2)', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let root: string;
  let projectId: string;
  let organizationId: string;
  let bobId: string;
  let snapshotId: string;
  let feedId: string;
  let approval: Record<string, unknown>;
  const validateSession = jest.fn<DescopeService['validateSession']>();

  beforeAll(async () => {
    database = await createTestDatabase();
    root = await mkdtemp(join(tmpdir(), 'project-roles-'));
    const idle = { autoStart: false, pollMs: 1000, shutdownMs: 1000 };
    const module = await Test.createTestingModule({
      imports: [
        ProjectsModule,
        CatalogImportModule,
        RulesetsModule,
        EvaluationsModule,
        ExportsModule,
        FeedsModule,
      ],
    })
      .overrideProvider(POSTGRESQL_CONNECTION)
      .useValue(database.connection)
      .overrideProvider(DescopeService)
      .useValue({ validateSession })
      .overrideProvider(ARTIFACT_STORE_OPTIONS)
      .useValue({ root })
      .overrideProvider(CATALOG_IMPORT_OPTIONS)
      .useValue(idle)
      .overrideProvider(EVALUATION_OPTIONS)
      .useValue(idle)
      .overrideProvider(EXPORT_OPTIONS)
      .useValue({ autoStart: false })
      .overrideProvider(FEED_OPTIONS)
      .useValue({ autoStart: false, retainedFiles: 3 })
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
    const aliceId = (await users.provision(alice)).id;
    bobId = (await users.provision(bob)).id;
    await users.provision(carol);
    await app.get(ProjectsService).create(carol, projectInput);
    projectId = (await app.get(ProjectsService).create(alice, projectInput)).id;
    const { rows } = await pool().query<{ id: string }>(
      `SELECT id FROM estadistica_forms.organizations
       WHERE personal_owner_id = $1`,
      [aliceId],
    );
    organizationId = rows[0].id;

    // Lo que Alice deja preparado: reglas, un snapshot listo, su evaluación y el feed.
    await send('post', `${base()}/rulesets`).send(rulesetBody()).expect(201);
    snapshotId = await insertReadySnapshot(pool(), projectId, mixedCatalog(4));
    approval = await evaluated();
    const { body } = await send('post', `${base()}/feeds`).expect(201);
    feedId = body.feed.id;
  });
  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await database?.close();
      if (root) await rm(root, { recursive: true, force: true });
    }
  });

  const pool = () => database.connection.pool;
  const base = () => `/api/v1/projects/${projectId}`;

  function send(
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    session: Session = 'alice-session',
  ) {
    return request(app.getHttpServer())
      [method](path)
      .auth(session, { type: 'bearer' });
  }

  /** Evalúa el snapshot y devuelve la aprobación tal como se lee por HTTP. */
  async function evaluated(session: Session = 'alice-session') {
    const { body: accepted } = await send(
      'post',
      `${base()}/evaluations`,
      session,
    )
      .send({ snapshotId, rulesetRevision: 1 })
      .expect(202);
    await app.get(EvaluationWorker).runUntilIdle();
    const { body } = await send('get', accepted.statusUrl).expect(200);
    const { evaluation } = body;
    return {
      evaluationId: evaluation.id,
      resultChecksum: evaluation.resultChecksum,
      acceptedInvalidCount: evaluation.counts.invalid,
      acceptedExcludedCount: evaluation.counts.excluded,
    };
  }

  async function setBobRole(role: OrganizationRole) {
    await pool().query(
      `INSERT INTO estadistica_forms.organization_members
         (organization_id, user_id, role, created_at)
       VALUES ($1, $2, $3, '2026-11-08T12:00:00.000Z')
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = $3`,
      [organizationId, bobId, role],
    );
  }

  /** Todas las lecturas de los siete módulos. */
  const reads = () => [
    `${base()}`,
    `${base()}/imports`,
    `${base()}/imports/${snapshotId}`,
    `${base()}/rulesets`,
    `${base()}/rulesets/1`,
    `${base()}/evaluations`,
    `${base()}/evaluations/${String(approval.evaluationId)}`,
    `${base()}/feeds`,
    `${base()}/feeds/${feedId}`,
  ];

  const forbidden = ({ body }: { body: unknown }) =>
    expect(body).toMatchObject(publicError('FORBIDDEN'));

  it('alguien de otra organización no ve nada: 404 al leer y al escribir', async () => {
    for (const path of reads()) {
      await send('get', path, 'carol-session').expect(404);
    }
    await send('patch', base(), 'carol-session')
      .send({ name: 'Mío' })
      .expect(404);
    await send('post', `${base()}/rulesets`, 'carol-session')
      .send(rulesetBody())
      .expect(404);
    const { body } = await send('get', '/api/v1/projects', 'carol-session');
    expect(body.projects.map(({ id }: { id: string }) => id)).not.toContain(
      projectId,
    );
  });

  it('un lector ve todo (también en GET /projects) y no cambia nada: 403', async () => {
    await setBobRole('viewer');
    for (const path of reads()) {
      await send('get', path, 'bob-session').expect(200);
    }
    const { body } = await send('get', '/api/v1/projects', 'bob-session');
    expect(body.projects.map(({ id }: { id: string }) => id)).toContain(
      projectId,
    );

    await send('post', `${base()}/rulesets`, 'bob-session')
      .send(rulesetBody())
      .expect(403)
      .expect(forbidden);
    await send('post', `${base()}/evaluations`, 'bob-session')
      .send({ snapshotId, rulesetRevision: 1 })
      .expect(403);
    // El guard rechaza antes de recibir el archivo (hasta 10 MiB).
    const receive = jest.spyOn(app.get(ArtifactStore), 'receive');
    await send('post', `${base()}/imports`, 'bob-session')
      .field('idColumn', 'SKU')
      .attach('file', Buffer.from('SKU\r\n1\r\n'), 'catalogo.csv')
      .expect(403);
    expect(receive).not.toHaveBeenCalled();
    await send(
      'delete',
      `${base()}/imports/${snapshotId}`,
      'bob-session',
    ).expect(403);
    await send('post', `${base()}/exports`, 'bob-session')
      .send(approval)
      .expect(403);
    await send('patch', base(), 'bob-session')
      .send({ name: 'Otro' })
      .expect(403);
    await send('delete', base(), 'bob-session').expect(403);
  });

  it('un Editor prepara trabajo (reglas, evaluar) pero no aprueba ni publica', async () => {
    await setBobRole('editor');
    await send('post', `${base()}/rulesets`, 'bob-session')
      .send(rulesetBody())
      .expect(201);
    const bobsApproval = await evaluated('bob-session');

    await send('post', `${base()}/exports`, 'bob-session')
      .send(bobsApproval)
      .expect(403)
      .expect(forbidden);
    await send('post', `${base()}/feeds/${feedId}/publications`, 'bob-session')
      .send({
        exportId: '00000000-0000-4000-8000-000000000001',
        expectedGeneration: 0,
      })
      .expect(403);
    await send('patch', base(), 'bob-session')
      .send({ name: 'Otro' })
      .expect(403);
    await send('delete', base(), 'bob-session').expect(403);
  });

  it('un Manager aprueba la exportación y cambia el proyecto, pero no lo borra', async () => {
    await setBobRole('manager');
    await send('post', `${base()}/exports`, 'bob-session')
      .send(approval)
      .expect(201);
    await send('patch', base(), 'bob-session')
      .send({ name: 'Renombrado por Bob' })
      .expect(200)
      .expect(({ body }) =>
        expect(body.project.name).toBe('Renombrado por Bob'),
      );
    await send('delete', base(), 'bob-session').expect(403).expect(forbidden);
  });

  it('un Admin puede borrar el proyecto entero', async () => {
    await setBobRole('admin');
    await send('delete', base(), 'bob-session').expect(204);
    await send('get', base()).expect(404);
  });

  it('con la organización archivada se lee, pero no se cambia nada: 409', async () => {
    // Una organización personal no se archiva: se convierte antes en de equipo.
    await pool().query(
      `UPDATE estadistica_forms.organizations
       SET personal_owner_id = NULL, archived_at = '2026-11-08T12:00:00.000Z'
       WHERE id = $1`,
      [organizationId],
    );

    for (const path of reads()) {
      await send('get', path).expect(200);
    }
    const archived = ({ body }: { body: unknown }) =>
      expect(body).toMatchObject(publicError('ORGANIZATION_ARCHIVED'));
    await send('post', `${base()}/rulesets`)
      .send(rulesetBody())
      .expect(409)
      .expect(archived);
    await send('post', `${base()}/exports`).send(approval).expect(409);
    await send('patch', base()).send({ name: 'Otro' }).expect(409);
  });
});
