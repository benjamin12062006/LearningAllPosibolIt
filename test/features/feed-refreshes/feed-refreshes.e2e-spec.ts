import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import request from 'supertest';
import { ARTIFACT_STORE_OPTIONS } from '../../../src/artifacts/artifacts.types.js';
import { DescopeService } from '../../../src/auth/descope.service.js';
import { CatalogImportWorker } from '../../../src/catalog-import/catalog-import.worker.js';
import { CATALOG_IMPORT_OPTIONS } from '../../../src/catalog-import/import.types.js';
import { publicError } from '../../../src/common/http/public-error.js';
import { configureHttp } from '../../../src/configure-http.js';
import { POSTGRESQL_CONNECTION } from '../../../src/database/postgresql.connection.js';
import { EVALUATION_OPTIONS } from '../../../src/evaluations/evaluations.types.js';
import { EvaluationWorker } from '../../../src/evaluations/evaluations.worker.js';
import { FeedRefreshWorker } from '../../../src/feed-refreshes/feed-refresh.worker.js';
import { FeedRefreshesModule } from '../../../src/feed-refreshes/feed-refreshes.module.js';
import { FEED_REFRESH_OPTIONS } from '../../../src/feed-refreshes/feed-refreshes.types.js';
import { FeedsModule } from '../../../src/feeds/feeds.module.js';
import { FEED_OPTIONS } from '../../../src/feeds/feeds.types.js';
import { ProjectsService } from '../../../src/projects/projects.service.js';
import { REMOTE_SOURCE_OPTIONS } from '../../../src/remote-source/remote-source.types.js';
import { RulesetsModule } from '../../../src/rulesets/rulesets.module.js';
import { UsersService } from '../../../src/users/users.service.js';
import { rulesetBody } from '../rulesets/support/ruleset-fixtures.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';
import { startSourceServer } from './support/refresh-fixtures.js';

