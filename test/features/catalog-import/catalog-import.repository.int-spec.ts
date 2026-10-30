import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { PrismaService } from '../../../src/database/prisma.service.js';
import { ProjectsRepository } from '../../../src/projects/projects.repository.js';
import { UsersRepository } from '../../../src/users/users.repository.js';
import { CatalogImportRepository } from '../../../src/catalog-import/catalog-import.repository.js';
import { CatalogImportWorker } from '../../../src/catalog-import/catalog-import.worker.js';
import { ArtifactStore } from '../../../src/catalog-import/artifact.store.js';
import type {
  Acceptance,
  CatalogImportOptions,
} from '../../../src/catalog-import/import.types.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';
import { publicError } from '../../../src/common/http/public-error.js';

describe('Importación con repositorio, worker, disco y PostgreSQL reales', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let prisma: PrismaService;
  let projects: ProjectsRepository;
  let repository: CatalogImportRepository;
  let store: ArtifactStore;
  let worker: CatalogImportWorker;
  let options: CatalogImportOptions;
  let ownerId: string;
  let otherOwnerId: string;
  let projectId: string;
  let otherProjectId: string;

  async function accept(
    csv = 'id,title\n000123,Café\n',
    overrides: Partial<Acceptance> = {},
  ) {
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
      ...overrides,
    };
    await store.finalize(upload.filename, input.artifactKey);
    await repository.accept(input);
    return input;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    prisma = new PrismaService(database.connection);
    await prisma.onModuleInit();
    projects = new ProjectsRepository(prisma);
    repository = new CatalogImportRepository(prisma);
    options = {
      root: await mkdtemp(join(tmpdir(), 'catalog-integration-')),
      autoStart: false,
      pollMs: 1000,
      shutdownMs: 1000,
    };
    store = new ArtifactStore(options);
    await store.onModuleInit();
    worker = new CatalogImportWorker(repository, store, options);
  });
  beforeEach(async () => {
    await database.connection.pool.query(
      'TRUNCATE estadistica_forms.app_users CASCADE',
    );
    const users = new UsersRepository(prisma);
    ownerId = (await users.provision(alice)).id;
    otherOwnerId = (await users.provision(bob)).id;
    projectId = (await projects.create(ownerId, 'Alice', projectInput)).id;
    otherProjectId = (await projects.create(otherOwnerId, 'Bob', projectInput))
      .id;
  });
  afterAll(async () => {
    try {
      await worker?.onModuleDestroy();
      await prisma?.onModuleDestroy();
    } finally {
      await database?.close();
      if (options) await rm(options.root, { recursive: true, force: true });
    }
  });

  it('acepta y procesa filas originales; oculta contenido antes de ready y limita muestra a 20', async () => {
    const csv = `id,title\n${Array.from({ length: 25 }, (_, i) => `${i.toString().padStart(6, '0')},Café ${i}`).join('\n')}\n`;
    const input = await accept(csv);
    expect(
      await repository.findSnapshot(ownerId, projectId, input.snapshotId),
    ).toMatchObject({
      snapshot: { status: 'pending', rowCount: null },
      sample: [],
    });
    await worker.runUntilIdle();
    expect(
      await repository.findJob(ownerId, projectId, input.jobId),
    ).toMatchObject({ status: 'succeeded', processedRows: 25, error: null });
    const result = await repository.findSnapshot(
      ownerId,
      projectId,
      input.snapshotId,
    );
    expect(result.snapshot).toMatchObject({
      status: 'ready',
      rowCount: 25,
      headers: ['id', 'title'],
      sourceHash: createHash('sha256').update(csv).digest('hex'),
    });
    expect(result.sample).toHaveLength(20);
    expect(result.sample[0]).toEqual({
      sourceRow: 1,
      externalId: '000000',
      originalValues: { id: '000000', title: 'Café 0' },
    });
    expect(result.snapshot).not.toHaveProperty('artifactKey');
  });

  it('rechaza lecturas de otro propietario y recursos bajo otro proyecto', async () => {
    const input = await accept();
    await worker.runUntilIdle();
    await expect(
      repository.findJob(otherOwnerId, projectId, input.jobId),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      repository.findSnapshot(otherOwnerId, otherProjectId, input.snapshotId),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      repository.findJob(ownerId, otherProjectId, input.jobId),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('un error en la segunda escritura del alta revierte el snapshot nuevo', async () => {
    const first = await accept();
    const second = {
      ...first,
      snapshotId: randomUUID(),
      artifactKey: `${randomUUID()}.csv`,
    };
    await expect(repository.accept(second)).rejects.toBeDefined();
    expect(await prisma.catalogSnapshot.count()).toBe(1);
    expect(
      await prisma.catalogSnapshot.findUnique({
        where: { id: second.snapshotId },
      }),
    ).toBeNull();
    expect(await prisma.catalogImportJob.count()).toBe(1);
  });

  it('la FK compuesta impide un job asociado a un snapshot de otro proyecto', async () => {
    const input = await accept();
    await prisma.catalogImportJob.delete({ where: { id: input.jobId } });
    await expect(
      database.connection.pool.query(
        "INSERT INTO estadistica_forms.catalog_import_jobs (id,project_id,snapshot_id,request_id,status,created_at) VALUES ($1,$2,$3,'request','queued','date')",
        [randomUUID(), otherProjectId, input.snapshotId],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    expect(await prisma.catalogImportJob.count()).toBe(0);
  });

  it('la unicidad de IDs es por snapshot y un lote fallido revierte filas y progreso', async () => {
    const first = await accept();
    const second = await accept();
    const job = await repository.claim();
    expect(job).not.toBeNull();
    if (!job) throw new Error('Falta job');
    const row = {
      sourceRow: 1,
      externalId: '000123',
      originalValues: { id: '000123' },
    };
    await repository.appendBatch(job, [row]);
    await expect(
      repository.appendBatch(job, [
        { ...row, sourceRow: 2 },
        { sourceRow: 3, externalId: 'new', originalValues: { id: 'new' } },
      ]),
    ).rejects.toBeDefined();
    expect(
      await prisma.catalogRow.count({ where: { snapshotId: job.snapshotId } }),
    ).toBe(1);
    expect(await repository.findJob(ownerId, projectId, job.id)).toMatchObject({
      processedRows: 1,
    });
    await repository.fail(job, publicError('IMPORT_PROCESSING_FAILED'));
    expect(
      await repository.findSnapshot(ownerId, projectId, job.snapshotId),
    ).toMatchObject({ snapshot: { status: 'failed' }, sample: [] });
    await worker.runUntilIdle();
    const other = job.id === first.jobId ? second : first;
    expect(
      await repository.findJob(ownerId, projectId, other.jobId),
    ).toMatchObject({ status: 'succeeded' });
  });

  it('un fallo después de un lote confirmado deja filas privadas sin muestra utilizable', async () => {
    const csv = `id\n${Array.from({ length: 251 }, (_, i) => i.toString()).join('\n')}\n0\n`;
    const input = await accept(csv);
    await worker.runUntilIdle();
    expect(
      await repository.findJob(ownerId, projectId, input.jobId),
    ).toMatchObject({
      status: 'failed',
      processedRows: 250,
      error: { code: 'CSV_DUPLICATE_ID', sourceRow: 252 },
    });
    expect(await prisma.catalogRow.count()).toBe(250);
    expect(
      await repository.findSnapshot(ownerId, projectId, input.snapshotId),
    ).toMatchObject({
      snapshot: { status: 'failed', rowCount: null },
      sample: [],
    });
  });

  it('normaliza errores JSONB anteriores al leer job y snapshot sin reescribirlos', async () => {
    const input = await accept('id\n1\n1\n');
    await worker.runUntilIdle();
    const oldError = {
      code: 'CSV_DUPLICATE_ID',
      message: 'SQL secreto',
      sourceRow: 2,
    };
    await prisma.catalogImportJob.update({
      where: { id: input.jobId },
      data: { error: oldError },
    });
    await prisma.catalogSnapshot.update({
      where: { id: input.snapshotId },
      data: { error: oldError },
    });
    const expected = publicError('CSV_DUPLICATE_ID', { sourceRow: 2 });
    expect(
      await repository.findJob(ownerId, projectId, input.jobId),
    ).toMatchObject({ error: expected });
    expect(
      await repository.findSnapshot(ownerId, projectId, input.snapshotId),
    ).toMatchObject({ snapshot: { error: expected } });
    expect(
      (
        await prisma.catalogImportJob.findUniqueOrThrow({
          where: { id: input.jobId },
        })
      ).error,
    ).toEqual(oldError);
  });

  it('un fallo en la segunda escritura de finalización revierte ready antes de registrar failed', async () => {
    const input = await accept();
    await database.connection.pool.query(
      "CREATE FUNCTION estadistica_forms.reject_success() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='succeeded' THEN RAISE EXCEPTION 'fallo de test'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_success BEFORE UPDATE ON estadistica_forms.catalog_import_jobs FOR EACH ROW EXECUTE FUNCTION estadistica_forms.reject_success()",
    );
    try {
      await worker.runUntilIdle();
      expect(
        await repository.findJob(ownerId, projectId, input.jobId),
      ).toMatchObject({ status: 'failed' });
      expect(
        await repository.findSnapshot(ownerId, projectId, input.snapshotId),
      ).toMatchObject({
        snapshot: { status: 'failed', rowCount: null },
        sample: [],
      });
    } finally {
      await database.connection.pool.query(
        'DROP TRIGGER reject_success ON estadistica_forms.catalog_import_jobs; DROP FUNCTION estadistica_forms.reject_success()',
      );
    }
  });

  it('reconcilia running interrumpidos y retoma los queued persistidos al arrancar', async () => {
    const first = await accept();
    const second = await accept();
    const interrupted = await repository.claim();
    if (!interrupted) throw new Error('Falta job');
    const queued = interrupted.id === first.jobId ? second : first;
    const restarted = new CatalogImportWorker(repository, store, options);
    await restarted.onApplicationBootstrap();
    expect(
      await repository.findJob(ownerId, projectId, queued.jobId),
    ).toMatchObject({ status: 'queued' });
    expect(
      await repository.findJob(ownerId, projectId, interrupted.id),
    ).toMatchObject({
      status: 'failed',
      error: { code: 'IMPORT_INTERRUPTED' },
    });
    await restarted.runUntilIdle();
    const states = await prisma.catalogImportJob.findMany();
    expect(states.filter((job) => job.status === 'succeeded')).toHaveLength(1);
    expect(states.filter((job) => job.status === 'failed')).toHaveLength(1);
    expect(
      await repository.findJob(ownerId, projectId, queued.jobId),
    ).toMatchObject({ status: 'succeeded' });
    await restarted.onModuleDestroy();
  });

  it('archivo ausente o checksum cambiado termina con código estable', async () => {
    const missing = await accept();
    await store.removeArtifact(missing.artifactKey);
    const changed = await accept('id\n1\n', { sourceHash: '0'.repeat(64) });
    await worker.runUntilIdle();
    expect(
      await repository.findJob(ownerId, projectId, missing.jobId),
    ).toMatchObject({
      status: 'failed',
      error: { code: 'IMPORT_ARTIFACT_MISSING' },
    });
    expect(
      await repository.findJob(ownerId, projectId, changed.jobId),
    ).toMatchObject({
      status: 'failed',
      error: { code: 'IMPORT_INTEGRITY_FAILED' },
    });
  });

  it('persiste sola una fila cuyo JSON excede el presupuesto de lote', async () => {
    const input = await accept(`id,title\n1,"${'\t'.repeat(600_000)}"\n`);
    await worker.runUntilIdle();
    expect(
      await repository.findJob(ownerId, projectId, input.jobId),
    ).toMatchObject({ status: 'succeeded', processedRows: 1 });
  });

  it('PATCH y aceptación se serializan; cualquier snapshot bloquea cambios de configuración', async () => {
    const csv = 'id\n1\n';
    const input: Acceptance = {
      snapshotId: randomUUID(),
      jobId: randomUUID(),
      projectId,
      ownerId,
      artifactKey: `${randomUUID()}.csv`,
      sourceHash: createHash('sha256').update(csv).digest('hex'),
      byteSize: Buffer.byteLength(csv),
      originalName: 'shop.csv',
      idColumn: 'id',
      delimiter: 'comma',
      requestId: randomUUID(),
    };
    const [acceptance, patch] = await Promise.allSettled([
      repository.accept(input),
      projects.update(ownerId, projectId, {
        country: 'BO',
        currency: 'BOB',
        channelProfile: 'google_merchant',
      }),
    ]);
    expect(acceptance.status).toBe('fulfilled');
    const snapshot = await prisma.catalogSnapshot.findUniqueOrThrow({
      where: { id: input.snapshotId },
    });
    const project = await projects.findByOwner(ownerId, projectId);
    expect(snapshot.projectConfiguration).toMatchObject({
      country: project?.country,
      currency: project?.currency,
    });
    if (patch.status === 'rejected')
      expect(patch.reason).toMatchObject({
        response: { code: 'PROJECT_CONFIGURATION_LOCKED' },
      });
    await expect(
      projects.update(ownerId, projectId, {
        country: 'CA',
        currency: 'CAD',
        channelProfile: 'google_merchant',
      }),
    ).rejects.toMatchObject({
      response: { code: 'PROJECT_CONFIGURATION_LOCKED' },
    });
    expect(
      await projects.update(ownerId, projectId, { name: 'Nombre nuevo' }),
    ).toMatchObject({ name: 'Nombre nuevo' });
  });

  it('mide procesamiento del máximo de 5.000 filas sin retener una cola de escrituras', async () => {
    const csv = `id,title\n${Array.from({ length: 5000 }, (_, i) => `${i.toString().padStart(6, '0')},${'x'.repeat(2000)}`).join('\n')}\n`;
    const input = await accept(csv);
    const rssBefore = process.memoryUsage().rss;
    const start = performance.now();
    await worker.runUntilIdle();
    const durationMs = Math.round(performance.now() - start);
    const job = await repository.findJob(ownerId, projectId, input.jobId);
    expect(job).toMatchObject({ status: 'succeeded', processedRows: 5000 });
    process.stdout.write(
      `${JSON.stringify({ benchmark: 'catalog-import-5000', bytes: Buffer.byteLength(csv), durationMs, rssBefore, rssAfter: process.memoryUsage().rss })}\n`,
    );
  });
});
