import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { ArtifactStore } from '../../../src/artifacts/artifact.store.js';
import { CatalogImportRepository } from '../../../src/catalog-import/catalog-import.repository.js';
import { CatalogImportWorker } from '../../../src/catalog-import/catalog-import.worker.js';
import type {
  Acceptance,
  CatalogImportOptions,
  ClaimedImport,
} from '../../../src/catalog-import/import.types.js';
import { publicError } from '../../../src/common/http/public-error.js';
import { PrismaService } from '../../../src/database/prisma.service.js';
import { LostClaimError } from '../../../src/jobs/lease-sql.js';
import { ProjectsRepository } from '../../../src/projects/projects.repository.js';
import { UsersRepository } from '../../../src/users/users.repository.js';
import { alice, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';

/** Esperas de 1 ms: un reintento vuelve a estar listo casi al instante. */
const FAST_RETRY = { baseDelayMs: 1, maxDelayMs: 1, maxAttempts: 3 };

const ROW = { sourceRow: 1, externalId: '1', originalValues: { id: '1' } };

describe('Importación con lease, token y reintentos (jobs&files E2)', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let prisma: PrismaService;
  let repository: CatalogImportRepository;
  let store: ArtifactStore;
  let root: string;
  let options: CatalogImportOptions;
  let ownerId: string;
  let projectId: string;

  async function accept(csv = 'id,title\n1,Café\n2,Té\n') {
    const upload = await store.receive(Readable.from([Buffer.from(csv)]));
    const input: Acceptance = {
      snapshotId: randomUUID(),
      jobId: randomUUID(),
      projectId,
      ownerId,
      artifactKey: `${randomUUID()}.csv`,
      sourceHash: upload.hash,
      byteSize: upload.size,
      originalName: 'shop.csv',
      idColumn: 'id',
      delimiter: 'comma',
      requestId: randomUUID(),
    };
    await store.finalize(upload.filename, input.artifactKey);
    await repository.accept(input);
    return input;
  }

  async function claimOrThrow(): Promise<ClaimedImport> {
    const job = await repository.claim();
    if (!job) throw new Error('No había trabajo que reclamar');
    return job;
  }

  /** Simula que el proceso que lo llevaba cayó: su lease ya venció. */
  async function expireLease(jobId: string) {
    await database.connection.pool.query(
      `UPDATE estadistica_forms.catalog_import_jobs
       SET lease_until = now() - interval '1 second'
       WHERE id = $1`,
      [jobId],
    );
  }

  /** Deja listo ya un trabajo que espera su reintento. */
  async function makeReady(jobId: string) {
    await database.connection.pool.query(
      `UPDATE estadistica_forms.catalog_import_jobs
       SET run_after = now() - interval '1 second'
       WHERE id = $1`,
      [jobId],
    );
  }

  function readJob(jobId: string) {
    return prisma.catalogImportJob.findUniqueOrThrow({ where: { id: jobId } });
  }

  /** Segundos que le quedan al lease, medidos con el reloj de la base. */
  async function leaseSecondsLeft(jobId: string): Promise<number> {
    const { rows } = await database.connection.pool.query<{ left: number }>(
      `SELECT extract(epoch FROM lease_until - now())::float AS left
       FROM estadistica_forms.catalog_import_jobs
       WHERE id = $1`,
      [jobId],
    );
    return rows[0].left;
  }

  /** Segundos que faltan para que el reintento esté listo (reloj de la base). */
  async function secondsUntilReady(jobId: string): Promise<number> {
    const { rows } = await database.connection.pool.query<{ left: number }>(
      `SELECT extract(epoch FROM run_after - now())::float AS left
       FROM estadistica_forms.catalog_import_jobs
       WHERE id = $1`,
      [jobId],
    );
    return rows[0].left;
  }

  function countRows(snapshotId: string) {
    return prisma.catalogRow.count({ where: { snapshotId } });
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    prisma = new PrismaService(database.connection);
    await prisma.onModuleInit();
    repository = new CatalogImportRepository(prisma);
    root = await mkdtemp(join(tmpdir(), 'import-lease-'));
    options = {
      autoStart: false,
      pollMs: 1000,
      shutdownMs: 1000,
      retry: FAST_RETRY,
    };
    store = new ArtifactStore({ root });
    await store.onModuleInit();
  });

  beforeEach(async () => {
    await database.connection.pool.query(
      'TRUNCATE estadistica_forms.app_users CASCADE',
    );
    ownerId = (await new UsersRepository(prisma).provision(alice)).id;
    projectId = (
      await new ProjectsRepository(prisma).create(
        ownerId,
        'Alice',
        projectInput,
      )
    ).id;
  });

  afterAll(async () => {
    try {
      await prisma?.onModuleDestroy();
    } finally {
      await database?.close();
      if (root) await rm(root, { recursive: true, force: true });
    }
  });

  describe('reclamo', () => {
    it('da un token y un lease nuevos y deja el trabajo running', async () => {
      const input = await accept();
      const job = await claimOrThrow();

      const stored = await readJob(input.jobId);
      expect(job.token).toBe(stored.executionToken);
      expect(job.attempts).toBe(0);
      expect(stored.status).toBe('running');
      expect(await leaseSecondsLeft(input.jobId)).toBeGreaterThan(60);
    });

    it('no reclama un trabajo cuyo reintento todavía no toca', async () => {
      const input = await accept();
      const job = await claimOrThrow();
      expect(await repository.retryLater(job, 1, 60_000)).toBe(true);

      expect(await repository.claim()).toBeNull();
      await makeReady(input.jobId);
      expect(await repository.claim()).toMatchObject({ id: input.jobId });
    });

    it('cada lote renueva el lease', async () => {
      const input = await accept();
      const job = await claimOrThrow();
      await database.connection.pool.query(
        `UPDATE estadistica_forms.catalog_import_jobs
         SET lease_until = now() + interval '1 second'
         WHERE id = $1`,
        [input.jobId],
      );

      await repository.appendBatch(job, [ROW]);

      expect(await leaseSecondsLeft(input.jobId)).toBeGreaterThan(60);
      expect((await readJob(input.jobId)).processedRows).toBe(1);
    });
  });

  describe('token antiguo (fencing)', () => {
    it('tras recuperar un lease vencido, el token viejo no guarda lotes, no termina y no falla', async () => {
      const input = await accept();
      const stale = await claimOrThrow();
      await expireLease(input.jobId);
      await repository.recoverExpiredLeases(FAST_RETRY);
      await makeReady(input.jobId);
      const fresh = await claimOrThrow();
      expect(fresh.token).not.toBe(stale.token);

      await expect(repository.appendBatch(stale, [ROW])).rejects.toBeInstanceOf(
        LostClaimError,
      );
      await expect(
        repository.complete(stale, {
          headers: ['id'],
          count: 0,
          hash: stale.sourceHash,
          bytes: stale.byteSize,
        }),
      ).rejects.toBeInstanceOf(LostClaimError);
      expect(
        await repository.fail(stale, publicError('IMPORT_PROCESSING_FAILED')),
      ).toBe(false);
      expect(await repository.release(stale)).toBe(false);

      expect(await countRows(input.snapshotId)).toBe(0);
      expect(await readJob(input.jobId)).toMatchObject({
        status: 'running',
        executionToken: fresh.token,
      });
    });

    it('con el lease vencido y sin recuperar, el token todavía no puede escribir', async () => {
      const input = await accept();
      const job = await claimOrThrow();
      await expireLease(input.jobId);

      await expect(repository.appendBatch(job, [ROW])).rejects.toBeInstanceOf(
        LostClaimError,
      );
      expect(await countRows(input.snapshotId)).toBe(0);
    });
  });

  describe('recuperación de leases vencidos', () => {
    it('vuelve a la cola desde cero, gasta un intento y espera', async () => {
      const input = await accept();
      const job = await claimOrThrow();
      await repository.appendBatch(job, [ROW]);
      await expireLease(input.jobId);

      expect(
        await repository.recoverExpiredLeases({
          ...FAST_RETRY,
          baseDelayMs: 60_000,
          maxDelayMs: 60_000,
        }),
      ).toBe(1);

      const stored = await readJob(input.jobId);
      expect(stored).toMatchObject({
        status: 'queued',
        attempts: 1,
        processedRows: 0,
        startedAt: null,
        leaseUntil: null,
        executionToken: null,
      });
      expect(await secondsUntilReady(input.jobId)).toBeGreaterThan(30);
      expect(await countRows(input.snapshotId)).toBe(0);
      expect(
        await prisma.catalogSnapshot.findUniqueOrThrow({
          where: { id: input.snapshotId },
        }),
      ).toMatchObject({ status: 'pending' });
    });

    it('al agotar los intentos falla con IMPORT_INTERRUPTED', async () => {
      const input = await accept();
      for (let attempt = 1; attempt <= FAST_RETRY.maxAttempts; attempt += 1) {
        await makeReady(input.jobId);
        await claimOrThrow();
        await expireLease(input.jobId);
        await repository.recoverExpiredLeases(FAST_RETRY);
      }

      expect(await readJob(input.jobId)).toMatchObject({
        status: 'failed',
        attempts: FAST_RETRY.maxAttempts,
        error: { code: 'IMPORT_INTERRUPTED', requestId: input.requestId },
        leaseUntil: null,
      });
      expect(
        await repository.findSnapshot(ownerId, projectId, input.snapshotId),
      ).toMatchObject({ snapshot: { status: 'failed' } });
    });

    it('no toca un running con el lease vigente', async () => {
      const input = await accept();
      await claimOrThrow();

      expect(await repository.recoverExpiredLeases(FAST_RETRY)).toBe(0);
      expect(await readJob(input.jobId)).toMatchObject({ status: 'running' });
    });
  });

  describe('worker', () => {
    it('reintenta desde cero un error temporal y termina bien al segundo intento', async () => {
      const input = await accept();
      let opened = 0;
      const flaky = Object.create(store) as ArtifactStore;
      flaky.openRead = (key, signal) => {
        opened += 1;
        if (opened === 1) {
          throw Object.assign(new Error('disk hiccup'), { code: 'EIO' });
        }
        return store.openRead(key, signal);
      };
      const worker = new CatalogImportWorker(repository, flaky, options);

      await worker.runUntilIdle();
      expect(await readJob(input.jobId)).toMatchObject({
        status: 'queued',
        attempts: 1,
      });

      await makeReady(input.jobId);
      await worker.runUntilIdle();
      expect(await readJob(input.jobId)).toMatchObject({
        status: 'succeeded',
        attempts: 1,
        processedRows: 2,
        leaseUntil: null,
        executionToken: null,
      });
      expect(await countRows(input.snapshotId)).toBe(2);
    });

    it('un error de los datos termina al primer intento', async () => {
      const input = await accept('id,title\n1,a\n1,b\n');
      const worker = new CatalogImportWorker(repository, store, options);

      await worker.runUntilIdle();

      expect(await readJob(input.jobId)).toMatchObject({
        status: 'failed',
        attempts: 0,
        error: { code: 'CSV_DUPLICATE_ID' },
      });
    });

    it('un error temporal que se repite falla al agotar los intentos', async () => {
      const input = await accept();
      const broken = Object.create(store) as ArtifactStore;
      broken.openRead = () => {
        throw Object.assign(new Error('disk gone'), { code: 'EIO' });
      };
      const worker = new CatalogImportWorker(repository, broken, options);

      for (let attempt = 1; attempt <= FAST_RETRY.maxAttempts; attempt += 1) {
        await makeReady(input.jobId);
        await worker.runUntilIdle();
      }

      expect(await readJob(input.jobId)).toMatchObject({
        status: 'failed',
        attempts: FAST_RETRY.maxAttempts,
        error: { code: 'IMPORT_PROCESSING_FAILED' },
      });
    });

    it('al apagar suelta el trabajo: vuelve a la cola sin gastar intento ni dejar filas', async () => {
      const input = await accept();
      let entered!: () => void;
      const reading = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const stalled = Object.create(store) as ArtifactStore;
      stalled.openRead = (_key, signal) => {
        entered();
        return new Readable({ read() {}, signal });
      };
      const worker = new CatalogImportWorker(repository, stalled, {
        ...options,
        shutdownMs: 1,
      });

      const pass = worker.runUntilIdle();
      await reading;
      await worker.onModuleDestroy();
      await pass;

      expect(await readJob(input.jobId)).toMatchObject({
        status: 'queued',
        attempts: 0,
        processedRows: 0,
        leaseUntil: null,
        executionToken: null,
      });
      expect(await countRows(input.snapshotId)).toBe(0);
    });

    it('la pasada recupera un lease vencido, gasta un intento y lo termina', async () => {
      const input = await accept();
      await claimOrThrow();
      await expireLease(input.jobId);
      const worker = new CatalogImportWorker(repository, store, options);

      // Con 1 ms de espera la misma pasada puede retomarlo; si no, la siguiente.
      await worker.runUntilIdle();
      await makeReady(input.jobId);
      await worker.runUntilIdle();

      expect(await readJob(input.jobId)).toMatchObject({
        status: 'succeeded',
        attempts: 1,
      });
    });
  });

  describe('restricciones de la base', () => {
    it('running exige lease y token, y los demás estados no los admiten', async () => {
      const input = await accept();
      await expect(
        database.connection.pool.query(
          `UPDATE estadistica_forms.catalog_import_jobs
           SET lease_until = now() + interval '1 minute',
               execution_token = 'x'
           WHERE id = $1`,
          [input.jobId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await claimOrThrow();
      await expect(
        database.connection.pool.query(
          `UPDATE estadistica_forms.catalog_import_jobs
           SET execution_token = NULL
           WHERE id = $1`,
          [input.jobId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });
});
