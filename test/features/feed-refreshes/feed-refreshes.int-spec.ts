import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { ArtifactStore } from '../../../src/artifacts/artifact.store.js';
import { ARTIFACT_STORE_OPTIONS } from '../../../src/artifacts/artifacts.types.js';
import { DescopeService } from '../../../src/auth/descope.service.js';
import { CatalogImportRepository } from '../../../src/catalog-import/catalog-import.repository.js';
import { CatalogImportWorker } from '../../../src/catalog-import/catalog-import.worker.js';
import { CATALOG_IMPORT_OPTIONS } from '../../../src/catalog-import/import.types.js';
import { POSTGRESQL_CONNECTION } from '../../../src/database/postgresql.connection.js';
import { publicError } from '../../../src/common/http/public-error.js';
import { PrismaService } from '../../../src/database/prisma.service.js';
import { EvaluationsRepository } from '../../../src/evaluations/evaluations.repository.js';
import { EVALUATION_OPTIONS } from '../../../src/evaluations/evaluations.types.js';
import { EvaluationWorker } from '../../../src/evaluations/evaluations.worker.js';
import { FeedRefreshScheduler } from '../../../src/feed-refreshes/feed-refresh.scheduler.js';
import { FeedRefreshSteps } from '../../../src/feed-refreshes/feed-refresh.steps.js';
import { FeedRefreshWorker } from '../../../src/feed-refreshes/feed-refresh.worker.js';
import { FeedRefreshesModule } from '../../../src/feed-refreshes/feed-refreshes.module.js';
import { FeedRefreshesRepository } from '../../../src/feed-refreshes/feed-refreshes.repository.js';
import { FeedRefreshesService } from '../../../src/feed-refreshes/feed-refreshes.service.js';
import {
  FEED_REFRESH_OPTIONS,
  type FeedRefreshOptions,
} from '../../../src/feed-refreshes/feed-refreshes.types.js';
import { FeedsModule } from '../../../src/feeds/feeds.module.js';
import { FeedsRepository } from '../../../src/feeds/feeds.repository.js';
import { FeedsService } from '../../../src/feeds/feeds.service.js';
import { FEED_OPTIONS } from '../../../src/feeds/feeds.types.js';
import { ProjectsService } from '../../../src/projects/projects.service.js';
import { REMOTE_SOURCE_OPTIONS } from '../../../src/remote-source/remote-source.types.js';
import { RulesetsRepository } from '../../../src/rulesets/rulesets.repository.js';
import { UsersService } from '../../../src/users/users.service.js';
import {
  CATALOG_RULESET,
  mixedCatalog,
} from '../evaluations/support/snapshot-fixtures.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';
import {
  catalogCsv,
  duplicatedCatalogCsv,
  startSourceServer,
} from './support/refresh-fixtures.js';

type RefreshRow = {
  status: string;
  stage: string;
  attempts: number;
  outcome: string | null;
  error: { code: string } | null;
  snapshot_id: string | null;
  import_job_id: string | null;
  evaluation_id: string | null;
  lease_until: Date | null;
  execution_token: string | null;
};

const apiFailure = (code: string, status: number) =>
  expect.objectContaining({
    status,
    response: expect.objectContaining({ code }),
  });

/** Esperas de milisegundos: las pruebas no esperan minutos para reintentar. */
const TEST_OPTIONS: FeedRefreshOptions = {
  autoStart: false,
  pollMs: 1_000,
  waitMs: 0,
  leaseMs: 60_000,
  shutdownMs: 200,
  retry: { baseDelayMs: 1, maxDelayMs: 4, maxAttempts: 3 },
  clock: () => new Date(),
};

