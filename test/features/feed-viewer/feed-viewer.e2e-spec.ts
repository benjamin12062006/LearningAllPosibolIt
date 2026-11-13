import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { ArtifactStore } from '../../../src/artifacts/artifact.store.js';
import { ARTIFACT_STORE_OPTIONS } from '../../../src/artifacts/artifacts.types.js';
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
import { FeedViewerModule } from '../../../src/feed-viewer/feed-viewer.module.js';
import { FeedsModule } from '../../../src/feeds/feeds.module.js';
import { FEED_OPTIONS } from '../../../src/feeds/feeds.types.js';
import { ProjectsService } from '../../../src/projects/projects.service.js';
import { RulesetsModule } from '../../../src/rulesets/rulesets.module.js';
import { UsersService } from '../../../src/users/users.service.js';
import {
  catalogValues,
  insertReadySnapshot,
  mixedCatalog,
} from '../evaluations/support/snapshot-fixtures.js';
import { rulesetBody } from '../rulesets/support/ruleset-fixtures.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';

type ProductPage = {
  columns: string[];
  products: { line: number; values: Record<string, string> }[];
  rowCount: number;
  page: { limit: number; offset: number; hasMore: boolean };
};

describe('Visor del feed por HTTP: TSV real de exportaciones y versiones', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let worker: EvaluationWorker;
  let root: string;
  let projectId: string;
  let bobProjectId: string;
  const validateSession = jest.fn<DescopeService['validateSession']>();

  const api = () => request(app.getHttpServer());
  const projectPath = (id = projectId) => `/api/v1/projects/${id}`;
  const asAlice = (test: request.Test) =>
    test.auth('alice-session', { type: 'bearer' });
  const asBob = (test: request.Test) =>
    test.auth('bob-session', { type: 'bearer' });

  const exportProducts = (exportId: string, query = '', id = projectId) =>
    api().get(`${projectPath(id)}/exports/${exportId}/products${query}`);
  const versionProducts = (
    feedId: string,
    versionId: string,
    query = '',
    id = projectId,
  ) =>
    api().get(
      `${projectPath(id)}/feeds/${feedId}/versions/${versionId}/products${query}`,
    );

  const exportProduct = (exportId: string, query: string, id = projectId) =>
    api().get(`${projectPath(id)}/exports/${exportId}/product${query}`);
  const versionProduct = (
    feedId: string,
    versionId: string,
    query: string,
    id = projectId,
  ) =>
    api().get(
      `${projectPath(id)}/feeds/${feedId}/versions/${versionId}/product${query}`,
    );
  const delivery = (feedId: string, id = projectId) =>
    api().get(`${projectPath(id)}/feeds/${feedId}/delivery`);

  /** Bob entra en la organización de Alice solo para leer. */
  async function makeBobViewerOfAlice() {
    await database.connection.pool.query(
      `INSERT INTO estadistica_forms.organization_members
         (organization_id, user_id, role, created_at)
       SELECT p.organization_id, u.id, 'viewer', '2026-11-12T09:00:00.000Z'
       FROM estadistica_forms.projects p, estadistica_forms.app_users u
       WHERE p.id = $1 AND u.identity_subject = $2`,
      [projectId, bob.subject],
    );
  }

  /** Importa, evalúa y exporta un catálogo por HTTP, aprobando lo leído. */
  const exportCatalog = (size: number) => exportRows(mixedCatalog(size));

  async function exportRows(rows: Record<string, string>[]) {
    const snapshotId = await insertReadySnapshot(
      database.connection.pool,
      projectId,
      rows,
    );
    const { body: accepted } = await asAlice(
      api().post(`${projectPath()}/evaluations`),
    )
      .send({ snapshotId, rulesetRevision: 1 })
      .expect(202);
    await worker.runUntilIdle();
    const { body } = await asAlice(api().get(accepted.statusUrl)).expect(200);
    const { body: created } = await asAlice(
      api().post(`${projectPath()}/exports`),
    )
      .send({
        evaluationId: body.evaluation.id,
        resultChecksum: body.evaluation.resultChecksum,
        acceptedInvalidCount: body.evaluation.counts.invalid,
        acceptedExcludedCount: body.evaluation.counts.excluded,
      })
      .expect(201);
    return created.export as {
      id: string;
      rowCount: number;
      evaluationId: string;
    };
  }

  /** El TSV descargado, leído a mano: lo que el visor tiene que devolver. */
  async function downloadedTsv(exportId: string) {
    const { text } = await asAlice(
      api().get(`${projectPath()}/exports/${exportId}/productos.tsv`),
    ).expect(200);
    const [header, ...lines] = text.trimEnd().split('\n');
    const columns = header.split('\t');
    const products = lines.map((line, index) => {
      const cells = line.split('\t');
      return {
        line: index + 2,
        values: Object.fromEntries(
          columns.map((column, position) => [column, cells[position]]),
        ),
      };
    });
    return { columns, products };
  }

  async function publish(feedId: string, exportId: string, generation: number) {
    const { body } = await asAlice(
      api().post(`${projectPath()}/feeds/${feedId}/publications`),
    )
      .send({ exportId, expectedGeneration: generation })
      .expect(201);
    return body.feed.publishedVersion.id as string;
  }

  async function newFeed() {
    const { body } = await asAlice(api().post(`${projectPath()}/feeds`)).expect(
      201,
    );
    return body.feed.id as string;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    root = await mkdtemp(join(tmpdir(), 'feed-viewer-http-'));
    const module = await Test.createTestingModule({
      imports: [
        CatalogImportModule,
        RulesetsModule,
        EvaluationsModule,
        ExportsModule,
        FeedsModule,
        FeedViewerModule,
      ],
    })
      .overrideProvider(POSTGRESQL_CONNECTION)
      .useValue(database.connection)
      .overrideProvider(DescopeService)
      .useValue({ validateSession })
      .overrideProvider(EVALUATION_OPTIONS)
      .useValue({ autoStart: false, pollMs: 1000, shutdownMs: 1000 })
      .overrideProvider(ARTIFACT_STORE_OPTIONS)
      .useValue({ root })
      .overrideProvider(CATALOG_IMPORT_OPTIONS)
      .useValue({ autoStart: false, pollMs: 1000, shutdownMs: 1000 })
      .overrideProvider(EXPORT_OPTIONS)
      .useValue({ autoStart: false })
      // Un solo archivo además del publicado: la segunda publicación retira el primero.
      .overrideProvider(FEED_OPTIONS)
      .useValue({ autoStart: false, retainedFiles: 1 })
      .compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
    worker = app.get(EvaluationWorker);
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
    await database.connection.pool.query(
      'TRUNCATE estadistica_forms.app_users CASCADE',
    );
    await rm(join(root, 'exports'), { recursive: true, force: true });
    await rm(join(root, 'feeds'), { recursive: true, force: true });
    await app.get(ArtifactStore).onModuleInit();
    const users = app.get(UsersService);
    await users.provision(alice);
    await users.provision(bob);
    projectId = (await app.get(ProjectsService).create(alice, projectInput)).id;
    bobProjectId = (await app.get(ProjectsService).create(bob, projectInput))
      .id;
    await asAlice(api().post(`${projectPath()}/rulesets`))
      .send(rulesetBody())
      .expect(201);
  });
  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await database?.close();
      if (root) await rm(root, { recursive: true, force: true });
    }
  });

  describe('exportación', () => {
    it('devuelve exactamente lo que hay en productos.tsv', async () => {
      const exported = await exportCatalog(30);

      const { body } = await asAlice(exportProducts(exported.id)).expect(200);

      const expected = await downloadedTsv(exported.id);
      expect(body).toEqual({
        columns: expected.columns,
        products: expected.products,
        rowCount: exported.rowCount,
        page: { limit: 20, offset: 0, hasMore: false },
      });
      expect(body.rowCount).toBe(10);
      expect(body.columns[0]).toBe('id');
    });

    it('pagina con limit y offset', async () => {
      const exported = await exportCatalog(30);
      const expected = await downloadedTsv(exported.id);

      const first: ProductPage = (
        await asAlice(exportProducts(exported.id, '?limit=4')).expect(200)
      ).body;
      const last: ProductPage = (
        await asAlice(exportProducts(exported.id, '?limit=4&offset=8')).expect(
          200,
        )
      ).body;

      expect(first.products).toEqual(expected.products.slice(0, 4));
      expect(first.page).toEqual({ limit: 4, offset: 0, hasMore: true });
      expect(last.products).toEqual(expected.products.slice(8));
      expect(last.page).toEqual({ limit: 4, offset: 8, hasMore: false });
      // El total es el del archivo, no el de la página.
      expect(last.rowCount).toBe(10);
    });

    it('busca por id o título, recortando espacios', async () => {
      const exported = await exportCatalog(30);
      const expected = await downloadedTsv(exported.id);
      const target = expected.products[3].values.id;

      const { body } = await asAlice(
        exportProducts(
          exported.id,
          `?search=${encodeURIComponent(` ${target.toLowerCase()} `)}`,
        ),
      ).expect(200);

      expect(
        body.products.map((p: { values: { id: string } }) => p.values.id),
      ).toContain(target);
      for (const product of body.products as ProductPage['products']) {
        const text =
          `${product.values.id} ${product.values.title}`.toLowerCase();
        expect(text).toContain(target.toLowerCase());
      }
      expect(body.rowCount).toBe(10);
    });

    it('valida la consulta', async () => {
      const exported = await exportCatalog(6);

      for (const query of [
        '?limit=0',
        '?limit=101',
        '?offset=-1',
        `?search=${'x'.repeat(151)}`,
        '?otro=1',
      ]) {
        await asAlice(exportProducts(exported.id, query))
          .expect(400)
          .expect(({ body }) => expect(body.code).toBeDefined());
      }
    });

    it('una exportación que no existe o un id que no es UUID', async () => {
      await asAlice(exportProducts(randomUUID()))
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('EXPORT_NOT_FOUND')),
        );
      await asAlice(exportProducts('no-es-uuid')).expect(400);
    });

    it('si falta el archivo responde 503', async () => {
      const exported = await exportCatalog(6);
      await rm(join(root, 'exports'), { recursive: true, force: true });
      await app.get(ArtifactStore).onModuleInit();
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await asAlice(exportProducts(exported.id))
        .expect(503)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('EXPORT_FILE_UNAVAILABLE')),
        );
    });
  });

  describe('versión del feed', () => {
    it('devuelve el TSV de la versión publicada, igual que su exportación', async () => {
      const feedId = await newFeed();
      const exported = await exportCatalog(30);
      const versionId = await publish(feedId, exported.id, 0);

      const { body } = await asAlice(
        versionProducts(feedId, versionId, '?limit=100'),
      ).expect(200);

      const expected = await downloadedTsv(exported.id);
      expect(body).toEqual({
        columns: expected.columns,
        products: expected.products,
        rowCount: 10,
        page: { limit: 100, offset: 0, hasMore: false },
      });
    });

    it('una versión antigua sigue visible mientras su archivo se conserva y da 410 al retirarse', async () => {
      const feedId = await newFeed();
      const first = await exportCatalog(6);
      const firstVersion = await publish(feedId, first.id, 0);
      await asAlice(versionProducts(feedId, firstVersion)).expect(200);

      const second = await exportCatalog(9);
      await publish(feedId, second.id, 1);

      await asAlice(versionProducts(feedId, firstVersion))
        .expect(410)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('FEED_VERSION_FILE_RETIRED')),
        );
    });

    it('una versión de otro feed o que no existe responde 404', async () => {
      const feedId = await newFeed();
      const exported = await exportCatalog(6);
      const versionId = await publish(feedId, exported.id, 0);

      await asAlice(versionProducts(feedId, randomUUID()))
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('FEED_VERSION_NOT_FOUND')),
        );
      await asAlice(versionProducts(randomUUID(), versionId))
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('FEED_NOT_FOUND')),
        );
    });

    it('si falta el archivo de la versión responde 503 y lo registra', async () => {
      const feedId = await newFeed();
      const exported = await exportCatalog(6);
      const versionId = await publish(feedId, exported.id, 0);
      await rm(join(root, 'feeds'), { recursive: true, force: true });
      await app.get(ArtifactStore).onModuleInit();
      const logError = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await asAlice(versionProducts(feedId, versionId))
        .expect(503)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('FEED_FILE_UNAVAILABLE')),
        );
      expect(logError).toHaveBeenCalledWith({
        code: 'FEED_FILE_MISSING',
        versionId,
      });
    });
  });

  describe('aislamiento y sesión', () => {
    it('Bob no ve la exportación ni la versión de Alice, ni desde su proyecto', async () => {
      const feedId = await newFeed();
      const exported = await exportCatalog(6);
      const versionId = await publish(feedId, exported.id, 0);

      await asBob(exportProducts(exported.id)).expect(404);
      await asBob(versionProducts(feedId, versionId)).expect(404);
      await asBob(exportProducts(exported.id, '', bobProjectId))
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('EXPORT_NOT_FOUND')),
        );
      await asBob(versionProducts(feedId, versionId, '', bobProjectId))
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('FEED_NOT_FOUND')),
        );
    });

    it('Bob no lee una versión de Alice a través de su propio feed', async () => {
      const aliceFeed = await newFeed();
      const exported = await exportCatalog(6);
      const aliceVersion = await publish(aliceFeed, exported.id, 0);
      const { body } = await asBob(
        api().post(`${projectPath(bobProjectId)}/feeds`),
      ).expect(201);

      await asBob(versionProducts(body.feed.id, aliceVersion, '', bobProjectId))
        .expect(404)
        .expect(({ body: error }) =>
          expect(error).toMatchObject(publicError('FEED_VERSION_NOT_FOUND')),
        );
    });

    it('sin sesión responde 401', async () => {
      const exported = await exportCatalog(6);

      await exportProducts(exported.id).expect(401);
      await versionProducts(randomUUID(), randomUUID()).expect(401);
    });
  });

  describe('ficha de producto', () => {
    it('da los valores exactos del producto en la exportación y de dónde sale', async () => {
      const exported = await exportCatalog(30);
      const expected = await downloadedTsv(exported.id);
      const wanted = expected.products[4];

      const { body } = await asAlice(
        exportProduct(exported.id, `?id=${wanted.values.id}`),
      ).expect(200);

      expect(body.columns).toEqual(expected.columns);
      expect(body.product).toEqual(wanted);
      expect(body.source).toMatchObject({
        kind: 'export',
        export: {
          id: exported.id,
          evaluationId: exported.evaluationId,
          rowCount: 10,
        },
      });
      expect(Object.keys(body).sort()).toEqual([
        'columns',
        'product',
        'source',
      ]);
    });

    it('un producto inválido o excluido no está en el archivo: 404 propio', async () => {
      const exported = await exportCatalog(6);

      // mixedCatalog: SKU-2 tiene el precio mal y SKU-3 lo excluye una regla.
      for (const productId of ['SKU-2', 'SKU-3', 'sku-1', 'NO-EXISTE']) {
        await asAlice(exportProduct(exported.id, `?id=${productId}`))
          .expect(404)
          .expect(({ body }) =>
            expect(body).toMatchObject(publicError('PRODUCT_NOT_FOUND')),
          );
      }
    });

    it('acepta un id con barras y signos, codificado en la consulta', async () => {
      const productId = 'A/1 ñ?&=#';
      const exported = await exportRows([
        catalogValues('SKU-1'),
        // El enlace por defecto se forma con el SKU y no sería una URL válida.
        catalogValues(productId, {
          URL: 'https://tienda.example/a-1',
          Imagen: 'https://tienda.example/a-1.jpg',
        }),
      ]);

      const { body } = await asAlice(
        exportProduct(exported.id, `?id=${encodeURIComponent(productId)}`),
      ).expect(200);

      expect(body.product.values.id).toBe(productId);
      expect(body.product.line).toBe(3);
    });

    it('valida la consulta', async () => {
      const exported = await exportCatalog(6);

      for (const query of [
        '',
        '?id=',
        `?id=${'x'.repeat(201)}`,
        '?id=SKU-1&otro=1',
        '?id=SKU-1&id=SKU-4',
      ]) {
        await asAlice(exportProduct(exported.id, query))
          .expect(400)
          .expect(({ body }) => expect(body.code).toBeDefined());
      }
    });

    it('la ficha de la versión publicada dice que es la vigente y de qué evaluación sale', async () => {
      const feedId = await newFeed();
      const exported = await exportCatalog(6);
      const versionId = await publish(feedId, exported.id, 0);

      const { body } = await asAlice(
        versionProduct(feedId, versionId, '?id=SKU-4'),
      ).expect(200);

      expect(body.product.values.id).toBe('SKU-4');
      expect(body.source).toMatchObject({
        kind: 'feed_version',
        feedId,
        version: {
          id: versionId,
          exportId: exported.id,
          evaluationId: exported.evaluationId,
          current: true,
          fileRetained: true,
          publishedBy: 'operator',
        },
      });
    });

    it('una versión retenida conserva sus valores aunque se publique otra', async () => {
      const options = app.get<{ retainedFiles: number }>(FEED_OPTIONS);
      options.retainedFiles = 3;
      try {
        const feedId = await newFeed();
        const before = await exportRows([
          catalogValues('SKU-1', { Precio: '10.00' }),
        ]);
        const oldVersion = await publish(feedId, before.id, 0);
        const after = await exportRows([
          catalogValues('SKU-1', { Precio: '25.00' }),
        ]);
        const newVersion = await publish(feedId, after.id, 1);

        const old = await asAlice(
          versionProduct(feedId, oldVersion, '?id=SKU-1'),
        ).expect(200);
        const current = await asAlice(
          versionProduct(feedId, newVersion, '?id=SKU-1'),
        ).expect(200);

        expect(old.body.product.values.price).toBe('10.00 USD');
        expect(old.body.source.version).toMatchObject({
          id: oldVersion,
          current: false,
          fileRetained: true,
        });
        expect(current.body.product.values.price).toBe('25.00 USD');
        expect(current.body.source.version.current).toBe(true);
      } finally {
        options.retainedFiles = 1;
      }
    });

    it('una versión retirada responde 410 y una que no existe, 404', async () => {
      const feedId = await newFeed();
      const first = await exportCatalog(6);
      const firstVersion = await publish(feedId, first.id, 0);
      const second = await exportCatalog(9);
      await publish(feedId, second.id, 1);

      await asAlice(versionProduct(feedId, firstVersion, '?id=SKU-1'))
        .expect(410)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('FEED_VERSION_FILE_RETIRED')),
        );
      await asAlice(versionProduct(feedId, randomUUID(), '?id=SKU-1'))
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('FEED_VERSION_NOT_FOUND')),
        );
      await asAlice(exportProduct(randomUUID(), '?id=SKU-1'))
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('EXPORT_NOT_FOUND')),
        );
    });

    it('un Viewer la lee; otra organización recibe 404 y sin sesión, 401', async () => {
      const feedId = await newFeed();
      const exported = await exportCatalog(6);
      const versionId = await publish(feedId, exported.id, 0);

      await asBob(exportProduct(exported.id, '?id=SKU-1')).expect(404);
      await asBob(versionProduct(feedId, versionId, '?id=SKU-1')).expect(404);
      await asBob(exportProduct(exported.id, '?id=SKU-1', bobProjectId))
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('EXPORT_NOT_FOUND')),
        );
      await exportProduct(exported.id, '?id=SKU-1').expect(401);
      await versionProduct(feedId, versionId, '?id=SKU-1').expect(401);

      await makeBobViewerOfAlice();
      await asBob(exportProduct(exported.id, '?id=SKU-1')).expect(200);
      await asBob(versionProduct(feedId, versionId, '?id=SKU-1')).expect(200);
    });
  });

  describe('estado de la entrega', () => {
    /** Crea el feed y devuelve también su URL pública, que solo sale al crearlo. */
    async function newFeedWithUrl() {
      const { body } = await asAlice(
        api().post(`${projectPath()}/feeds`),
      ).expect(201);
      // `deliveryUrl` es la ruta pública, sin dominio.
      const publicPath = body.deliveryUrl as string;
      return { feedId: body.feed.id as string, publicPath };
    }

    it('sin publicar: no entrega y dice por qué; la URL pública responde 404', async () => {
      const { feedId, publicPath } = await newFeedWithUrl();

      const { body } = await asAlice(delivery(feedId)).expect(200);

      expect(body).toEqual({
        delivery: {
          delivering: false,
          reason: 'no_published_version',
          deliveryEnabled: true,
          publishedVersion: null,
        },
      });
      await api().get(publicPath).expect(404);
    });

    it('publicado: entrega, y la URL pública sirve esa versión', async () => {
      const { feedId, publicPath } = await newFeedWithUrl();
      const exported = await exportCatalog(6);
      const versionId = await publish(feedId, exported.id, 0);

      const { body } = await asAlice(delivery(feedId)).expect(200);

      expect(body.delivery).toMatchObject({
        delivering: true,
        reason: null,
        deliveryEnabled: true,
        publishedVersion: { id: versionId, exportId: exported.id },
      });
      const expected = await asAlice(
        api().get(`${projectPath()}/exports/${exported.id}/productos.tsv`),
      ).expect(200);
      const served = await api().get(publicPath).expect(200);
      expect(served.text).toBe(expected.text);
      // La respuesta explica, pero no enseña el token de la URL.
      const token = publicPath.split('/').pop()!.replace('.tsv', '');
      expect(JSON.stringify(body)).not.toContain(token);
    });

    it('entrega desactivada: lo dice, y vuelve a entregar al crear otro token', async () => {
      const { feedId, publicPath } = await newFeedWithUrl();
      const exported = await exportCatalog(6);
      await publish(feedId, exported.id, 0);
      await asAlice(
        api().delete(`${projectPath()}/feeds/${feedId}/delivery-token`),
      ).expect(({ status }) => expect(status).toBeLessThan(300));

      const disabled = await asAlice(delivery(feedId)).expect(200);

      expect(disabled.body.delivery).toMatchObject({
        delivering: false,
        reason: 'delivery_disabled',
        deliveryEnabled: false,
      });
      expect(disabled.body.delivery.publishedVersion).not.toBeNull();
      await api().get(publicPath).expect(404);

      await asAlice(
        api().post(`${projectPath()}/feeds/${feedId}/delivery-token`),
      ).expect(({ status }) => expect(status).toBeLessThan(300));
      const enabled = await asAlice(delivery(feedId)).expect(200);
      expect(enabled.body.delivery).toMatchObject({
        delivering: true,
        reason: null,
      });
    });

    it('si falta el archivo publicado, no entrega y lo dice', async () => {
      const { feedId } = await newFeedWithUrl();
      const exported = await exportCatalog(6);
      await publish(feedId, exported.id, 0);
      await rm(join(root, 'feeds'), { recursive: true, force: true });
      await app.get(ArtifactStore).onModuleInit();

      const { body } = await asAlice(delivery(feedId)).expect(200);

      expect(body.delivery).toMatchObject({
        delivering: false,
        reason: 'file_unavailable',
        deliveryEnabled: true,
      });
    });

    it('un Viewer lo lee; otra organización recibe 404 y sin sesión, 401', async () => {
      const { feedId } = await newFeedWithUrl();

      await asBob(delivery(feedId)).expect(404);
      await asBob(delivery(feedId, bobProjectId))
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('FEED_NOT_FOUND')),
        );
      await delivery(feedId).expect(401);
      await asAlice(delivery(randomUUID())).expect(404);

      await makeBobViewerOfAlice();
      await asBob(delivery(feedId)).expect(200);
    });
  });

  describe('comparar con la versión vigente', () => {
    const comparison = (feedId: string, query: string, id = projectId) =>
      api().get(`${projectPath(id)}/feeds/${feedId}/comparison${query}`);

    const PUBLISHED_CATALOG = [
      catalogValues('SKU-1', { Precio: '10.00' }),
      catalogValues('SKU-2', { Precio: '20.00' }),
      catalogValues('SKU-3', { Precio: '30.00' }),
      catalogValues('SKU-4', { Precio: '40.00' }),
    ];
    /** Sube un precio, cambia una disponibilidad, quita SKU-3 y añade SKU-5. */
    const CANDIDATE_CATALOG = [
      catalogValues('SKU-1', { Precio: '10.00' }),
      catalogValues('SKU-2', { Precio: '25.00' }),
      catalogValues('SKU-4', { Precio: '40.00', Stock: 'out_of_stock' }),
      catalogValues('SKU-5', { Precio: '50.00' }),
      // Sin imagen: es inválido, no entra en el TSV y por eso no es un «añadido».
      catalogValues('SKU-6', { Imagen: '' }),
    ];

    /** Un feed con el catálogo publicado y otra exportación lista para comparar. */
    async function publishedAndCandidate() {
      const { body } = await asAlice(
        api().post(`${projectPath()}/feeds`),
      ).expect(201);
      const feedId = body.feed.id as string;
      const before = await exportRows(PUBLISHED_CATALOG);
      const versionId = await publish(feedId, before.id, 0);
      const candidate = await exportRows(CANDIDATE_CATALOG);
      return {
        feedId,
        versionId,
        before,
        candidate,
        publicPath: body.deliveryUrl as string,
      };
    }

    it('dice qué se añade, qué se retira y qué valores cambian', async () => {
      const { feedId, versionId, candidate } = await publishedAndCandidate();

      const { body } = await asAlice(
        comparison(feedId, `?exportId=${candidate.id}`),
      ).expect(200);

      expect(body.comparison.counts).toEqual({
        added: 1,
        removed: 1,
        modified: 2,
        unchanged: 1,
      });
      expect(body.comparison.changedFields).toEqual([
        { field: 'availability', productCount: 1 },
        { field: 'price', productCount: 1 },
      ]);
      expect(body.comparison.changes).toEqual([
        {
          id: 'SKU-2',
          change: 'modified',
          fields: [{ field: 'price', before: '20.00 USD', after: '25.00 USD' }],
        },
        {
          id: 'SKU-4',
          change: 'modified',
          fields: [
            {
              field: 'availability',
              before: 'in_stock',
              after: 'out_of_stock',
            },
          ],
        },
        { id: 'SKU-5', change: 'added', fields: [] },
        { id: 'SKU-3', change: 'removed', fields: [] },
      ]);
      expect(body.comparison.page).toEqual({
        limit: 20,
        offset: 0,
        hasMore: false,
      });
      // Identifica las dos versiones que compara.
      expect(body.comparison.candidate).toMatchObject({
        id: candidate.id,
        evaluationId: candidate.evaluationId,
        rowCount: 4,
      });
      expect(body.comparison.published).toMatchObject({
        id: versionId,
        rowCount: 4,
      });
    });

    it('filtra por tipo de cambio y pagina; los recuentos son del archivo entero', async () => {
      const { feedId, candidate } = await publishedAndCandidate();
      const query = `?exportId=${candidate.id}`;

      const modified = await asAlice(
        comparison(feedId, `${query}&change=modified&limit=1`),
      ).expect(200);
      const second = await asAlice(
        comparison(feedId, `${query}&change=modified&limit=1&offset=1`),
      ).expect(200);
      const removed = await asAlice(
        comparison(feedId, `${query}&change=removed`),
      ).expect(200);

      expect(
        modified.body.comparison.changes.map((c: { id: string }) => c.id),
      ).toEqual(['SKU-2']);
      expect(modified.body.comparison.page).toEqual({
        limit: 1,
        offset: 0,
        hasMore: true,
      });
      expect(
        second.body.comparison.changes.map((c: { id: string }) => c.id),
      ).toEqual(['SKU-4']);
      expect(second.body.comparison.page.hasMore).toBe(false);
      expect(
        removed.body.comparison.changes.map((c: { id: string }) => c.id),
      ).toEqual(['SKU-3']);
      for (const response of [modified, second, removed]) {
        expect(response.body.comparison.counts).toEqual({
          added: 1,
          removed: 1,
          modified: 2,
          unchanged: 1,
        });
      }
    });

    it('comparar no publica: la URL pública sigue sirviendo la versión vigente', async () => {
      const { feedId, versionId, before, candidate, publicPath } =
        await publishedAndCandidate();
      const expected = await asAlice(
        api().get(`${projectPath()}/exports/${before.id}/productos.tsv`),
      ).expect(200);

      await asAlice(comparison(feedId, `?exportId=${candidate.id}`)).expect(
        200,
      );

      const served = await api().get(publicPath).expect(200);
      expect(served.text).toBe(expected.text);
      const { body } = await asAlice(
        api().get(`${projectPath()}/feeds/${feedId}`),
      ).expect(200);
      expect(body.feed).toMatchObject({
        generation: 1,
        publishedVersion: { id: versionId },
      });
    });

    it('la exportación ya publicada no tiene cambios', async () => {
      const { feedId, before } = await publishedAndCandidate();

      const { body } = await asAlice(
        comparison(feedId, `?exportId=${before.id}`),
      ).expect(200);

      expect(body.comparison.counts).toEqual({
        added: 0,
        removed: 0,
        modified: 0,
        unchanged: 4,
      });
      expect(body.comparison.changes).toEqual([]);
      expect(body.comparison.changedFields).toEqual([]);
    });

    it('sin versión publicada no hay con qué comparar: 409', async () => {
      const feedId = await newFeed();
      const candidate = await exportRows(CANDIDATE_CATALOG);

      await asAlice(comparison(feedId, `?exportId=${candidate.id}`))
        .expect(409)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('FEED_NOT_PUBLISHED')),
        );
    });

    it('valida la consulta', async () => {
      const { feedId, candidate } = await publishedAndCandidate();

      for (const query of [
        '',
        '?exportId=no-es-uuid',
        `?exportId=${candidate.id}&change=igual`,
        `?exportId=${candidate.id}&limit=0`,
        `?exportId=${candidate.id}&otro=1`,
      ]) {
        await asAlice(comparison(feedId, query))
          .expect(400)
          .expect(({ body }) => expect(body.code).toBeDefined());
      }
    });

    it('una exportación o un feed que no existen responden 404', async () => {
      const { feedId, candidate } = await publishedAndCandidate();

      await asAlice(comparison(feedId, `?exportId=${randomUUID()}`))
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('EXPORT_NOT_FOUND')),
        );
      await asAlice(comparison(randomUUID(), `?exportId=${candidate.id}`))
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('FEED_NOT_FOUND')),
        );
    });

    it('un Viewer la lee; otra organización recibe 404 y sin sesión, 401', async () => {
      const { feedId, candidate } = await publishedAndCandidate();
      const query = `?exportId=${candidate.id}`;
      const { body: bobFeed } = await asBob(
        api().post(`${projectPath(bobProjectId)}/feeds`),
      ).expect(201);

      await asBob(comparison(feedId, query)).expect(404);
      await asBob(comparison(feedId, query, bobProjectId)).expect(404);
      // Ni con su propio feed puede comparar contra una exportación de Alice.
      await asBob(comparison(bobFeed.feed.id, query, bobProjectId))
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('EXPORT_NOT_FOUND')),
        );
      await comparison(feedId, query).expect(401);

      await makeBobViewerOfAlice();
      await asBob(comparison(feedId, query)).expect(200);
    });
  });
});
