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
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '../../../src/artifacts/artifact.store.js';
import { ARTIFACT_STORE_OPTIONS } from '../../../src/artifacts/artifacts.types.js';
import { ORPHAN_MIN_AGE_MS } from '../../../src/artifacts/remove-orphans.js';
import { CatalogImportRepository } from '../../../src/catalog-import/catalog-import.repository.js';
import { DescopeService } from '../../../src/auth/descope.service.js';
import { POSTGRESQL_CONNECTION } from '../../../src/database/postgresql.connection.js';
import { PrismaService } from '../../../src/database/prisma.service.js';
import { EvaluationsRepository } from '../../../src/evaluations/evaluations.repository.js';
import { EvaluationWorker } from '../../../src/evaluations/evaluations.worker.js';
import { ExportsModule } from '../../../src/exports/exports.module.js';
import { ExportsService } from '../../../src/exports/exports.service.js';
import { EXPORT_OPTIONS } from '../../../src/exports/exports.types.js';
import {
  createDeliveryToken,
  hashDeliveryToken,
} from '../../../src/feeds/delivery-token.js';
import { FeedCleanupService } from '../../../src/feeds/feed-cleanup.service.js';
import { FeedDeliveryService } from '../../../src/feeds/feed-delivery.service.js';
import { FeedsModule } from '../../../src/feeds/feeds.module.js';
import { FeedsRepository } from '../../../src/feeds/feeds.repository.js';
import { FeedsService } from '../../../src/feeds/feeds.service.js';
import { FEED_OPTIONS } from '../../../src/feeds/feeds.types.js';
import type { ExportView } from '../../../src/exports/exports.types.js';
import { ProjectsService } from '../../../src/projects/projects.service.js';
import { RulesetsRepository } from '../../../src/rulesets/rulesets.repository.js';
import { UsersService } from '../../../src/users/users.service.js';
import {
  CATALOG_RULESET,
  insertReadySnapshot,
  mixedCatalog,
} from '../evaluations/support/snapshot-fixtures.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';

const apiFailure = (code: string, status: number) =>
  expect.objectContaining({
    status,
    response: expect.objectContaining({ code }),
  });