// PGlite es de una sola conexión: estas pruebas no demuestran dos workers
// reclamando a la vez (SKIP LOCKED) ni la espera de un UPDATE concurrente. Sí
// demuestran, en secuencia, que un token antiguo o un lease vencido no escriben,
// la recuperación de leases, los reintentos con run_after y la idempotencia de
// cada paso (R4 del plan feeds&publications).
describe('Actualizaciones de feeds con worker, PGlite y un origen HTTP local', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let module: TestingModule;
  let root: string;
  let source: Awaited<ReturnType<typeof startSourceServer>>;
  let repository: FeedRefreshesRepository;
  let refreshes: FeedRefreshesService;
  let steps: FeedRefreshSteps;
  let worker: FeedRefreshWorker;
  let ownerId: string;
  let projectId: string;
  let otherProjectId: string;
  let feedId: string;

  const pool = () => database.connection.pool;

  async function readRefresh(id: string): Promise<RefreshRow> {
    const { rows } = await pool().query<RefreshRow>(
      `SELECT status, stage, attempts, outcome, error, snapshot_id,
              import_job_id, evaluation_id, lease_until, execution_token
       FROM estadistica_forms.feed_refreshes WHERE id = $1`,
      [id],
    );
    return rows[0];
  }

  /** Mueve los tres workers hasta que la actualización termine. */
  async function drive(id: string) {
    for (let round = 0; round < 100; round += 1) {
      await worker.runUntilIdle();
      await module.get(CatalogImportWorker).runUntilIdle();
      await module.get(EvaluationWorker).runUntilIdle();
      const refresh = await readRefresh(id);
      if (refresh.status === 'succeeded' || refresh.status === 'failed') {
        return refresh;
      }
      await sleep(10);
    }
    throw new Error('La actualización no terminó.');
  }

  async function approvePolicy(limits: {
    maxInvalid?: number;
    maxExcluded?: number;
    maxDropPercent?: number;
  }) {
    await module.get(FeedsService).approvePolicy(alice, projectId, feedId, {
      rulesetRevision: 1,
      maxInvalid: limits.maxInvalid ?? 5000,
      maxExcluded: limits.maxExcluded ?? 5000,
      maxDropPercent: limits.maxDropPercent ?? 100,
    });
  }

  async function trigger() {
    return (await refreshes.trigger(alice, projectId, feedId)).refresh.id;
  }

  /** Vence el lease con el reloj de la base, como si el worker se colgara. */
  async function expireLease(id: string) {
    await pool().query(
      `UPDATE estadistica_forms.feed_refreshes
       SET lease_until = now() - interval '1 second' WHERE id = $1`,
      [id],
    );
  }

  async function makeReady(id: string) {
    await pool().query(
      `UPDATE estadistica_forms.feed_refreshes
       SET run_after = now() - interval '1 second' WHERE id = $1`,
      [id],
    );
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    root = await mkdtemp(join(tmpdir(), 'feed-refreshes-'));
    source = await startSourceServer();
    const stopped = { autoStart: false, pollMs: 1000, shutdownMs: 1000 };
    module = await Test.createTestingModule({
      imports: [FeedsModule, FeedRefreshesModule],
    })
      .overrideProvider(POSTGRESQL_CONNECTION)
      .useValue(database.connection)
      .overrideProvider(ARTIFACT_STORE_OPTIONS)
      .useValue({ root })
      .overrideProvider(DescopeService)
      .useValue({})
      .overrideProvider(CATALOG_IMPORT_OPTIONS)
      .useValue(stopped)
      .overrideProvider(EVALUATION_OPTIONS)
      .useValue(stopped)
      .overrideProvider(FEED_OPTIONS)
      .useValue({ autoStart: false, retainedFiles: 3 })
      .overrideProvider(FEED_REFRESH_OPTIONS)
      .useValue(TEST_OPTIONS)
      // Solo en pruebas: http y localhost, para llegar al origen local.
      .overrideProvider(REMOTE_SOURCE_OPTIONS)
      .useValue({
        timeoutMs: 2_000,
        allowHttp: true,
        allowPrivateNetworks: true,
      })
      .compile();
    await module.init();
    repository = module.get(FeedRefreshesRepository);
    refreshes = module.get(FeedRefreshesService);
    steps = module.get(FeedRefreshSteps);
    worker = module.get(FeedRefreshWorker);
  });
  beforeEach(async () => {
    await pool().query('TRUNCATE estadistica_forms.app_users CASCADE');
    // TRUNCATE borra las filas, no los archivos: cada prueba empieza sin ellos.
    for (const folder of ['tmp', 'exports', 'feeds']) {
      await rm(join(root, folder), { recursive: true, force: true });
    }
    await module.get(ArtifactStore).onModuleInit();
    source.state.hits = 0;
    source.state.handler = (_request, response) => response.end(catalogCsv());
    const users = module.get(UsersService);
    ownerId = (await users.provision(alice)).id;
    const bobId = (await users.provision(bob)).id;
    const projects = module.get(ProjectsService);
    projectId = (await projects.create(alice, projectInput)).id;
    otherProjectId = (await projects.create(bob, projectInput)).id;
    const prisma = module.get(PrismaService);
    await new RulesetsRepository(prisma).create(
      ownerId,
      projectId,
      CATALOG_RULESET,
    );
    await new RulesetsRepository(prisma).create(
      bobId,
      otherProjectId,
      CATALOG_RULESET,
    );
    feedId = (await module.get(FeedsService).create(alice, projectId)).feed.id;
    // El DTO solo admite https; el repositorio guarda lo que recibe.
    await module.get(FeedsRepository).setSource({
      ownerId,
      projectId,
      feedId,
      source: { url: source.url, idColumn: 'SKU', delimiter: 'comma' },
      updatedAt: new Date().toISOString(),
    });
    // Política permisiva: cada prueba de E5 la endurece cuando lo necesita.
    await approvePolicy({});
  });
  afterAll(async () => {
    try {
      await module?.close();
    } finally {
      await source?.close();
      await database?.close();
      if (root) await rm(root, { recursive: true, force: true });
    }
  });

  describe('disparar', () => {
    it('encola en fetch, sin lease ni token, y lo consulta solo el propietario', async () => {
      const { refresh, statusUrl } = await refreshes.trigger(
        alice,
        projectId,
        feedId,
      );

      expect(refresh).toEqual({
        id: expect.any(String),
        feedId,
        status: 'queued',
        stage: 'fetch',
        attempts: 0,
        outcome: null,
        snapshotId: null,
        evaluationId: null,
        runAfter: expect.any(String),
        error: null,
        scheduledFor: null,
        createdAt: expect.any(String),
        finishedAt: null,
      });
      expect(statusUrl).toBe(
        `/api/v1/projects/${projectId}/feeds/${feedId}/refreshes/${refresh.id}`,
      );
      await expect(
        refreshes.findOne(alice, projectId, feedId, refresh.id),
      ).resolves.toEqual(refresh);
      await expect(
        refreshes.findOne(bob, otherProjectId, feedId, refresh.id),
      ).rejects.toEqual(apiFailure('FEED_REFRESH_NOT_FOUND', 404));
    });

    it('una sola actualización activa por feed', async () => {
      await trigger();

      await expect(refreshes.trigger(alice, projectId, feedId)).rejects.toEqual(
        apiFailure('FEED_REFRESH_ALREADY_ACTIVE', 409),
      );
    });

    it('sin política aprobada no se puede disparar', async () => {
      await pool().query(
        `UPDATE estadistica_forms.feeds SET
           policy_ruleset_revision = NULL, policy_max_invalid = NULL,
           policy_max_excluded = NULL, policy_max_drop_percent = NULL,
           policy_engine_version = NULL, policy_profile_version = NULL,
           policy_approved_at = NULL`,
      );

      await expect(refreshes.trigger(alice, projectId, feedId)).rejects.toEqual(
        apiFailure('FEED_POLICY_NOT_APPROVED', 409),
      );
    });

    it('guarda la generación del feed al disparar', async () => {
      const id = await trigger();

      const { rows } = await pool().query(
        'SELECT expected_generation FROM estadistica_forms.feed_refreshes WHERE id = $1',
        [id],
      );
      expect(rows).toEqual([{ expected_generation: 0 }]);
    });

    it('sin fuente no se puede disparar; tampoco en un feed ajeno', async () => {
      await pool().query(
        `UPDATE estadistica_forms.feeds
         SET source_url = NULL, source_id_column = NULL, source_delimiter = NULL`,
      );

      await expect(refreshes.trigger(alice, projectId, feedId)).rejects.toEqual(
        apiFailure('FEED_SOURCE_NOT_CONFIGURED', 409),
      );
      await expect(
        refreshes.trigger(bob, otherProjectId, feedId),
      ).rejects.toEqual(apiFailure('FEED_NOT_FOUND', 404));
    });
  });

  describe('recorrido', () => {
    it('descarga, importa, evalúa, exporta y publica sin gastar intentos', async () => {
      const id = await trigger();

      const refresh = await drive(id);

      expect(refresh).toMatchObject({
        status: 'succeeded',
        stage: 'publish',
        attempts: 0,
        outcome: 'published',
        error: null,
        lease_until: null,
        execution_token: null,
      });
      expect(source.state.hits).toBe(1);
      const { rows } = await pool().query(
        `SELECT s.status AS snapshot, j.status AS job, e.status AS evaluation
         FROM estadistica_forms.catalog_snapshots s
         JOIN estadistica_forms.catalog_import_jobs j ON j.snapshot_id = s.id
         JOIN estadistica_forms.evaluations e ON e.snapshot_id = s.id
         WHERE s.id = $1 AND j.id = $2 AND e.id = $3`,
        [refresh.snapshot_id, refresh.import_job_id, refresh.evaluation_id],
      );
      expect(rows).toEqual([
        { snapshot: 'ready', job: 'succeeded', evaluation: 'succeeded' },
      ]);
      expect(await readdir(join(root, 'tmp'))).toEqual([]);
      const feed = await module
        .get(FeedsService)
        .findOne(alice, projectId, feedId);
      expect(feed.generation).toBe(1);
      expect(feed.publishedVersion).toMatchObject({
        evaluationId: refresh.evaluation_id,
        publishedBy: 'refresh',
        rowCount: 2,
      });
    });
  });

  describe('lease y token (D3)', () => {
    it('un token antiguo no escribe tras recuperar el trabajo; el nuevo sí', async () => {
      const id = await trigger();
      const first = (await repository.claim(60_000))!;
      await expireLease(id);
      await repository.recoverExpiredLeases(TEST_OPTIONS.retry);
      await makeReady(id);
      const second = (await repository.claim(60_000))!;

      expect(second.token).not.toBe(first.token);
      expect(second.attempts).toBe(1);
      await expect(repository.advance(first, 'import')).resolves.toBe(false);
      await expect(repository.succeed(first, 'published')).resolves.toBe(false);
      await expect(
        repository.savePlannedIds(first, { snapshotId: randomUUID() }),
      ).resolves.toBe(false);
      await expect(repository.requeue(first, 0)).resolves.toBe(false);
      await expect(
        repository.fail(first, {
          attempts: 9,
          error: { code: 'INTERNAL_ERROR', message: { es: 'x', en: 'x' } },
        }),
      ).resolves.toBe(false);
      expect(await readRefresh(id)).toMatchObject({
        status: 'running',
        stage: 'fetch',
        attempts: 1,
        snapshot_id: null,
        execution_token: second.token,
      });
      await expect(repository.advance(second, 'import')).resolves.toBe(true);
    });

    it('con el lease vencido el token deja de valer aunque nadie lo haya recuperado aún', async () => {
      const id = await trigger();
      const claim = (await repository.claim(60_000))!;
      await expireLease(id);

      await expect(repository.advance(claim, 'import')).resolves.toBe(false);
      expect((await readRefresh(id)).stage).toBe('fetch');
    });

    it('recuperar un lease vencido cuenta como fallo temporal hasta agotar los intentos', async () => {
      const id = await trigger();
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await makeReady(id);
        expect(await repository.claim(60_000)).not.toBeNull();
        await expireLease(id);
        await repository.recoverExpiredLeases(TEST_OPTIONS.retry);
      }

      expect(await readRefresh(id)).toMatchObject({
        status: 'failed',
        attempts: 3,
        error: expect.objectContaining({ code: 'REFRESH_LEASE_EXPIRED' }),
        lease_until: null,
        execution_token: null,
      });
    });

    it('si el proceso cae tras aceptar la importación, el reintento no descarga otra vez', async () => {
      const id = await trigger();
      const claim = (await repository.claim(60_000))!;
      // El paso fetch termina (descarga y acepta) pero el worker cae antes de
      // guardar el avance: el trabajo sigue en fetch con los ids previstos.
      await steps.run(claim, new AbortController().signal);
      const planned = await readRefresh(id);
      expect(planned.stage).toBe('fetch');
      expect(planned.snapshot_id).not.toBeNull();
      await expireLease(id);
      await repository.recoverExpiredLeases(TEST_OPTIONS.retry);
      await makeReady(id);

      const refresh = await drive(id);

      expect(source.state.hits).toBe(1);
      expect(refresh).toMatchObject({
        status: 'succeeded',
        attempts: 1,
        snapshot_id: planned.snapshot_id,
      });
      const { rows } = await pool().query(
        'SELECT count(*)::int AS count FROM estadistica_forms.catalog_snapshots',
      );
      expect(rows[0].count).toBe(1);
    });
  });

  describe('reintentos y fallos (D4)', () => {
    it('un 503 del origen se reintenta con espera y falla al tercer intento', async () => {
      source.state.handler = (_request, response) =>
        response.writeHead(503).end();
      const id = await trigger();

      const refresh = await drive(id);

      expect(refresh).toMatchObject({
        status: 'failed',
        stage: 'fetch',
        attempts: 3,
        error: expect.objectContaining({ code: 'SOURCE_HTTP_ERROR' }),
      });
      expect(source.state.hits).toBe(3);
    });

    it('retry_wait guarda el error y no se reclama antes de run_after', async () => {
      const id = await trigger();
      const claim = (await repository.claim(60_000))!;
      await expect(
        repository.retryLater(claim, {
          attempts: 1,
          delayMs: 60_000,
          error: { code: 'SOURCE_HTTP_ERROR', message: { es: 'x', en: 'x' } },
          stage: 'fetch',
          forget: {},
        }),
      ).resolves.toBe(true);

      const { rows } = await pool().query<{ waiting: boolean }>(
        `SELECT run_after > now() + interval '50 seconds' AS waiting
         FROM estadistica_forms.feed_refreshes WHERE id = $1`,
        [id],
      );
      expect(rows[0].waiting).toBe(true);
      await expect(repository.claim(60_000)).resolves.toBeNull();
    });

    it('un 404 del origen no se reintenta', async () => {
      source.state.handler = (_request, response) =>
        response.writeHead(404).end();
      const id = await trigger();

      const refresh = await drive(id);

      expect(refresh).toMatchObject({ status: 'failed', attempts: 1 });
      expect(source.state.hits).toBe(1);
    });

    it('un CSV con ids repetidos falla en la importación, sin reintentos', async () => {
      source.state.handler = (_request, response) =>
        response.end(duplicatedCatalogCsv());
      const id = await trigger();

      const refresh = await drive(id);

      expect(refresh).toMatchObject({
        status: 'failed',
        stage: 'import',
        attempts: 1,
        error: expect.objectContaining({ code: 'CSV_DUPLICATE_ID' }),
      });
    });

    it('una importación interrumpida se repite desde la descarga con ids nuevos', async () => {
      const id = await trigger();
      await worker.runUntilIdle();
      const first = await readRefresh(id);
      expect(first.stage).toBe('import');
      // La importación agotó sus intentos y terminó interrumpida (jobs&files, D4).
      const imports = new CatalogImportRepository(module.get(PrismaService));
      const importJob = await imports.claim();
      if (!importJob)
        throw new Error('Falta la importación de la actualización');
      await imports.fail(importJob, publicError('IMPORT_INTERRUPTED'));
      await makeReady(id);

      const refresh = await drive(id);

      expect(refresh).toMatchObject({ status: 'succeeded', attempts: 1 });
      expect(refresh.snapshot_id).not.toBe(first.snapshot_id);
      expect(source.state.hits).toBe(2);
    });

    it('si se quita la política después de disparar, falla sin reintentos', async () => {
      const id = await trigger();
      await pool().query(
        `UPDATE estadistica_forms.feeds SET
           policy_ruleset_revision = NULL, policy_max_invalid = NULL,
           policy_max_excluded = NULL, policy_max_drop_percent = NULL,
           policy_engine_version = NULL, policy_profile_version = NULL,
           policy_approved_at = NULL`,
      );

      const refresh = await drive(id);

      expect(refresh).toMatchObject({
        status: 'failed',
        stage: 'evaluate',
        attempts: 1,
        error: expect.objectContaining({ code: 'REFRESH_POLICY_MISSING' }),
      });
    });

    it('si se borra la fuente antes de descargar, falla sin reintentos', async () => {
      const id = await trigger();
      await pool().query(
        `UPDATE estadistica_forms.feeds
         SET source_url = NULL, source_id_column = NULL, source_delimiter = NULL`,
      );

      const refresh = await drive(id);

      expect(refresh).toMatchObject({
        status: 'failed',
        error: expect.objectContaining({ code: 'REFRESH_SOURCE_MISSING' }),
      });
      expect(source.state.hits).toBe(0);
    });
  });

  describe('proyecto ocupado (R2)', () => {
    it('con otra evaluación activa espera en evaluate sin gastar intentos', async () => {
      const id = await trigger();
      await worker.runUntilIdle();
      await module.get(CatalogImportWorker).runUntilIdle();
      const snapshotId = (await readRefresh(id)).snapshot_id!;
      await new EvaluationsRepository(module.get(PrismaService)).accept({
        evaluationId: randomUUID(),
        ownerId,
        projectId,
        snapshotId,
        rulesetRevision: 1,
      });
      await makeReady(id);

      await worker.runUntilIdle();

      expect(await readRefresh(id)).toMatchObject({
        status: 'queued',
        stage: 'evaluate',
        attempts: 0,
        lease_until: null,
      });
    });

    it('con otra importación activa espera en fetch y no deja el CSV en tmp', async () => {
      const id = await trigger();
      await worker.runUntilIdle();
      // La importación de esta misma actualización sigue en cola. Se devuelve el
      // trabajo a fetch sin ids: la nueva aceptación choca con esa importación
      // activa del proyecto (IMPORT_ALREADY_ACTIVE).
      await pool().query(
        `UPDATE estadistica_forms.feed_refreshes
         SET stage = 'fetch', snapshot_id = NULL, import_job_id = NULL
         WHERE id = $1`,
        [id],
      );
      await makeReady(id);

      await worker.runUntilIdle();

      expect(await readRefresh(id)).toMatchObject({
        status: 'queued',
        stage: 'fetch',
        attempts: 0,
      });
      expect(await readdir(join(root, 'tmp'))).toEqual([]);
    });
  });

  describe('política y publicación (E5, D11)', () => {
    const feedsService = () => module.get(FeedsService);

    async function publishedState() {
      const feed = await feedsService().findOne(alice, projectId, feedId);
      const { rows } = await pool().query(
        'SELECT count(*)::int AS count FROM estadistica_forms.feed_versions',
      );
      return { generation: feed.generation, versions: rows[0].count };
    }

    it('con más inválidos de los permitidos queda pendiente de revisión y no publica', async () => {
      await approvePolicy({ maxInvalid: 1 });
      const id = await trigger();

      const refresh = await drive(id);

      expect(refresh).toMatchObject({
        status: 'succeeded',
        stage: 'publish',
        outcome: 'needs_review',
        error: expect.objectContaining({
          code: 'REFRESH_POLICY_TOO_MANY_INVALID',
        }),
      });
      expect(await publishedState()).toEqual({ generation: 0, versions: 0 });
    });

    it('si cambiaron el motor o el perfil desde la aprobación, pide revisión', async () => {
      await pool().query(
        "UPDATE estadistica_forms.feeds SET policy_profile_version = 'google_merchant@2000-01-01'",
      );
      const id = await trigger();

      const refresh = await drive(id);

      expect(refresh).toMatchObject({
        outcome: 'needs_review',
        error: expect.objectContaining({
          code: 'REFRESH_POLICY_VERSIONS_CHANGED',
        }),
      });
    });

    it('una caída de productos mayor que la permitida conserva la publicación anterior', async () => {
      await drive(await trigger());
      const before = await feedsService().findOne(alice, projectId, feedId);
      source.state.handler = (_request, response) =>
        response.end(catalogCsv(mixedCatalog(3)));
      await approvePolicy({ maxDropPercent: 10 });

      const refresh = await drive(await trigger());

      expect(refresh).toMatchObject({
        outcome: 'needs_review',
        error: expect.objectContaining({ code: 'REFRESH_POLICY_PRODUCT_DROP' }),
      });
      const after = await feedsService().findOne(alice, projectId, feedId);
      expect(after.publishedVersion).toEqual(before.publishedVersion);
      expect(after.generation).toBe(1);
    });

    it('si el TSV es el mismo que el publicado, termina sin versión nueva', async () => {
      await drive(await trigger());

      const refresh = await drive(await trigger());

      expect(refresh).toMatchObject({ outcome: 'unchanged', error: null });
      expect(await publishedState()).toEqual({ generation: 1, versions: 1 });
    });

    it('si alguien publicó después del disparo, no pisa la publicación', async () => {
      await drive(await trigger());
      source.state.handler = (_request, response) =>
        response.end(catalogCsv(mixedCatalog(9)));
      const id = await trigger();
      // La generación cambió entre el disparo y la publicación: se simula
      // guardando en la actualización la anterior a la vigente.
      await pool().query(
        'UPDATE estadistica_forms.feed_refreshes SET expected_generation = 0 WHERE id = $1',
        [id],
      );

      const refresh = await drive(id);

      expect(refresh).toMatchObject({
        outcome: 'conflict',
        error: expect.objectContaining({
          code: 'REFRESH_PUBLICATION_CONFLICT',
        }),
      });
      expect(await publishedState()).toEqual({ generation: 1, versions: 1 });
    });

    it('un reclamo que ya no es el vigente no publica: la transacción se deshace', async () => {
      // Llevar la actualización hasta publish y dejarla lista para reclamarla.
      await approvePolicy({ maxInvalid: 0 });
      const id = await drive(await trigger()).then(() =>
        pool()
          .query('SELECT id FROM estadistica_forms.feed_refreshes')
          .then(({ rows }) => rows[0].id as string),
      );
      await approvePolicy({});
      await pool().query(
        `UPDATE estadistica_forms.feed_refreshes
         SET status = 'queued', outcome = NULL, error = NULL, finished_at = NULL
         WHERE id = $1`,
        [id],
      );
      const claim = (await repository.claim(60_000))!;
      expect(claim.stage).toBe('publish');

      await expect(
        steps.run(
          { ...claim, token: randomUUID() },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ name: 'LostClaimError' });
      expect(await publishedState()).toEqual({ generation: 0, versions: 0 });
      expect(await readdir(join(root, 'feeds'))).toEqual([]);

      await expect(
        steps.run(claim, new AbortController().signal),
      ).resolves.toEqual({ kind: 'finished' });
      expect(await publishedState()).toEqual({ generation: 1, versions: 1 });
      expect(await readRefresh(id)).toMatchObject({
        status: 'succeeded',
        outcome: 'published',
        execution_token: null,
      });
    });
  });

  describe('programación diaria (E6, D10)', () => {
    const scheduler = () => module.get(FeedRefreshScheduler);
    /** 06:00 en Madrid el 3 de noviembre es 05:00 UTC (horario de invierno). */
    const beforeTime = new Date('2026-11-03T04:59:00Z');
    const atTime = new Date('2026-11-03T05:00:00Z');
    const nextDay = new Date('2026-11-04T05:30:00Z');

    async function schedule(enabled = true) {
      await module.get(FeedsService).setSchedule(alice, projectId, feedId, {
        enabled,
        refreshTime: '06:00',
        timeZone: 'Europe/Madrid',
      });
    }

    async function scheduledRows() {
      const { rows } = await pool().query<{ scheduled_for: string | null }>(
        `SELECT scheduled_for FROM estadistica_forms.feed_refreshes
         ORDER BY created_at, id`,
      );
      return rows.map((row) => row.scheduled_for);
    }

    it('encola una vez por fecha local aunque se llame varias veces', async () => {
      await schedule();

      await expect(scheduler().enqueueDue(beforeTime)).resolves.toBe(0);
      await expect(scheduler().enqueueDue(atTime)).resolves.toBe(1);
      await expect(scheduler().enqueueDue(atTime)).resolves.toBe(0);
      expect(await scheduledRows()).toEqual(['2026-11-03']);
    });

    it('al día siguiente encola otra, cuando la anterior ya terminó', async () => {
      await schedule();
      await scheduler().enqueueDue(atTime);
      const { rows } = await pool().query(
        'SELECT id FROM estadistica_forms.feed_refreshes',
      );
      await drive(rows[0].id);

      await expect(scheduler().enqueueDue(atTime)).resolves.toBe(0);
      await expect(scheduler().enqueueDue(nextDay)).resolves.toBe(1);
      expect(await scheduledRows()).toEqual(['2026-11-03', '2026-11-04']);
    });

    it('guarda la generación del feed, como el disparo manual', async () => {
      await schedule();
      await scheduler().enqueueDue(atTime);

      const { rows } = await pool().query(
        'SELECT expected_generation, status, stage FROM estadistica_forms.feed_refreshes',
      );
      expect(rows).toEqual([
        { expected_generation: 0, status: 'queued', stage: 'fetch' },
      ]);
    });

    it('desactivada, sin política o sin fuente no encola nada', async () => {
      await schedule(false);
      await expect(scheduler().enqueueDue(atTime)).resolves.toBe(0);

      await schedule(true);
      await pool().query(
        `UPDATE estadistica_forms.feeds SET
           policy_ruleset_revision = NULL, policy_max_invalid = NULL,
           policy_max_excluded = NULL, policy_max_drop_percent = NULL,
           policy_engine_version = NULL, policy_profile_version = NULL,
           policy_approved_at = NULL`,
      );
      await expect(scheduler().enqueueDue(atTime)).resolves.toBe(0);
      expect(await scheduledRows()).toEqual([]);
    });

    it('si hay una actualización manual activa espera a que termine, el mismo día', async () => {
      await schedule();
      const manual = await trigger();

      await expect(scheduler().enqueueDue(atTime)).resolves.toBe(0);
      await drive(manual);
      await expect(scheduler().enqueueDue(atTime)).resolves.toBe(1);
      // El orden por fecha de creación depende del reloj simulado: se compara
      // sin orden.
      expect((await scheduledRows()).sort()).toEqual(['2026-11-03', null]);
    });

    it('una zona que ya no es válida se registra y se salta', async () => {
      await schedule();
      await pool().query(
        "UPDATE estadistica_forms.feeds SET time_zone = 'Mars/Phobos'",
      );
      const logError = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await expect(scheduler().enqueueDue(atTime)).resolves.toBe(0);
      expect(logError).toHaveBeenCalledWith({
        code: 'FEED_SCHEDULE_INVALID',
        feedId,
      });
    });

    it('cada pasada del worker encola con su reloj y procesa lo encolado', async () => {
      await schedule();
      const clocked = new FeedRefreshWorker(repository, scheduler(), steps, {
        ...TEST_OPTIONS,
        clock: () => atTime,
      });

      await clocked.runUntilIdle();

      const { rows } = await pool().query(
        'SELECT scheduled_for, stage FROM estadistica_forms.feed_refreshes',
      );
      expect(rows).toEqual([{ scheduled_for: '2026-11-03', stage: 'import' }]);
    });
  });

  describe('estado del feed (E7, D12)', () => {
    const lastRefresh = async () =>
      (await module.get(FeedsService).findOne(alice, projectId, feedId))
        .lastRefresh;

    it('sin actualizaciones no hay última; después muestra la más reciente', async () => {
      expect(await lastRefresh()).toBeNull();

      const id = await trigger();
      expect(await lastRefresh()).toEqual({
        id,
        status: 'queued',
        stage: 'fetch',
        outcome: null,
        error: null,
        scheduledFor: null,
        createdAt: expect.any(String),
        finishedAt: null,
      });

      await drive(id);
      expect(await lastRefresh()).toMatchObject({
        id,
        status: 'succeeded',
        stage: 'publish',
        outcome: 'published',
        finishedAt: expect.any(String),
      });

      const second = await trigger();
      await drive(second);
      expect(await lastRefresh()).toMatchObject({
        id: second,
        outcome: 'unchanged',
      });
    });

    it('si la política no se cumple, el feed muestra el motivo', async () => {
      await approvePolicy({ maxExcluded: 0 });

      await drive(await trigger());

      expect(await lastRefresh()).toMatchObject({
        outcome: 'needs_review',
        error: expect.objectContaining({
          code: 'REFRESH_POLICY_TOO_MANY_EXCLUDED',
          message: expect.objectContaining({ es: expect.any(String) }),
        }),
      });
    });

    it('un fallo definitivo queda en el registro con códigos e ids, sin la URL', async () => {
      source.state.handler = (_request, response) =>
        response.writeHead(404).end();
      const logWarn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const id = await trigger();

      await drive(id);

      expect(logWarn).toHaveBeenCalledWith({
        code: 'FEED_REFRESH_FAILED',
        errorCode: 'SOURCE_HTTP_ERROR',
        feedId,
        refreshId: id,
      });
      expect(JSON.stringify(logWarn.mock.calls)).not.toContain(source.url);
      expect(await lastRefresh()).toMatchObject({
        status: 'failed',
        error: expect.objectContaining({ code: 'SOURCE_HTTP_ERROR' }),
      });
    });
  });

  describe('almacenamiento', () => {
    it('si no se puede guardar el CSV descargado, no lo deja en tmp y reintenta', async () => {
      const id = await trigger();
      await chmod(join(root, 'artifacts'), 0o500);
      try {
        await worker.runUntilIdle();
      } finally {
        await chmod(join(root, 'artifacts'), 0o700);
      }

      expect(await readRefresh(id)).toMatchObject({
        status: 'retry_wait',
        stage: 'fetch',
        attempts: 1,
        error: expect.objectContaining({ code: 'IMPORT_STORAGE_UNAVAILABLE' }),
      });
      expect(await readdir(join(root, 'tmp'))).toEqual([]);
    });
  });

  describe('apagado', () => {
    it('al apagar a mitad de descarga, el trabajo vuelve a la cola sin gastar intentos', async () => {
      source.state.handler = (_request, response) => {
        response.writeHead(200);
        response.write('"SKU"\n');
      };
      const id = await trigger();
      const isolated = new FeedRefreshWorker(
        repository,
        module.get(FeedRefreshScheduler),
        steps,
        { ...TEST_OPTIONS, autoStart: true, pollMs: 60_000 },
      );
      isolated.onApplicationBootstrap();
      await sleep(100);

      await isolated.onModuleDestroy();

      expect(await readRefresh(id)).toMatchObject({
        status: 'queued',
        stage: 'fetch',
        attempts: 0,
        lease_until: null,
        execution_token: null,
      });
      expect(await readdir(join(root, 'tmp'))).toEqual([]);
    });
  });

  it('un error inesperado se registra sin datos y se reintenta como interno', async () => {
    const id = await trigger();
    jest
      .spyOn(steps, 'run')
      .mockRejectedValueOnce(new Error(`fallo con ${source.url}`));
    const logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await worker.runUntilIdle();

    expect(await readRefresh(id)).toMatchObject({
      status: 'retry_wait',
      attempts: 1,
      error: expect.objectContaining({ code: 'INTERNAL_ERROR' }),
    });
    expect(logError).toHaveBeenCalledWith({
      code: 'FEED_REFRESH_STEP_FAILED',
      refreshId: id,
    });
    expect(JSON.stringify(logError.mock.calls)).not.toContain(source.url);
  });

  it('borrar el feed borra sus actualizaciones', async () => {
    await trigger();

    await pool().query(
      'DELETE FROM estadistica_forms.feeds WHERE project_id = $1',
      [projectId],
    );

    const { rows } = await pool().query(
      'SELECT count(*)::int AS count FROM estadistica_forms.feed_refreshes',
    );
    expect(rows[0].count).toBe(0);
  });
});