describe('Actualizaciones de feeds por HTTP con guard, workers y un origen local', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let root: string;
  let source: Awaited<ReturnType<typeof startSourceServer>>;
  let projectId: string;
  let bobProjectId: string;
  let feedId: string;
  let deliveryUrl: string;
  const validateSession = jest.fn<DescopeService['validateSession']>();

  const api = () => request(app.getHttpServer());
  const refreshesOf = (id = projectId, feed = feedId) =>
    `/api/v1/projects/${id}/feeds/${feed}/refreshes`;
  const pool = () => database.connection.pool;

  const policyBody = (overrides: Record<string, unknown> = {}) => ({
    rulesetRevision: 1,
    maxInvalid: 5000,
    maxExcluded: 5000,
    maxDropPercent: 100,
    ...overrides,
  });
  const putPolicy = (body: unknown, token = 'alice-session', id = projectId) =>
    api()
      .put(`/api/v1/projects/${id}/feeds/${feedId}/policy`)
      .auth(token, { type: 'bearer' })
      .send(body as object);

  /** Mueve los tres workers hasta que la actualización termine. */
  async function drive(statusUrl: string) {
    for (let round = 0; round < 100; round += 1) {
      await app.get(FeedRefreshWorker).runUntilIdle();
      await app.get(CatalogImportWorker).runUntilIdle();
      await app.get(EvaluationWorker).runUntilIdle();
      const { body } = await api()
        .get(statusUrl)
        .auth('alice-session', { type: 'bearer' })
        .expect(200);
      if (['succeeded', 'failed'].includes(body.refresh.status)) {
        return body.refresh;
      }
      await sleep(10);
    }
    throw new Error('La actualización no terminó.');
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    root = await mkdtemp(join(tmpdir(), 'feed-refreshes-http-'));
    source = await startSourceServer();
    const stopped = { autoStart: false, pollMs: 1000, shutdownMs: 1000 };
    const module = await Test.createTestingModule({
      imports: [RulesetsModule, FeedsModule, FeedRefreshesModule],
    })
      .overrideProvider(POSTGRESQL_CONNECTION)
      .useValue(database.connection)
      .overrideProvider(DescopeService)
      .useValue({ validateSession })
      .overrideProvider(ARTIFACT_STORE_OPTIONS)
      .useValue({ root })
      .overrideProvider(CATALOG_IMPORT_OPTIONS)
      .useValue(stopped)
      .overrideProvider(EVALUATION_OPTIONS)
      .useValue(stopped)
      .overrideProvider(FEED_OPTIONS)
      .useValue({ autoStart: false, retainedFiles: 3 })
      .overrideProvider(FEED_REFRESH_OPTIONS)
      .useValue({
        autoStart: false,
        pollMs: 1_000,
        waitMs: 0,
        leaseMs: 60_000,
        shutdownMs: 200,
        retry: { baseDelayMs: 1, maxDelayMs: 4, maxAttempts: 3 },
        clock: () => new Date(),
      })
      // Solo en pruebas: http y localhost, para llegar al origen local.
      .overrideProvider(REMOTE_SOURCE_OPTIONS)
      .useValue({
        timeoutMs: 2_000,
        allowHttp: true,
        allowPrivateNetworks: true,
      })
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
    await pool().query('TRUNCATE estadistica_forms.app_users CASCADE');
    const users = app.get(UsersService);
    await users.provision(alice);
    await users.provision(bob);
    projectId = (await app.get(ProjectsService).create(alice, projectInput)).id;
    bobProjectId = (await app.get(ProjectsService).create(bob, projectInput))
      .id;
    await api()
      .post(`/api/v1/projects/${projectId}/rulesets`)
      .auth('alice-session', { type: 'bearer' })
      .send(rulesetBody())
      .expect(201);
    const { body } = await api()
      .post(`/api/v1/projects/${projectId}/feeds`)
      .auth('alice-session', { type: 'bearer' })
      .expect(201);
    feedId = body.feed.id;
    deliveryUrl = body.deliveryUrl;
    // La ruta PUT …/source solo admite https: el origen local se guarda por SQL.
    await pool().query(
      `UPDATE estadistica_forms.feeds
       SET source_url = $1, source_id_column = 'SKU', source_delimiter = 'comma'
       WHERE id = $2`,
      [source.url, feedId],
    );
    await putPolicy(policyBody()).expect(200);
  });
  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await source?.close();
      await database?.close();
      if (root) await rm(root, { recursive: true, force: true });
    }
  });

  it('recorrido: 202 en cola, la consulta sigue hasta published y la URL pública entrega el TSV', async () => {
    const { body: accepted } = await api()
      .post(refreshesOf())
      .auth('alice-session', { type: 'bearer' })
      .expect(202);

    expect(accepted).toEqual({
      refresh: expect.objectContaining({
        feedId,
        status: 'queued',
        stage: 'fetch',
        attempts: 0,
      }),
      statusUrl: `${refreshesOf()}/${accepted.refresh.id}`,
    });
    expect(JSON.stringify(accepted)).not.toContain('token');
    const finished = await drive(accepted.statusUrl);
    expect(finished).toMatchObject({
      status: 'succeeded',
      stage: 'publish',
      outcome: 'published',
      snapshotId: expect.any(String),
      evaluationId: expect.any(String),
      finishedAt: expect.any(String),
    });
    await api()
      .get(deliveryUrl)
      .expect(200)
      .expect('content-type', 'text/tab-separated-values; charset=utf-8');
  });

  describe('PUT …/policy', () => {
    it('guarda la política con las versiones vigentes del motor y del perfil', async () => {
      const { body } = await putPolicy(
        policyBody({ maxInvalid: 3, maxExcluded: 4, maxDropPercent: 15 }),
      ).expect(200);

      expect(body.feed.policy).toEqual({
        rulesetRevision: 1,
        maxInvalid: 3,
        maxExcluded: 4,
        maxDropPercent: 15,
        engineVersion: expect.any(String),
        profileVersion: expect.stringMatching(/^google_merchant@/),
        approvedAt: expect.any(String),
      });
    });

    it('una revisión de reglas que no existe: 404', async () => {
      await putPolicy(policyBody({ rulesetRevision: 99 }))
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('RULESET_NOT_FOUND')),
        );
    });

    it('valida enteros en rango y no admite campos de más', async () => {
      await putPolicy(
        policyBody({
          rulesetRevision: 0,
          maxInvalid: -1,
          maxExcluded: 5001,
          maxDropPercent: 101,
        }),
      )
        .expect(400)
        .expect(({ body }) =>
          expect(
            body.issues.map((issue: { field: string }) => issue.field).sort(),
          ).toEqual([
            'maxDropPercent',
            'maxExcluded',
            'maxInvalid',
            'rulesetRevision',
          ]),
        );
      await putPolicy(policyBody({ engineVersion: '9' })).expect(400);
      await putPolicy({}).expect(400);
    });

    it('Bob no cambia la política del feed de Alice', async () => {
      await putPolicy(policyBody(), 'bob-session').expect(404);
      await putPolicy(policyBody(), 'bob-session', bobProjectId).expect(404);
    });
  });

  it('sin política aprobada no se puede disparar: 409', async () => {
    await pool().query(
      `UPDATE estadistica_forms.feeds SET
         policy_ruleset_revision = NULL, policy_max_invalid = NULL,
         policy_max_excluded = NULL, policy_max_drop_percent = NULL,
         policy_engine_version = NULL, policy_profile_version = NULL,
         policy_approved_at = NULL`,
    );

    await api()
      .post(refreshesOf())
      .auth('alice-session', { type: 'bearer' })
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('FEED_POLICY_NOT_APPROVED')),
      );
  });

  it('una segunda actualización activa: 409', async () => {
    await api()
      .post(refreshesOf())
      .auth('alice-session', { type: 'bearer' })
      .expect(202);

    await api()
      .post(refreshesOf())
      .auth('alice-session', { type: 'bearer' })
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('FEED_REFRESH_ALREADY_ACTIVE')),
      );
  });

  it('sin fuente configurada: 409', async () => {
    await pool().query(
      `UPDATE estadistica_forms.feeds
       SET source_url = NULL, source_id_column = NULL, source_delimiter = NULL`,
    );

    await api()
      .post(refreshesOf())
      .auth('alice-session', { type: 'bearer' })
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('FEED_SOURCE_NOT_CONFIGURED')),
      );
  });

  it('Bob no dispara ni consulta las actualizaciones del feed de Alice', async () => {
    const { body } = await api()
      .post(refreshesOf())
      .auth('alice-session', { type: 'bearer' })
      .expect(202);

    await api()
      .post(refreshesOf())
      .auth('bob-session', { type: 'bearer' })
      .expect(404);
    await api()
      .post(refreshesOf(bobProjectId))
      .auth('bob-session', { type: 'bearer' })
      .expect(404);
    await api()
      .get(`${refreshesOf(bobProjectId)}/${body.refresh.id}`)
      .auth('bob-session', { type: 'bearer' })
      .expect(404);
  });

  it('una actualización inexistente, ids que no son UUID y sin sesión', async () => {
    await api()
      .get(`${refreshesOf()}/${randomUUID()}`)
      .auth('alice-session', { type: 'bearer' })
      .expect(404)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('FEED_REFRESH_NOT_FOUND')),
      );
    await api()
      .get(`${refreshesOf()}/no-es-uuid`)
      .auth('alice-session', { type: 'bearer' })
      .expect(400);
    await api()
      .post(refreshesOf(projectId, 'no-es-uuid'))
      .auth('alice-session', { type: 'bearer' })
      .expect(400);
    await api().post(refreshesOf()).expect(401);
    await api().get(`${refreshesOf()}/${randomUUID()}`).expect(401);
  });
});