// PGlite es una base de una sola conexión y ejecuta las transacciones una tras
// otra: estas pruebas no demuestran que dos publicaciones simultáneas se esperen
// (FOR UPDATE del feed) ni el FOR SHARE de la exportación frente a un borrado.
// Sí demuestran la condición de la generación, las FK y las cascadas
// (R4 del plan feeds&publications).
describe('Feeds y publicaciones con Prisma, almacén y PostgreSQL temporal', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let module: TestingModule;
  let root: string;
  let prisma: PrismaService;
  let feeds: FeedsService;
  let repository: FeedsRepository;
  let evaluations: EvaluationsRepository;
  let worker: EvaluationWorker;
  let ownerId: string;
  let projectId: string;
  let otherProjectId: string;

  const pool = () => database.connection.pool;
  const feedFiles = () => readdir(join(root, 'feeds'));

  /** Importa un catálogo listo, lo evalúa y exporta la evaluación aprobando lo que se lee. */
  async function exportCatalog(size: number, project = projectId) {
    const snapshotId = await insertReadySnapshot(
      pool(),
      project,
      mixedCatalog(size),
    );
    const evaluationId = randomUUID();
    const identity = project === projectId ? alice : bob;
    const owner = (await module.get(UsersService).findCurrent(identity)).id;
    await evaluations.accept({
      evaluationId,
      ownerId: owner,
      projectId: project,
      snapshotId,
      rulesetRevision: 1,
    });
    await worker.runUntilIdle();
    const evaluation = (await evaluations.findByOwner(
      owner,
      project,
      evaluationId,
    ))!;
    const result = await module.get(ExportsService).create(identity, project, {
      evaluationId,
      resultChecksum: evaluation.resultChecksum!,
      acceptedInvalidCount: evaluation.counts!.invalid,
      acceptedExcludedCount: evaluation.counts!.excluded,
    });
    return { export: result.export, snapshotId };
  }

  async function createFeed() {
    return (await feeds.create(alice, projectId)).feed;
  }

  function publish(feedId: string, source: ExportView, generation: number) {
    return feeds.publish(alice, projectId, feedId, {
      exportId: source.id,
      expectedGeneration: generation,
    });
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    root = await mkdtemp(join(tmpdir(), 'feeds-integration-'));
    module = await Test.createTestingModule({
      imports: [ExportsModule, FeedsModule],
    })
      .overrideProvider(POSTGRESQL_CONNECTION)
      .useValue(database.connection)
      .overrideProvider(ARTIFACT_STORE_OPTIONS)
      .useValue({ root })
      // Estas pruebas llaman al servicio sin HTTP: la sesión no se valida.
      .overrideProvider(DescopeService)
      .useValue({})
      .overrideProvider(EXPORT_OPTIONS)
      .useValue({ autoStart: false })
      // La limpieza se prueba llamándola; se conservan 3 archivos por feed.
      .overrideProvider(FEED_OPTIONS)
      .useValue({ autoStart: false, retainedFiles: 3 })
      .compile();
    await module.init();
    prisma = module.get(PrismaService);
    feeds = module.get(FeedsService);
    repository = module.get(FeedsRepository);
    evaluations = new EvaluationsRepository(prisma);
    worker = new EvaluationWorker(evaluations, {
      autoStart: false,
      pollMs: 1000,
      shutdownMs: 1000,
    });
  });
  beforeEach(async () => {
    await pool().query('TRUNCATE estadistica_forms.app_users CASCADE');
    // TRUNCATE borra las filas, no los archivos: cada prueba empieza sin TSV.
    await rm(join(root, 'exports'), { recursive: true, force: true });
    await rm(join(root, 'feeds'), { recursive: true, force: true });
    await module.get(ArtifactStore).onModuleInit();
    const users = module.get(UsersService);
    ownerId = (await users.provision(alice)).id;
    const bobId = (await users.provision(bob)).id;
    const projects = module.get(ProjectsService);
    projectId = (await projects.create(alice, projectInput)).id;
    otherProjectId = (await projects.create(bob, projectInput)).id;
    const rulesets = new RulesetsRepository(prisma);
    await rulesets.create(ownerId, projectId, CATALOG_RULESET);
    await rulesets.create(bobId, otherProjectId, CATALOG_RULESET);
  });
  afterAll(async () => {
    try {
      await module?.close();
    } finally {
      await database?.close();
      if (root) await rm(root, { recursive: true, force: true });
    }
  });

  describe('crear el feed', () => {
    it('sin publicar, con la entrega activa y solo el hash del token guardado', async () => {
      const { feed, deliveryUrl } = await feeds.create(alice, projectId);

      expect(feed).toEqual({
        id: expect.any(String),
        generation: 0,
        deliveryEnabled: true,
        publishedVersion: null,
        source: null,
        policy: null,
        schedule: null,
        lastRefresh: null,
        createdAt: expect.any(String),
        updatedAt: feed.createdAt,
      });
      const token = /^\/feeds\/([A-Za-z0-9_-]{43})\.tsv$/.exec(deliveryUrl)![1];
      const { rows } = await pool().query(
        'SELECT delivery_token_hash FROM estadistica_forms.feeds',
      );
      expect(rows).toEqual([{ delivery_token_hash: hashDeliveryToken(token) }]);
    });

    it('un proyecto tiene como mucho un feed', async () => {
      await createFeed();

      await expect(feeds.create(alice, projectId)).rejects.toEqual(
        apiFailure('FEED_ALREADY_EXISTS', 409),
      );
    });

    it('no crea feeds en proyectos ajenos', async () => {
      await expect(feeds.create(alice, otherProjectId)).rejects.toEqual(
        apiFailure('PROJECT_NOT_FOUND', 404),
      );
    });

    it('lista y consulta solo los feeds del propietario', async () => {
      const feed = await createFeed();

      await expect(feeds.findAll(alice, projectId)).resolves.toEqual([feed]);
      await expect(feeds.findOne(alice, projectId, feed.id)).resolves.toEqual(
        feed,
      );
      await expect(feeds.findOne(bob, projectId, feed.id)).rejects.toEqual(
        apiFailure('PROJECT_NOT_FOUND', 404),
      );
      const bobId = (await module.get(UsersService).findCurrent(bob)).id;
      await expect(
        repository.findByOwner(bobId, otherProjectId, feed.id),
      ).resolves.toBeNull();
    });
  });

  describe('publicar con la generación esperada', () => {
    it('crea la versión, mueve el puntero y sube la generación', async () => {
      const feed = await createFeed();
      const { export: source } = await exportCatalog(6);

      const result = await publish(feed.id, source, 0);

      expect(result.published).toBe(true);
      expect(result.feed).toEqual({
        ...feed,
        generation: 1,
        publishedVersion: {
          id: expect.any(String),
          exportId: source.id,
          evaluationId: source.evaluationId,
          rowCount: source.rowCount,
          byteSize: source.byteSize,
          tsvChecksum: source.tsvChecksum,
          publishedBy: 'operator',
          publishedAt: result.feed.updatedAt,
        },
        updatedAt: expect.any(String),
      });
      expect(await feedFiles()).toEqual([
        `${result.feed.publishedVersion!.id}.tsv`,
      ]);
    });

    it('con una generación antigua: 409, sin versión nueva ni archivo', async () => {
      const feed = await createFeed();
      const { export: first } = await exportCatalog(6);
      await publish(feed.id, first, 0);
      const { export: second } = await exportCatalog(9);

      await expect(publish(feed.id, second, 0)).rejects.toEqual(
        apiFailure('FEED_GENERATION_CONFLICT', 409),
      );
      const current = await feeds.findOne(alice, projectId, feed.id);
      expect(current.generation).toBe(1);
      expect(current.publishedVersion!.exportId).toBe(first.id);
      expect(await feedFiles()).toEqual([
        `${current.publishedVersion!.id}.tsv`,
      ]);
      const { rows } = await pool().query(
        'SELECT count(*)::int AS count FROM estadistica_forms.feed_versions',
      );
      expect(rows[0].count).toBe(1);
    });

    it('si otro publica entre la lectura y la transacción, el UPDATE condicional lo detecta', async () => {
      const feed = await createFeed();
      const { export: first } = await exportCatalog(6);
      const { export: second } = await exportCatalog(9);
      await publish(feed.id, first, 0);
      const toPublish = (await repository.findExportToPublish(
        ownerId,
        projectId,
        second.id,
      ))!;
      const versionId = randomUUID();
      const file = await module
        .get(ArtifactStore)
        .linkFeedVersion(toPublish.artifactKey, `${versionId}.tsv`, {
          byteSize: toPublish.byteSize,
          checksum: toPublish.tsvChecksum,
        });

      // El servicio comprobó la generación 0 antes de que la otra publicación
      // la subiera a 1: la transacción recibe una generación que ya no vale.
      await expect(
        repository.publish({
          id: versionId,
          feedId: feed.id,
          projectId,
          expectedGeneration: 0,
          source: toPublish,
          file,
          publishedBy: 'operator',
          createdAt: new Date().toISOString(),
        }),
      ).rejects.toEqual(apiFailure('FEED_GENERATION_CONFLICT', 409));
      const { rows } = await pool().query(
        'SELECT count(*)::int AS count FROM estadistica_forms.feed_versions',
      );
      expect(rows[0].count).toBe(1);
    });

    it('si la versión no se guarda, el archivo enlazado se borra', async () => {
      const feed = await createFeed();
      const { export: source } = await exportCatalog(6);
      jest
        .spyOn(repository, 'publish')
        .mockRejectedValueOnce(new Error('fallo simulado al guardar'));

      await expect(publish(feed.id, source, 0)).rejects.toThrow(
        'fallo simulado al guardar',
      );
      expect(await feedFiles()).toEqual([]);
    });

    it('publicar el TSV que ya está publicado no crea otra versión', async () => {
      const feed = await createFeed();
      const { export: source } = await exportCatalog(6);
      const first = await publish(feed.id, source, 0);

      const again = await publish(feed.id, source, 1);

      expect(again).toEqual({ feed: first.feed, published: false });
      expect(await feedFiles()).toHaveLength(1);
    });

    it('se puede volver a publicar una exportación anterior', async () => {
      const feed = await createFeed();
      const { export: first } = await exportCatalog(6);
      await publish(feed.id, first, 0);
      const { export: second } = await exportCatalog(9);
      await publish(feed.id, second, 1);

      const back = await publish(feed.id, first, 2);

      expect(back.feed.generation).toBe(3);
      expect(back.feed.publishedVersion!.exportId).toBe(first.id);
      expect(await feedFiles()).toHaveLength(3);
    });

    it('no publica exportaciones de otro proyecto ni en feeds ajenos', async () => {
      const feed = await createFeed();
      const { export: foreign } = await exportCatalog(6, otherProjectId);

      await expect(publish(feed.id, foreign, 0)).rejects.toEqual(
        apiFailure('EXPORT_NOT_FOUND', 404),
      );
      await expect(
        feeds.publish(bob, otherProjectId, feed.id, {
          exportId: foreign.id,
          expectedGeneration: 0,
        }),
      ).rejects.toEqual(apiFailure('FEED_NOT_FOUND', 404));
      expect(await feedFiles()).toEqual([]);
    });

    it('sin el archivo de la exportación: 503 y nada publicado', async () => {
      const feed = await createFeed();
      const { export: source } = await exportCatalog(6);
      await rm(join(root, 'exports'), { recursive: true, force: true });
      await module.get(ArtifactStore).onModuleInit();
      const logError = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await expect(publish(feed.id, source, 0)).rejects.toEqual(
        apiFailure('EXPORT_FILE_UNAVAILABLE', 503),
      );
      expect(logError).toHaveBeenCalledWith({
        code: 'EXPORT_FILE_MISSING',
        exportId: source.id,
      });
      expect(await feedFiles()).toEqual([]);
      expect(
        (await feeds.findOne(alice, projectId, feed.id)).publishedVersion,
      ).toBeNull();
    });
  });

  describe('retención de archivos (D14)', () => {
    async function publishSeries(sizes: number[]) {
      const feed = await createFeed();
      const versions: string[] = [];
      for (const [generation, size] of sizes.entries()) {
        const { export: source } = await exportCatalog(size);
        const { feed: published } = await publish(feed.id, source, generation);
        versions.push(published.publishedVersion!.id);
      }
      return { feed, versions };
    }

    async function keysByVersion() {
      const { rows } = await pool().query<{
        id: string;
        artifact_key: string | null;
      }>('SELECT id, artifact_key FROM estadistica_forms.feed_versions');
      return new Map(rows.map((row) => [row.id, row.artifact_key]));
    }

    it('con tres o menos versiones no retira nada', async () => {
      const { versions } = await publishSeries([6, 9, 3]);

      expect((await feedFiles()).sort()).toEqual(
        versions.map((id) => `${id}.tsv`).sort(),
      );
    });

    it('la cuarta publicación retira el archivo más antiguo y conserva su historial', async () => {
      const { versions } = await publishSeries([6, 9, 3, 12]);

      expect((await feedFiles()).sort()).toEqual(
        versions
          .slice(1)
          .map((id) => `${id}.tsv`)
          .sort(),
      );
      const keys = await keysByVersion();
      expect(keys.size).toBe(4);
      expect(keys.get(versions[0])).toBeNull();
      expect(keys.get(versions[3])).toBe(`${versions[3]}.tsv`);
    });

    it('el historial lista las versiones de la más reciente a la más antigua, paginado', async () => {
      const { feed, versions } = await publishSeries([6, 9, 3, 12]);

      const first = await feeds.listVersions(alice, projectId, feed.id, {
        limit: 3,
      });
      const rest = await feeds.listVersions(alice, projectId, feed.id, {
        limit: 3,
        offset: 3,
      });

      expect(first.versions.map((version) => version.id)).toEqual(
        [...versions].reverse().slice(0, 3),
      );
      expect(first.page).toEqual({ limit: 3, offset: 0, hasMore: true });
      expect(first.versions[0]).toMatchObject({
        current: true,
        fileRetained: true,
        publishedBy: 'operator',
      });
      expect(first.versions[1].current).toBe(false);
      // La más antigua salió de la retención (D14): sigue en el historial.
      expect(rest.versions).toEqual([
        expect.objectContaining({
          id: versions[0],
          current: false,
          fileRetained: false,
        }),
      ]);
      expect(rest.page.hasMore).toBe(false);
    });

    it('el historial de un feed ajeno: 404', async () => {
      const { feed } = await publishSeries([6]);

      await expect(
        feeds.listVersions(bob, otherProjectId, feed.id),
      ).rejects.toEqual(apiFailure('FEED_NOT_FOUND', 404));
    });

    it('nunca retira el archivo de la versión publicada', async () => {
      const { feed, versions } = await publishSeries([6, 9, 3, 12]);

      // El repositorio solo retira las claves; borrar los archivos es del servicio.
      const retired = await repository.retireOldFiles(feed.id, 1);

      expect(retired.sort()).toEqual(
        [`${versions[1]}.tsv`, `${versions[2]}.tsv`].sort(),
      );
      const keys = await keysByVersion();
      expect([...keys.values()].filter((key) => key !== null)).toEqual([
        `${versions[3]}.tsv`,
      ]);
    });

    it('si la retención falla, la publicación ya está hecha y se registra', async () => {
      const feed = await createFeed();
      const { export: source } = await exportCatalog(6);
      jest
        .spyOn(repository, 'retireOldFiles')
        .mockRejectedValueOnce(new Error('fallo simulado'));
      const logError = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      const result = await publish(feed.id, source, 0);

      expect(result.feed.generation).toBe(1);
      expect(logError).toHaveBeenCalledWith({
        code: 'FEED_RETENTION_FAILED',
        feedId: feed.id,
      });
    });
  });

  describe('token de entrega', () => {
    it('rotar cambia el hash guardado y devuelve la URL nueva', async () => {
      const { feed, deliveryUrl } = await feeds.create(alice, projectId);

      const rotated = await feeds.rotateDeliveryToken(
        alice,
        projectId,
        feed.id,
      );

      expect(rotated.deliveryUrl).not.toBe(deliveryUrl);
      expect(rotated.feed.deliveryEnabled).toBe(true);
      const token = /\/feeds\/(.+)\.tsv$/.exec(rotated.deliveryUrl)![1];
      const { rows } = await pool().query(
        'SELECT delivery_token_hash FROM estadistica_forms.feeds',
      );
      expect(rows).toEqual([{ delivery_token_hash: hashDeliveryToken(token) }]);
    });

    it('desactivar deja el hash nulo', async () => {
      const feed = await createFeed();

      await feeds.disableDelivery(alice, projectId, feed.id);

      expect(
        (await feeds.findOne(alice, projectId, feed.id)).deliveryEnabled,
      ).toBe(false);
    });

    it('no cambia el token de un feed ajeno', async () => {
      const feed = await createFeed();
      const bobId = (await module.get(UsersService).findCurrent(bob)).id;

      await expect(
        repository.setDeliveryTokenHash({
          ownerId: bobId,
          projectId: otherProjectId,
          feedId: feed.id,
          tokenHash: null,
          updatedAt: 'x',
        }),
      ).resolves.toBeNull();
      await expect(
        feeds.rotateDeliveryToken(bob, otherProjectId, feed.id),
      ).rejects.toEqual(apiFailure('FEED_NOT_FOUND', 404));
      expect(
        (await feeds.findOne(alice, projectId, feed.id)).deliveryEnabled,
      ).toBe(true);
    });

    it('el archivo de entrega solo existe con token vigente y versión publicada', async () => {
      const { feed, deliveryUrl } = await feeds.create(alice, projectId);
      const token = /\/feeds\/(.+)\.tsv$/.exec(deliveryUrl)![1];
      const hash = hashDeliveryToken(token);

      await expect(repository.findDeliveryFile(hash)).resolves.toBeNull();

      const { export: source } = await exportCatalog(6);
      const { feed: published } = await publish(feed.id, source, 0);
      await expect(repository.findDeliveryFile(hash)).resolves.toEqual({
        feedId: feed.id,
        artifactKey: `${published.publishedVersion!.id}.tsv`,
        byteSize: source.byteSize,
        tsvChecksum: source.tsvChecksum,
      });
      await expect(
        repository.findDeliveryFile(createDeliveryToken().hash),
      ).resolves.toBeNull();

      await feeds.disableDelivery(alice, projectId, feed.id);
      await expect(repository.findDeliveryFile(hash)).resolves.toBeNull();
    });

    it('si falta el archivo publicado: 503, registrado con el feed y sin el token', async () => {
      const { feed, deliveryUrl } = await feeds.create(alice, projectId);
      const { export: source } = await exportCatalog(6);
      await publish(feed.id, source, 0);
      await rm(join(root, 'feeds'), { recursive: true, force: true });
      await module.get(ArtifactStore).onModuleInit();
      const logError = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await expect(
        module
          .get(FeedDeliveryService)
          .open(deliveryUrl.replace('/feeds/', ''), undefined),
      ).rejects.toEqual(apiFailure('FEED_FILE_UNAVAILABLE', 503));
      expect(logError).toHaveBeenCalledWith({
        code: 'FEED_FILE_MISSING',
        feedId: feed.id,
      });
    });
  });

  describe('fuente remota', () => {
    const source = {
      url: 'https://tienda.example.com/productos.csv',
      idColumn: 'id',
      delimiter: 'semicolon' as const,
    };

    it('guarda la fuente y la devuelve con el feed', async () => {
      const feed = await createFeed();

      const updated = await feeds.setSource(alice, projectId, feed.id, source);

      expect(updated.source).toEqual(source);
      await expect(
        feeds.findOne(alice, projectId, feed.id),
      ).resolves.toMatchObject({ source });
    });

    it('no la guarda en un feed ajeno', async () => {
      const feed = await createFeed();

      await expect(
        feeds.setSource(bob, otherProjectId, feed.id, source),
      ).rejects.toEqual(apiFailure('FEED_NOT_FOUND', 404));
      expect(
        (await feeds.findOne(alice, projectId, feed.id)).source,
      ).toBeNull();
    });

    it('la base exige la fuente completa y valores con forma', async () => {
      const feed = await createFeed();
      const update = (columns: string, values: unknown[]) =>
        pool().query(
          `UPDATE estadistica_forms.feeds SET ${columns} WHERE id = $1`,
          [feed.id, ...values],
        );

      await expect(
        update('source_url = $2', ['https://a.example/x.csv']),
      ).rejects.toMatchObject({ code: '23514' });
      for (const values of [
        ['', 'id', 'comma'],
        ['https://a.example/x.csv', '', 'comma'],
        ['https://a.example/x.csv', 'id', 'tab'],
        [`https://a.example/${'a'.repeat(2048)}`, 'id', 'comma'],
      ]) {
        await expect(
          update(
            'source_url = $2, source_id_column = $3, source_delimiter = $4',
            values,
          ),
        ).rejects.toMatchObject({ code: '23514' });
      }
    });
  });

  describe('borrado del proyecto y limpieza', () => {
    it('deleteProject devuelve las claves de los archivos del feed', async () => {
      const feed = await createFeed();
      const { export: first } = await exportCatalog(6);
      await publish(feed.id, first, 0);
      const { export: second } = await exportCatalog(9);
      await publish(feed.id, second, 1);

      const deleted = await new CatalogImportRepository(prisma).deleteProject(
        ownerId,
        projectId,
      );

      expect(deleted.feedArtifactKeys.sort()).toEqual(
        (await feedFiles()).sort(),
      );
      expect(deleted.feedArtifactKeys).toHaveLength(2);
    });

    it('la limpieza borra los archivos sin versión con más de una hora y conserva el resto', async () => {
      const feed = await createFeed();
      const { export: source } = await exportCatalog(6);
      const { feed: published } = await publish(feed.id, source, 0);
      const referenced = `${published.publishedVersion!.id}.tsv`;
      const oldOrphan = `${randomUUID()}.tsv`;
      const recentOrphan = `${randomUUID()}.tsv`;
      await writeFile(join(root, 'feeds', oldOrphan), 'x');
      await writeFile(join(root, 'feeds', recentOrphan), 'x');
      const old = new Date(Date.now() - ORPHAN_MIN_AGE_MS - 1000);
      await utimes(join(root, 'feeds', oldOrphan), old, old);
      await utimes(join(root, 'feeds', referenced), old, old);

      const removed = await module.get(FeedCleanupService).removeOrphanFiles();

      expect(removed).toBe(1);
      expect((await feedFiles()).sort()).toEqual(
        [referenced, recentOrphan].sort(),
      );
    });
  });

  describe('restricciones y cascadas', () => {
    it('la base exige hora y zona juntas, y en forma', async () => {
      const feed = await createFeed();
      const update = (assignments: string) =>
        pool().query(
          `UPDATE estadistica_forms.feeds SET ${assignments} WHERE id = $1`,
          [feed.id],
        );

      for (const assignments of [
        "refresh_time = '06:00'",
        'refresh_enabled = true',
        "refresh_time = '24:00', time_zone = 'UTC'",
        "refresh_time = '6:00', time_zone = 'UTC'",
        `refresh_time = '06:00', time_zone = '${'a'.repeat(65)}'`,
      ]) {
        await expect(update(assignments)).rejects.toMatchObject({
          code: '23514',
        });
      }
      await expect(
        update(
          "refresh_enabled = true, refresh_time = '06:00', time_zone = 'UTC'",
        ),
      ).resolves.toBeDefined();
    });

    it('la base exige la política completa y en rango', async () => {
      const feed = await createFeed();
      const complete: Record<string, string> = {
        policy_ruleset_revision: '1',
        policy_max_invalid: '0',
        policy_max_excluded: '0',
        policy_max_drop_percent: '10',
        policy_engine_version: "'2'",
        policy_profile_version: "'p'",
        policy_approved_at: "'x'",
      };
      const update = (columns: Record<string, string>) =>
        pool().query(
          `UPDATE estadistica_forms.feeds SET ${Object.entries(columns)
            .map(([column, value]) => `${column} = ${value}`)
            .join(', ')} WHERE id = $1`,
          [feed.id],
        );

      await expect(
        update({ policy_ruleset_revision: '1' }),
      ).rejects.toMatchObject({ code: '23514' });
      const outOfRangeValues: Record<string, string>[] = [
        { policy_max_drop_percent: '101' },
        { policy_max_invalid: '-1' },
        { policy_ruleset_revision: '0' },
      ];
      for (const outOfRange of outOfRangeValues) {
        await expect(
          update({ ...complete, ...outOfRange }),
        ).rejects.toMatchObject({ code: '23514' });
      }
      await expect(update(complete)).resolves.toBeDefined();
    });

    it('borrar la importación deja la versión publicada y su archivo', async () => {
      const feed = await createFeed();
      const { export: source, snapshotId } = await exportCatalog(6);
      const { feed: published } = await publish(feed.id, source, 0);

      const exportKey = (await repository.findExportToPublish(
        ownerId,
        projectId,
        source.id,
      ))!.artifactKey;

      // Lo mismo que borrar la importación: cascada en SQL y retirada del TSV.
      await pool().query(
        'DELETE FROM estadistica_forms.catalog_snapshots WHERE id = $1',
        [snapshotId],
      );
      await module.get(ArtifactStore).removeExport(exportKey);

      const current = await feeds.findOne(alice, projectId, feed.id);
      expect(current.publishedVersion).toEqual({
        ...published.publishedVersion,
        exportId: null,
        evaluationId: null,
      });
      expect(
        await readFile(
          join(root, 'feeds', `${current.publishedVersion!.id}.tsv`),
        ),
      ).toHaveLength(source.byteSize);
    });

    it('borrar el proyecto borra el feed y sus versiones', async () => {
      const feed = await createFeed();
      const { export: source } = await exportCatalog(6);
      await publish(feed.id, source, 0);

      // Como `deleteProject`: primero los snapshots (su FK es RESTRICT) y
      // después el proyecto, que arrastra el feed.
      await pool().query(
        'DELETE FROM estadistica_forms.catalog_snapshots WHERE project_id = $1',
        [projectId],
      );
      await pool().query(
        'DELETE FROM estadistica_forms.projects WHERE id = $1',
        [projectId],
      );

      const { rows } = await pool().query(
        `SELECT
           (SELECT count(*)::int FROM estadistica_forms.feeds) AS feeds,
           (SELECT count(*)::int FROM estadistica_forms.feed_versions) AS versions`,
      );
      expect(rows[0]).toEqual({ feeds: 0, versions: 0 });
    });

    it('el puntero solo admite una versión del propio feed', async () => {
      const feed = await createFeed();
      const { export: source } = await exportCatalog(6);
      const { feed: published } = await publish(feed.id, source, 0);
      const otherFeedId = randomUUID();
      await pool().query(
        `INSERT INTO estadistica_forms.feeds (id, project_id, created_at, updated_at)
         VALUES ($1, $2, 'x', 'x')`,
        [otherFeedId, otherProjectId],
      );

      await expect(
        pool().query(
          `UPDATE estadistica_forms.feeds
           SET generation = 1, published_version_id = $1
           WHERE id = $2`,
          [published.publishedVersion!.id, otherFeedId],
        ),
      ).rejects.toMatchObject({ code: '23503' });
    });

    it('generación y puntero van juntos', async () => {
      const feed = await createFeed();

      await expect(
        pool().query(
          'UPDATE estadistica_forms.feeds SET generation = 1 WHERE id = $1',
          [feed.id],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('no se puede borrar la versión publicada', async () => {
      const feed = await createFeed();
      const { export: source } = await exportCatalog(6);
      const { feed: published } = await publish(feed.id, source, 0);

      await expect(
        pool().query(
          'DELETE FROM estadistica_forms.feed_versions WHERE id = $1',
          [published.publishedVersion!.id],
        ),
      ).rejects.toMatchObject({ code: '23503' });
    });

    it('la base rechaza valores fuera de forma', async () => {
      const feed = await createFeed();
      const insertVersion = (overrides: Record<string, unknown>) => {
        const row = {
          id: randomUUID(),
          feed_id: feed.id,
          artifact_key: `${randomUUID()}.tsv`,
          tsv_checksum: 'a'.repeat(64),
          byte_size: 10,
          row_count: 1,
          published_by: 'operator',
          created_at: 'x',
          ...overrides,
        };
        return pool().query(
          `INSERT INTO estadistica_forms.feed_versions
             (id, feed_id, artifact_key, tsv_checksum, byte_size, row_count, published_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          Object.values(row),
        );
      };

      for (const overrides of [
        { artifact_key: '../x.tsv' },
        { tsv_checksum: 'A'.repeat(64) },
        { byte_size: 0 },
        { row_count: 0 },
        { row_count: 5001 },
        { published_by: 'robot' },
      ]) {
        await expect(insertVersion(overrides)).rejects.toMatchObject({
          code: '23514',
        });
      }
      await expect(
        pool().query(
          "UPDATE estadistica_forms.feeds SET delivery_token_hash = 'abc' WHERE id = $1",
          [feed.id],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });
});
