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
import { ArtifactStore } from '../../../src/artifacts/artifact.store.js';
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
  let root: string;
  let options: CatalogImportOptions;
  let ownerId: string;
  let otherOwnerId: string;
  let projectId: string;
  let otherProjectId: string;

  async function accept(
    csv = 'id,title\n000123,Café\n',
    overrides: Partial<Acceptance> = {},
    queuedAlongsideActive = false,
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
    if (queuedAlongsideActive) {
      // Reproduce un estado ya persistido con dos trabajos en cola del mismo
      // proyecto, que `accept` ya no permite crear.
      const now = new Date().toISOString();
      await prisma.catalogSnapshot.create({
        data: {
          id: input.snapshotId,
          projectId: input.projectId,
          idColumn: input.idColumn,
          delimiter: input.delimiter,
          sourceHash: input.sourceHash,
          artifactKey: input.artifactKey,
          byteSize: input.byteSize,
          originalName: input.originalName,
          projectConfiguration: {},
          status: 'pending',
          createdAt: now,
        },
      });
      await prisma.catalogImportJob.create({
        data: {
          id: input.jobId,
          projectId: input.projectId,
          snapshotId: input.snapshotId,
          requestId: input.requestId,
          status: 'queued',
          createdAt: now,
        },
      });
    } else {
      await repository.accept(input);
    }
    return input;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    prisma = new PrismaService(database.connection);
    await prisma.onModuleInit();
    projects = new ProjectsRepository(prisma);
    repository = new CatalogImportRepository(prisma);
    root = await mkdtemp(join(tmpdir(), 'catalog-integration-'));
    options = {
      autoStart: false,
      pollMs: 1000,
      shutdownMs: 1000,
    };
    store = new ArtifactStore({ root });
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
      if (root) await rm(root, { recursive: true, force: true });
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
    const second = await accept(undefined, {}, true);
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
    const second = await accept(undefined, {}, true);
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
    const changed = await accept(
      'id\n1\n',
      { sourceHash: '0'.repeat(64) },
      true,
    );
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
  it('rechaza una segunda importación activa y acepta otra al terminar la primera', async () => {
    const first = await accept();
    await expect(accept()).rejects.toMatchObject({
      response: publicError('IMPORT_ALREADY_ACTIVE'),
    });
    expect(await prisma.catalogSnapshot.count()).toBe(1);

    await worker.runUntilIdle();
    expect(
      await repository.findJob(ownerId, projectId, first.jobId),
    ).toMatchObject({ status: 'succeeded' });
    await expect(accept()).resolves.toBeDefined();
  });

  it('lista las importaciones del propietario, recientes primero y sin la muestra', async () => {
    const first = await accept();
    await worker.runUntilIdle();
    const second = await accept('id\n9\n');
    const all = await repository.listSnapshots(ownerId, projectId, {
      limit: 10,
      offset: 0,
    });
    expect(all.map(({ id }) => id)).toEqual([
      second.snapshotId,
      first.snapshotId,
    ]);
    expect(all[0]).toMatchObject({
      status: 'pending',
      job: { id: second.jobId, status: 'queued', processedRows: 0 },
    });
    expect(all[1]).toMatchObject({
      status: 'ready',
      job: { id: first.jobId, status: 'succeeded' },
    });
    expect(all[0]).not.toHaveProperty('sample');

    const window = await repository.listSnapshots(ownerId, projectId, {
      limit: 1,
      offset: 1,
    });
    expect(window.map(({ id }) => id)).toEqual([first.snapshotId]);

    await expect(
      repository.listSnapshots(otherOwnerId, projectId, {
        limit: 10,
        offset: 0,
      }),
    ).rejects.toMatchObject({ response: publicError('PROJECT_NOT_FOUND') });
  });

  describe('eliminación', () => {
    it('borrar una importación terminada borra en cascada sus filas y su trabajo', async () => {
      const input = await accept('id,title\n1,a\n2,b\n');
      await worker.runUntilIdle();

      await expect(
        repository.deleteSnapshot(ownerId, projectId, input.snapshotId),
      ).resolves.toEqual({
        snapshotId: input.snapshotId,
        artifactKey: input.artifactKey,
        exportArtifactKeys: [],
      });
      expect(
        await prisma.catalogRow.count({
          where: { snapshotId: input.snapshotId },
        }),
      ).toBe(0);
      expect(
        await prisma.catalogImportJob.count({ where: { id: input.jobId } }),
      ).toBe(0);
      await expect(
        repository.findSnapshot(ownerId, projectId, input.snapshotId),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('no borra una importación en curso ni la de otro propietario', async () => {
      const input = await accept();
      await expect(
        repository.deleteSnapshot(ownerId, projectId, input.snapshotId),
      ).rejects.toMatchObject({ response: publicError('IMPORT_IN_PROGRESS') });
      await expect(
        repository.deleteSnapshot(otherOwnerId, projectId, input.snapshotId),
      ).rejects.toMatchObject({ response: publicError('IMPORT_NOT_FOUND') });
      await expect(
        repository.deleteSnapshot(ownerId, otherProjectId, input.snapshotId),
      ).rejects.toMatchObject({ response: publicError('IMPORT_NOT_FOUND') });
      expect(await prisma.catalogSnapshot.count()).toBe(1);
    });

    it('borra el proyecto con todas sus importaciones y devuelve sus archivos', async () => {
      const first = await accept();
      await worker.runUntilIdle();
      const second = await accept('id,title\n9,z\n');
      await worker.runUntilIdle();

      const deleted = await repository.deleteProject(ownerId, projectId);
      expect(deleted.feedArtifactKeys).toEqual([]);
      expect(deleted.imports).toHaveLength(2);
      expect(deleted.imports).toEqual(
        expect.arrayContaining([
          {
            snapshotId: first.snapshotId,
            artifactKey: first.artifactKey,
            exportArtifactKeys: [],
          },
          {
            snapshotId: second.snapshotId,
            artifactKey: second.artifactKey,
            exportArtifactKeys: [],
          },
        ]),
      );
      expect(await prisma.project.count({ where: { id: projectId } })).toBe(0);
      expect(await prisma.catalogSnapshot.count()).toBe(0);
      expect(await prisma.catalogRow.count()).toBe(0);
      expect(await prisma.catalogImportJob.count()).toBe(0);
      expect(
        await prisma.project.count({ where: { id: otherProjectId } }),
      ).toBe(1);
    });

    it('no borra un proyecto con una importación en curso ni uno ajeno', async () => {
      await accept();
      await expect(
        repository.deleteProject(ownerId, projectId),
      ).rejects.toMatchObject({ response: publicError('IMPORT_IN_PROGRESS') });
      await expect(
        repository.deleteProject(otherOwnerId, projectId),
      ).rejects.toMatchObject({ response: publicError('PROJECT_NOT_FOUND') });
      expect(await prisma.project.count({ where: { id: projectId } })).toBe(1);
    });

    it('RESTRICT sigue impidiendo borrar un proyecto con importaciones fuera de la transacción prevista', async () => {
      await accept();
      await worker.runUntilIdle();
      await expect(
        database.connection.pool.query(
          'DELETE FROM estadistica_forms.projects WHERE id = $1',
          [projectId],
        ),
        // 23001: restrict_violation (ON DELETE RESTRICT).
      ).rejects.toMatchObject({ code: '23001' });
    });

    it('distingue las claves de archivo que siguen referenciadas', async () => {
      const input = await accept();
      const unknown = `${randomUUID()}.csv`;
      await expect(
        repository.findReferencedArtifactKeys([input.artifactKey, unknown]),
      ).resolves.toEqual(new Set([input.artifactKey]));
      await expect(repository.findReferencedArtifactKeys([])).resolves.toEqual(
        new Set(),
      );
    });
  });
});
