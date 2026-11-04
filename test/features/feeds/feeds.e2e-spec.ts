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
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
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
import { FeedsModule } from '../../../src/feeds/feeds.module.js';
import { FEED_OPTIONS } from '../../../src/feeds/feeds.types.js';
import { ProjectsService } from '../../../src/projects/projects.service.js';
import { RulesetsModule } from '../../../src/rulesets/rulesets.module.js';
import { UsersService } from '../../../src/users/users.service.js';
import { rulesetBody } from '../rulesets/support/ruleset-fixtures.js';
import {
  insertReadySnapshot,
  mixedCatalog,
} from '../evaluations/support/snapshot-fixtures.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';

type Feed = {
  id: string;
  generation: number;
  publishedVersion: { id: string; exportId: string | null } | null;
};

describe('Feeds y publicaciones HTTP con guard, DTOs, exportaciones y almacén reales', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let worker: EvaluationWorker;
  let root: string;
  let projectId: string;
  let bobProjectId: string;
  /** Snapshot de la última llamada a `exportCatalog`, para borrarlo. */
  let lastSnapshotId: string;
  const validateSession = jest.fn<DescopeService['validateSession']>();

  const api = () => request(app.getHttpServer());
  const feedsOf = (id = projectId) => `/api/v1/projects/${id}/feeds`;
  const as = (token: string) => ({
    token,
    options: { type: 'bearer' as const },
  });
  const aliceSession = as('alice-session');
  const bobSession = as('bob-session');
  const pool = () => database.connection.pool;

  const createFeed = (session = aliceSession, id = projectId) =>
    api().post(feedsOf(id)).auth(session.token, session.options);
  const getFeed = (feedId: string, session = aliceSession, id = projectId) =>
    api()
      .get(`${feedsOf(id)}/${feedId}`)
      .auth(session.token, session.options);
  const postPublication = (
    feedId: string,
    body: unknown,
    session = aliceSession,
    id = projectId,
  ) =>
    api()
      .post(`${feedsOf(id)}/${feedId}/publications`)
      .auth(session.token, session.options)
      .send(body as object);

  /** Importa un catálogo listo, lo evalúa y lo exporta por HTTP aprobando lo leído. */
  async function exportCatalog(size: number) {
    lastSnapshotId = await insertReadySnapshot(
      pool(),
      projectId,
      mixedCatalog(size),
    );
    const { body: accepted } = await api()
      .post(`/api/v1/projects/${projectId}/evaluations`)
      .auth('alice-session', { type: 'bearer' })
      .send({ snapshotId: lastSnapshotId, rulesetRevision: 1 })
      .expect(202);
    await worker.runUntilIdle();
    const { body } = await api()
      .get(accepted.statusUrl)
      .auth('alice-session', { type: 'bearer' })
      .expect(200);
    const { body: created } = await api()
      .post(`/api/v1/projects/${projectId}/exports`)
      .auth('alice-session', { type: 'bearer' })
      .send({
        evaluationId: body.evaluation.id,
        resultChecksum: body.evaluation.resultChecksum,
        acceptedInvalidCount: body.evaluation.counts.invalid,
        acceptedExcludedCount: body.evaluation.counts.excluded,
      })
      .expect(201);
    return created.export as { id: string; tsvChecksum: string };
  }

  async function newFeed(): Promise<Feed> {
    const { body } = await createFeed().expect(201);
    return body.feed;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    root = await mkdtemp(join(tmpdir(), 'feeds-http-'));
    const module = await Test.createTestingModule({
      imports: [
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
      .overrideProvider(EVALUATION_OPTIONS)
      .useValue({ autoStart: false, pollMs: 1000, shutdownMs: 1000 })
      .overrideProvider(ARTIFACT_STORE_OPTIONS)
      .useValue({ root })
      .overrideProvider(CATALOG_IMPORT_OPTIONS)
      .useValue({ autoStart: false, pollMs: 1000, shutdownMs: 1000 })
      .overrideProvider(EXPORT_OPTIONS)
      .useValue({ autoStart: false })
      .overrideProvider(FEED_OPTIONS)
      .useValue({ autoStart: false, retainedFiles: 3 })
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
    await pool().query('TRUNCATE estadistica_forms.app_users CASCADE');
    // TRUNCATE borra las filas, no los archivos: cada prueba empieza sin TSV.
    await rm(join(root, 'exports'), { recursive: true, force: true });
    await rm(join(root, 'feeds'), { recursive: true, force: true });
    await app.get(ArtifactStore).onModuleInit();
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
  });
  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await database?.close();
      if (root) await rm(root, { recursive: true, force: true });
    }
  });

  it('recorrido: crear el feed, exportar, publicar con 201 y consultar', async () => {
    const { body: created } = await createFeed().expect(201);
    expect(created).toEqual({
      feed: {
        id: expect.any(String),
        generation: 0,
        deliveryEnabled: true,
        publishedVersion: null,
        source: null,
        policy: null,
        schedule: null,
        lastRefresh: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
      deliveryUrl: expect.stringMatching(/^\/feeds\/[A-Za-z0-9_-]{43}\.tsv$/),
    });
    const source = await exportCatalog(6);

    const { body: published } = await postPublication(created.feed.id, {
      exportId: source.id,
      expectedGeneration: 0,
    }).expect(201);

    expect(published).toEqual({
      feed: {
        ...created.feed,
        generation: 1,
        publishedVersion: {
          id: expect.any(String),
          exportId: source.id,
          evaluationId: expect.any(String),
          rowCount: 2,
          byteSize: expect.any(Number),
          tsvChecksum: source.tsvChecksum,
          publishedBy: 'operator',
          publishedAt: expect.any(String),
        },
        updatedAt: expect.any(String),
      },
    });
    await getFeed(created.feed.id)
      .expect(200)
      .expect(({ body }) => expect(body).toEqual(published));
    await api()
      .get(feedsOf())
      .auth('alice-session', { type: 'bearer' })
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({ items: [published.feed] }));
  });

  it('el token solo aparece al crear: ni la consulta ni la publicación lo devuelven', async () => {
    const { body: created } = await createFeed().expect(201);
    const token = /\/feeds\/(.+)\.tsv$/.exec(created.deliveryUrl)![1];
    const source = await exportCatalog(6);

    const responses = [
      (await getFeed(created.feed.id).expect(200)).text,
      (
        await postPublication(created.feed.id, {
          exportId: source.id,
          expectedGeneration: 0,
        }).expect(201)
      ).text,
      (await api().get(feedsOf()).auth('alice-session', { type: 'bearer' }))
        .text,
    ];
    for (const text of responses) {
      expect(text).not.toContain(token);
      expect(text).not.toContain('Hash');
    }
  });

  it('un segundo feed en el mismo proyecto: 409', async () => {
    await newFeed();

    await createFeed()
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('FEED_ALREADY_EXISTS')),
      );
  });

  it('una generación antigua: 409 y la versión publicada no cambia', async () => {
    const feed = await newFeed();
    const first = await exportCatalog(6);
    await postPublication(feed.id, {
      exportId: first.id,
      expectedGeneration: 0,
    }).expect(201);
    const second = await exportCatalog(9);

    await postPublication(feed.id, {
      exportId: second.id,
      expectedGeneration: 0,
    })
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('FEED_GENERATION_CONFLICT')),
      );
    await getFeed(feed.id).expect(({ body }) => {
      expect(body.feed.generation).toBe(1);
      expect(body.feed.publishedVersion.exportId).toBe(first.id);
    });
  });

  it('publicar otra vez lo mismo responde 200 sin versión nueva', async () => {
    const feed = await newFeed();
    const source = await exportCatalog(6);
    const { body: first } = await postPublication(feed.id, {
      exportId: source.id,
      expectedGeneration: 0,
    }).expect(201);

    await postPublication(feed.id, {
      exportId: source.id,
      expectedGeneration: 1,
    })
      .expect(200)
      .expect(({ body }) => expect(body).toEqual(first));
    expect(await readdir(join(root, 'feeds'))).toHaveLength(1);
  });

  it('valida el body: UUID y generación entera no negativa', async () => {
    const feed = await newFeed();

    await postPublication(feed.id, { exportId: 'x', expectedGeneration: -1 })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('VALIDATION_FAILED');
        expect(
          body.issues.map((issue: { field: string }) => issue.field).sort(),
        ).toEqual(['expectedGeneration', 'exportId']);
      });
    await postPublication(feed.id, {
      exportId: randomUUID(),
      expectedGeneration: '0',
    }).expect(400);
    await postPublication(feed.id, {
      exportId: randomUUID(),
      expectedGeneration: 1.5,
    }).expect(400);
    await postPublication(feed.id, {
      exportId: randomUUID(),
      expectedGeneration: 0,
      publishedBy: 'refresh',
    }).expect(400);
  });

  it('una exportación o un feed que no existen, e ids que no son UUID', async () => {
    const feed = await newFeed();

    await postPublication(feed.id, {
      exportId: randomUUID(),
      expectedGeneration: 0,
    })
      .expect(404)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('EXPORT_NOT_FOUND')),
      );
    await getFeed(randomUUID())
      .expect(404)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('FEED_NOT_FOUND')),
      );
    await getFeed('no-es-uuid').expect(400);
  });

  describe('aislamiento entre propietarios', () => {
    it('Bob no consulta, publica ni crea en el proyecto de Alice', async () => {
      const feed = await newFeed();
      const source = await exportCatalog(6);

      await getFeed(feed.id, bobSession).expect(404);
      await postPublication(
        feed.id,
        { exportId: source.id, expectedGeneration: 0 },
        bobSession,
      ).expect(404);
      await createFeed(bobSession).expect(404);
      await api()
        .get(feedsOf())
        .auth('bob-session', { type: 'bearer' })
        .expect(404);
    });

    it('Bob no usa el feed ni la exportación de Alice desde su proyecto', async () => {
      const feed = await newFeed();
      const source = await exportCatalog(6);
      const { body: bobFeed } = await createFeed(
        bobSession,
        bobProjectId,
      ).expect(201);

      await getFeed(feed.id, bobSession, bobProjectId).expect(404);
      await postPublication(
        bobFeed.feed.id,
        { exportId: source.id, expectedGeneration: 0 },
        bobSession,
        bobProjectId,
      ).expect(404);
      expect(await readdir(join(root, 'feeds'))).toEqual([]);
    });
  });

  it('borrar la importación de origen no cambia la versión publicada', async () => {
    const feed = await newFeed();
    const source = await exportCatalog(6);
    const { body: published } = await postPublication(feed.id, {
      exportId: source.id,
      expectedGeneration: 0,
    }).expect(201);

    await api()
      .delete(`/api/v1/projects/${projectId}/imports/${lastSnapshotId}`)
      .auth('alice-session', { type: 'bearer' })
      .expect(204);

    expect(await readdir(join(root, 'exports'))).toEqual([]);
    await getFeed(feed.id).expect(({ body }) =>
      expect(body.feed.publishedVersion).toEqual({
        ...published.feed.publishedVersion,
        exportId: null,
        evaluationId: null,
      }),
    );
    const content = await readFile(
      join(root, 'feeds', `${published.feed.publishedVersion.id}.tsv`),
      'utf8',
    );
    expect(content.startsWith('id\t')).toBe(true);
  });

  it('borrar el proyecto borra su feed y retira sus archivos', async () => {
    const feed = await newFeed();
    const source = await exportCatalog(6);
    await postPublication(feed.id, {
      exportId: source.id,
      expectedGeneration: 0,
    }).expect(201);
    expect(await readdir(join(root, 'feeds'))).toHaveLength(1);

    await api()
      .delete(`/api/v1/projects/${projectId}`)
      .auth('alice-session', { type: 'bearer' })
      .expect(204);

    const { rows } = await pool().query(
      'SELECT id FROM estadistica_forms.feeds WHERE id = $1',
      [feed.id],
    );
    expect(rows).toEqual([]);
    expect(await readdir(join(root, 'feeds'))).toEqual([]);
  });

  describe('PUT …/source', () => {
    const putSource = (
      feedId: string,
      body: unknown,
      session = aliceSession,
      id = projectId,
    ) =>
      api()
        .put(`${feedsOf(id)}/${feedId}/source`)
        .auth(session.token, session.options)
        .send(body as object);

    it('guarda la fuente y GET la devuelve', async () => {
      const feed = await newFeed();
      const source = {
        url: 'https://tienda.example.com/export.csv?dia=hoy',
        idColumn: 'SKU',
        delimiter: 'semicolon',
      };

      const { body } = await putSource(feed.id, source).expect(200);

      expect(body.feed.source).toEqual(source);
      await getFeed(feed.id).expect(({ body: read }) =>
        expect(read.feed.source).toEqual(source),
      );
    });

    it('el separador por defecto es la coma, como en la importación', async () => {
      const feed = await newFeed();

      const { body } = await putSource(feed.id, {
        url: 'https://tienda.example.com/a.csv',
        idColumn: 'id',
      }).expect(200);

      expect(body.feed.source.delimiter).toBe('comma');
    });

    it('rechaza URLs no https, con credenciales o que no son URL', async () => {
      const feed = await newFeed();

      for (const url of [
        'http://tienda.example.com/a.csv',
        'ftp://tienda.example.com/a.csv',
        'https://usuario:clave@tienda.example.com/a.csv',
        'no es una url',
        `https://tienda.example.com/${'a'.repeat(2048)}`,
        42,
      ]) {
        await putSource(feed.id, { url, idColumn: 'id' })
          .expect(400)
          .expect(({ body }) => {
            expect(body.code).toBe('VALIDATION_FAILED');
            // Un número falla dos reglas del mismo campo (texto y URL).
            expect(
              new Set(
                body.issues.map((issue: { field: string }) => issue.field),
              ),
            ).toEqual(new Set(['url']));
          });
      }
    });

    it('valida columna y separador con las reglas de la importación', async () => {
      const feed = await newFeed();

      await putSource(feed.id, {
        url: 'https://tienda.example.com/a.csv',
        idColumn: '  ',
        delimiter: 'tab',
      })
        .expect(400)
        .expect(({ body }) =>
          expect(
            body.issues.map((issue: { field: string }) => issue.field).sort(),
          ).toEqual(['delimiter', 'idColumn']),
        );
      await putSource(feed.id, {}).expect(400);
    });

    it('Bob no cambia la fuente del feed de Alice', async () => {
      const feed = await newFeed();
      const body = { url: 'https://tienda.example.com/a.csv', idColumn: 'id' };

      await putSource(feed.id, body, bobSession).expect(404);
      await putSource(feed.id, body, bobSession, bobProjectId).expect(404);
      await getFeed(feed.id).expect(({ body: read }) =>
        expect(read.feed.source).toBeNull(),
      );
    });

    it('sin sesión responde 401', async () => {
      await api()
        .put(`${feedsOf()}/${randomUUID()}/source`)
        .send({})
        .expect(401);
    });
  });

  describe('GET …/versions', () => {
    const getVersions = (
      feedId: string,
      query = '',
      session = aliceSession,
      id = projectId,
    ) =>
      api()
        .get(`${feedsOf(id)}/${feedId}/versions${query}`)
        .auth(session.token, session.options);

    it('lista las versiones publicadas con su página', async () => {
      const feed = await newFeed();
      const first = await exportCatalog(6);
      await postPublication(feed.id, {
        exportId: first.id,
        expectedGeneration: 0,
      }).expect(201);
      const second = await exportCatalog(9);
      await postPublication(feed.id, {
        exportId: second.id,
        expectedGeneration: 1,
      }).expect(201);

      const { body } = await getVersions(feed.id, '?limit=1').expect(200);

      expect(body).toEqual({
        versions: [
          {
            id: expect.any(String),
            exportId: second.id,
            evaluationId: expect.any(String),
            rowCount: expect.any(Number),
            byteSize: expect.any(Number),
            tsvChecksum: second.tsvChecksum,
            publishedBy: 'operator',
            publishedAt: expect.any(String),
            current: true,
            fileRetained: true,
          },
        ],
        page: { limit: 1, offset: 0, hasMore: true },
      });
      expect(JSON.stringify(body)).not.toContain('artifact');
    });

    it('valida la paginación y el aislamiento', async () => {
      const feed = await newFeed();

      await getVersions(feed.id, '?limit=0').expect(400);
      await getVersions(feed.id, '?limit=101').expect(400);
      await getVersions(feed.id, '?offset=-1').expect(400);
      await getVersions(randomUUID()).expect(404);
      await getVersions(feed.id, '', bobSession).expect(404);
      await getVersions(feed.id, '', bobSession, bobProjectId).expect(404);
      await api().get(`${feedsOf()}/${feed.id}/versions`).expect(401);
    });
  });

  describe('PUT …/schedule', () => {
    const putSchedule = (
      feedId: string,
      body: unknown,
      session = aliceSession,
      id = projectId,
    ) =>
      api()
        .put(`${feedsOf(id)}/${feedId}/schedule`)
        .auth(session.token, session.options)
        .send(body as object);

    it('guarda la programación y GET la devuelve', async () => {
      const feed = await newFeed();
      const schedule = {
        enabled: true,
        refreshTime: '06:30',
        timeZone: 'Europe/Madrid',
      };

      const { body } = await putSchedule(feed.id, schedule).expect(200);

      expect(body.feed.schedule).toEqual(schedule);
      await getFeed(feed.id).expect(({ body: read }) =>
        expect(read.feed.schedule).toEqual(schedule),
      );
    });

    it('desactivarla conserva la hora y la zona', async () => {
      const feed = await newFeed();
      await putSchedule(feed.id, {
        enabled: true,
        refreshTime: '06:30',
        timeZone: 'UTC',
      }).expect(200);

      const { body } = await putSchedule(feed.id, {
        enabled: false,
        refreshTime: '06:30',
        timeZone: 'UTC',
      }).expect(200);

      expect(body.feed.schedule).toEqual({
        enabled: false,
        refreshTime: '06:30',
        timeZone: 'UTC',
      });
    });

    it('valida la hora HH:MM, la zona y el booleano', async () => {
      const feed = await newFeed();

      await putSchedule(feed.id, {
        enabled: 'yes',
        refreshTime: '24:00',
        timeZone: 'Mars/Phobos',
      })
        .expect(400)
        .expect(({ body }) =>
          expect(
            [
              ...new Set(
                body.issues.map((issue: { field: string }) => issue.field),
              ),
            ].sort(),
          ).toEqual(['enabled', 'refreshTime', 'timeZone']),
        );
      for (const refreshTime of ['7:00', '06:60', '0630', '']) {
        await putSchedule(feed.id, {
          enabled: true,
          refreshTime,
          timeZone: 'UTC',
        }).expect(400);
      }
      await putSchedule(feed.id, {}).expect(400);
    });

    it('Bob no cambia la programación del feed de Alice', async () => {
      const feed = await newFeed();
      const body = { enabled: true, refreshTime: '06:00', timeZone: 'UTC' };

      await putSchedule(feed.id, body, bobSession).expect(404);
      await putSchedule(feed.id, body, bobSession, bobProjectId).expect(404);
      await api()
        .put(`${feedsOf()}/${feed.id}/schedule`)
        .send(body)
        .expect(401);
    });
  });

  describe('URL pública /feeds/<token>.tsv', () => {
    /** Crea el feed, exporta y publica; devuelve la URL de entrega y el TSV publicado. */
    async function publishedFeed() {
      const { body: created } = await createFeed().expect(201);
      const source = await exportCatalog(6);
      const { body: published } = await postPublication(created.feed.id, {
        exportId: source.id,
        expectedGeneration: 0,
      }).expect(201);
      const content = await readFile(
        join(root, 'feeds', `${published.feed.publishedVersion.id}.tsv`),
      );
      return {
        feed: published.feed as Feed,
        url: created.deliveryUrl as string,
        content,
        entityTag: `"${source.tsvChecksum}"`,
      };
    }

    const publicGet = (url: string) => api().get(url).responseType('blob');

    it('entrega el TSV publicado sin sesión, con su tipo, tamaño, ETag y no-cache', async () => {
      const { url, content, entityTag } = await publishedFeed();

      const response = await publicGet(url).expect(200);

      expect(response.headers['content-type']).toBe(
        'text/tab-separated-values; charset=utf-8',
      );
      expect(response.headers['content-length']).toBe(String(content.length));
      expect(response.headers.etag).toBe(entityTag);
      expect(response.headers['cache-control']).toBe('no-cache');
      expect(Buffer.from(response.body as Buffer)).toEqual(content);
      expect(
        createHash('sha256')
          .update(response.body as Buffer)
          .digest('hex'),
      ).toBe(entityTag.slice(1, -1));
    });

    it('HEAD responde las mismas cabeceras sin cuerpo', async () => {
      const { url, content, entityTag } = await publishedFeed();

      const response = await api().head(url).expect(200);

      expect(response.headers.etag).toBe(entityTag);
      expect(response.headers['content-length']).toBe(String(content.length));
      expect(response.text ?? '').toBe('');
    });

    it('con If-None-Match de esa versión responde 304 sin cuerpo', async () => {
      const { url, entityTag } = await publishedFeed();

      for (const ifNoneMatch of [
        entityTag,
        `W/${entityTag}`,
        `"x", ${entityTag}`,
      ]) {
        const response = await api()
          .get(url)
          .set('If-None-Match', ifNoneMatch)
          .expect(304);
        expect(response.headers.etag).toBe(entityTag);
        expect(response.headers['cache-control']).toBe('no-cache');
        expect(response.text ?? '').toBe('');
      }
      await api().get(url).set('If-None-Match', '"otra"').expect(200);
    });

    it('al publicar otra versión, la misma URL entrega el TSV nuevo con otro ETag', async () => {
      const { feed, url, entityTag } = await publishedFeed();
      const second = await exportCatalog(9);
      await postPublication(feed.id, {
        exportId: second.id,
        expectedGeneration: 1,
      }).expect(201);

      const response = await publicGet(url)
        .set('If-None-Match', entityTag)
        .expect(200);

      expect(response.headers.etag).toBe(`"${second.tsvChecksum}"`);
    });

    it('solo existe sin /api y sin /v1', async () => {
      const { url } = await publishedFeed();

      await api().get(`/api/v1${url}`).expect(404);
      await api().get(`/api${url}`).expect(404);
      await api().get(`/v1${url}`).expect(404);
    });

    it('nombre mal formado, token desconocido o feed sin publicar: el mismo 404', async () => {
      const { body: created } = await createFeed().expect(201);
      const unknown = `/feeds/${'A'.repeat(43)}.tsv`;

      const bodies: unknown[] = [];
      for (const url of [
        created.deliveryUrl,
        unknown,
        '/feeds/corto.tsv',
        created.deliveryUrl.replace('.tsv', '.csv'),
      ]) {
        const { body } = await api().get(url).expect(404);
        bodies.push({ ...body, requestId: undefined });
      }
      expect(bodies[0]).toMatchObject(publicError('FEED_NOT_FOUND'));
      expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
    });

    it('rotar el token: la URL antigua da 404 y la nueva entrega el TSV', async () => {
      const { feed, url, content } = await publishedFeed();

      const { body: rotated } = await api()
        .post(`${feedsOf()}/${feed.id}/delivery-token`)
        .auth('alice-session', { type: 'bearer' })
        .expect(200);

      expect(rotated.deliveryUrl).not.toBe(url);
      expect(rotated.feed.deliveryEnabled).toBe(true);
      await api().get(url).expect(404);
      const response = await publicGet(rotated.deliveryUrl).expect(200);
      expect(Buffer.from(response.body as Buffer)).toEqual(content);
    });

    it('desactivar la entrega: 204 y la URL da 404 hasta rotar otro token', async () => {
      const { feed, url } = await publishedFeed();

      await api()
        .delete(`${feedsOf()}/${feed.id}/delivery-token`)
        .auth('alice-session', { type: 'bearer' })
        .expect(204);

      await api().get(url).expect(404);
      await getFeed(feed.id).expect(({ body }) =>
        expect(body.feed.deliveryEnabled).toBe(false),
      );
    });

    it('si falta el archivo publicado responde 503 y lo registra sin el token', async () => {
      const { feed, url } = await publishedFeed();
      await rm(join(root, 'feeds'), { recursive: true, force: true });
      await app.get(ArtifactStore).onModuleInit();
      const logError = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await api()
        .get(url)
        .expect(503)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('FEED_FILE_UNAVAILABLE')),
        );
      expect(logError).toHaveBeenCalledWith({
        code: 'FEED_FILE_MISSING',
        feedId: feed.id,
      });
      expect(JSON.stringify(logError.mock.calls)).not.toContain(
        url.slice(7, -4),
      );
    });

    it('Bob no rota ni desactiva el token del feed de Alice', async () => {
      const { feed, url } = await publishedFeed();

      await api()
        .post(`${feedsOf()}/${feed.id}/delivery-token`)
        .auth('bob-session', { type: 'bearer' })
        .expect(404);
      await api()
        .delete(`${feedsOf(bobProjectId)}/${feed.id}/delivery-token`)
        .auth('bob-session', { type: 'bearer' })
        .expect(404);
      await publicGet(url).expect(200);
    });
  });

  it('sin sesión responde 401', async () => {
    await api().post(feedsOf()).expect(401);
    await api().get(feedsOf()).expect(401);
    await api().get(`${feedsOf()}/${randomUUID()}`).expect(401);
    await api()
      .post(`${feedsOf()}/${randomUUID()}/publications`)
      .send({})
      .expect(401);
    await api().post(`${feedsOf()}/${randomUUID()}/delivery-token`).expect(401);
    await api()
      .delete(`${feedsOf()}/${randomUUID()}/delivery-token`)
      .expect(401);
  });
});
