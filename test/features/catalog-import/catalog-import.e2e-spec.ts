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
import request from 'supertest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DescopeService } from '../../../src/auth/descope.service.js';
import { configureHttp } from '../../../src/configure-http.js';
import { POSTGRESQL_CONNECTION } from '../../../src/database/postgresql.connection.js';
import { PrismaService } from '../../../src/database/prisma.service.js';
import { ProjectsService } from '../../../src/projects/projects.service.js';
import { UsersService } from '../../../src/users/users.service.js';
import { CatalogImportModule } from '../../../src/catalog-import/catalog-import.module.js';
import { CatalogImportWorker } from '../../../src/catalog-import/catalog-import.worker.js';
import { CatalogImportService } from '../../../src/catalog-import/catalog-import.service.js';
import { ArtifactStore } from '../../../src/catalog-import/artifact.store.js';
import {
  CATALOG_IMPORT_OPTIONS,
  IMPORT_LIMITS,
} from '../../../src/catalog-import/import.types.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';

type Accepted = {
  snapshotId: string;
  jobId: string;
  status: string;
  statusUrl: string;
};

describe('CatalogImport HTTP multipart con Nest y persistencia reales', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let worker: CatalogImportWorker;
  let prisma: PrismaService;
  let store: ArtifactStore;
  let root: string;
  let projectId: string;
  let bobProjectId: string;
  const token = 'alice-session';
  const csv = 'id,title\n000123,Café\n';
  const url = () => `/api/v1/projects/${projectId}/imports`;
  function upload(input: Buffer = Buffer.from(csv)) {
    return request(app.getHttpServer())
      .post(url())
      .auth(token, { type: 'bearer' })
      .field('idColumn', 'id')
      .attach('file', input, { filename: 'shop.csv', contentType: 'text/csv' });
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    root = await mkdtemp(join(tmpdir(), 'catalog-http-'));
    const module = await Test.createTestingModule({
      imports: [CatalogImportModule],
    })
      .overrideProvider(POSTGRESQL_CONNECTION)
      .useValue(database.connection)
      .overrideProvider(CATALOG_IMPORT_OPTIONS)
      .useValue({ root, autoStart: false, pollMs: 1000, shutdownMs: 1000 })
      .overrideProvider(DescopeService)
      .useValue({
        validateSession: async (session: string) => {
          const identity =
            session === 'alice-session'
              ? alice
              : session === 'bob-session'
                ? bob
                : null;
          if (!identity) throw new Error('Token de prueba inválido');
          return {
            jwt: session,
            token: {
              sub: identity.subject,
              iss: identity.issuer,
              email: identity.email,
            },
          };
        },
      })
      .compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
    worker = app.get(CatalogImportWorker);
    prisma = app.get(PrismaService);
    store = app.get(ArtifactStore);
  });
  beforeEach(async () => {
    await database.connection.pool.query(
      'TRUNCATE estadistica_forms.app_users CASCADE',
    );
    await rm(root, { recursive: true, force: true });
    await store.onModuleInit();
    const users = app.get(UsersService);
    await users.provision(alice);
    await users.provision(bob);
    projectId = (await app.get(ProjectsService).create(alice, projectInput)).id;
    bobProjectId = (await app.get(ProjectsService).create(bob, projectInput))
      .id;
  });
  afterAll(async () => {
    try {
      if (app) {
        const stopWorker = jest.spyOn(worker, 'onModuleDestroy');
        const closeDatabase = jest.spyOn(prisma, 'onModuleDestroy');
        await app.close();
        expect(stopWorker.mock.invocationCallOrder[0]).toBeLessThan(
          closeDatabase.mock.invocationCallOrder[0],
        );
      }
    } finally {
      await database?.close();
      if (root) await rm(root, { recursive: true, force: true });
    }
  });

  it('acepta 202 y publica snapshot/muestra solo después del trabajo', async () => {
    const response = await upload().expect(202);
    const accepted: Accepted = response.body;
    expect(accepted).toEqual({
      snapshotId: expect.any(String),
      jobId: expect.any(String),
      status: 'queued',
      statusUrl: `/api/v1/projects/${projectId}/jobs/${accepted.jobId}`,
    });
    await request(app.getHttpServer())
      .get(accepted.statusUrl)
      .auth(token, { type: 'bearer' })
      .expect(200)
      .expect(({ body }) =>
        expect(body.job).toMatchObject({ status: 'queued', processedRows: 0 }),
      );
    await request(app.getHttpServer())
      .get(`${url()}/${accepted.snapshotId}`)
      .auth(token, { type: 'bearer' })
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          snapshot: { status: 'pending' },
          sample: [],
        }),
      );
    await worker.runUntilIdle();
    await request(app.getHttpServer())
      .get(accepted.statusUrl)
      .auth(token, { type: 'bearer' })
      .expect(200)
      .expect(({ body }) =>
        expect(body.job).toMatchObject({
          status: 'succeeded',
          processedRows: 1,
        }),
      );
    const result = await request(app.getHttpServer())
      .get(`${url()}/${accepted.snapshotId}`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(result.body).toMatchObject({
      snapshot: { status: 'ready', rowCount: 1 },
      sample: [
        {
          externalId: '000123',
          originalValues: { id: '000123', title: 'Café' },
        },
      ],
    });
    expect(JSON.stringify(result.body)).not.toContain(root);
    expect(result.body.snapshot).not.toHaveProperty('artifactKey');
    expect(await readdir(join(root, 'tmp'))).toEqual([]);
  });

  it('permite archivo antes de los campos y delimitador explícito', async () => {
    const response = await request(app.getHttpServer())
      .post(url())
      .auth(token, { type: 'bearer' })
      .attach('file', Buffer.from('id;title\n000123;Uno\n'), 'same.csv')
      .field('delimiter', 'semicolon')
      .field('idColumn', 'id')
      .expect(202);
    await worker.runUntilIdle();
    await request(app.getHttpServer())
      .get(`${url()}/${response.body.snapshotId}`)
      .auth(token, { type: 'bearer' })
      .expect(200)
      .expect(({ body }) =>
        expect(body.snapshot).toMatchObject({
          status: 'ready',
          delimiter: 'semicolon',
        }),
      );
  });

  it('sin sesión, token inválido o proyecto ajeno no inicia almacenamiento', async () => {
    const receive = jest.spyOn(store, 'receive');
    await request(app.getHttpServer())
      .post(url())
      .attach('file', Buffer.from(csv), 'shop.csv')
      .expect(401);
    await request(app.getHttpServer())
      .post(url())
      .auth('invalid', { type: 'bearer' })
      .attach('file', Buffer.from(csv), 'shop.csv')
      .expect(401);
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${bobProjectId}/imports`)
      .auth(token, { type: 'bearer' })
      .attach('file', Buffer.from(csv), 'shop.csv')
      .expect(404);
    expect(receive).not.toHaveBeenCalled();
    expect(await prisma.catalogSnapshot.count()).toBe(0);
  });

  it('configuración pendiente devuelve 409 antes de almacenar', async () => {
    await database.connection.pool.query(
      'UPDATE estadistica_forms.projects SET country=NULL,currency=NULL,channel_profile=NULL WHERE id=$1',
      [projectId],
    );
    const receive = jest.spyOn(store, 'receive');
    const response = await upload().expect(409);
    expect(response.body).toMatchObject({
      code: 'PROJECT_CONFIGURATION_REQUIRED',
      requestId: expect.any(String),
    });
    expect(receive).not.toHaveBeenCalled();
    expect(await prisma.catalogImportJob.count()).toBe(0);
  });

  it('rechaza archivo ausente y campo de archivo inesperado', async () => {
    await request(app.getHttpServer())
      .post(url())
      .auth(token, { type: 'bearer' })
      .field('idColumn', 'id')
      .expect(400);
    await request(app.getHttpServer())
      .post(url())
      .auth(token, { type: 'bearer' })
      .field('idColumn', 'id')
      .attach('other', Buffer.from(csv), 'shop.csv')
      .expect(400);
    expect(await prisma.catalogImportJob.count()).toBe(0);
    expect(await readdir(join(root, 'tmp'))).toEqual([]);
  });

  it('multipart incompleto devuelve 400 y limpia cualquier temporal', async () => {
    await request(app.getHttpServer())
      .post(url())
      .auth(token, { type: 'bearer' })
      .set('Content-Type', 'multipart/form-data; boundary=demo')
      .send(
        '--demo\r\nContent-Disposition: form-data; name="file"; filename="shop.csv"\r\nContent-Type: text/csv\r\n\r\nid\n1\n',
      )
      .expect(400);
    expect(await readdir(join(root, 'tmp'))).toEqual([]);
    expect(await prisma.catalogSnapshot.count()).toBe(0);
  });

  it.each([
    'unknown',
    'duplicate',
    'nested',
    'invalid-delimiter',
    'missing-id',
    'empty-id',
    'second-file',
  ])('limpia temporales ante multipart/DTO inválido: %s', async (kind) => {
    let pending = request(app.getHttpServer())
      .post(url())
      .auth(token, { type: 'bearer' })
      .attach('file', Buffer.from(csv), 'shop.csv');
    if (kind !== 'missing-id')
      pending = pending.field('idColumn', kind === 'empty-id' ? '   ' : 'id');
    if (kind === 'unknown') pending = pending.field('ownerId', 'bob');
    if (kind === 'duplicate') pending = pending.field('idColumn', 'again');
    if (kind === 'nested') pending = pending.field('idColumn[999999999]', 'id');
    if (kind === 'invalid-delimiter')
      pending = pending.field('delimiter', 'tab');
    if (kind === 'second-file')
      pending = pending.attach('file', Buffer.from(csv), 'second.csv');
    const response = await pending.expect(400);
    expect(response.body).toMatchObject({
      code: expect.any(String),
      requestId: expect.any(String),
    });
    expect(await prisma.catalogSnapshot.count()).toBe(0);
    expect(await readdir(join(root, 'tmp'))).toEqual([]);
    expect(await readdir(join(root, 'artifacts'))).toEqual([]);
  });

  it('rechaza más de 10 MiB con 413 y acepta exactamente el límite', async () => {
    const rejected = await upload(
      Buffer.alloc(IMPORT_LIMITS.fileBytes + 1),
    ).expect(413);
    expect(rejected.body.code).toBe('IMPORT_FILE_TOO_LARGE');
    expect(await readdir(join(root, 'tmp'))).toEqual([]);
    expect(await prisma.catalogSnapshot.count()).toBe(0);
    await upload(Buffer.alloc(IMPORT_LIMITS.fileBytes)).expect(202);
    expect(await prisma.catalogSnapshot.count()).toBe(1);
  });

  it('un MIME text/csv no convierte contenido inválido en snapshot listo', async () => {
    const response = await upload(Buffer.from('id\n1\n1\n')).expect(202);
    await worker.runUntilIdle();
    await request(app.getHttpServer())
      .get(response.body.statusUrl)
      .auth(token, { type: 'bearer' })
      .expect(200)
      .expect(({ body }) =>
        expect(body.job).toMatchObject({
          status: 'failed',
          error: { code: 'CSV_DUPLICATE_ID', requestId: expect.any(String) },
        }),
      );
    await request(app.getHttpServer())
      .get(`${url()}/${response.body.snapshotId}`)
      .auth(token, { type: 'bearer' })
      .expect(200)
      .expect(({ body }) => expect(body.sample).toEqual([]));
  });

  it('comprueba propietario y proyecto tanto para trabajos como snapshots', async () => {
    const response = await upload().expect(202);
    const accepted: Accepted = response.body;
    await request(app.getHttpServer())
      .get(accepted.statusUrl)
      .auth('bob-session', { type: 'bearer' })
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${bobProjectId}/jobs/${accepted.jobId}`)
      .auth('bob-session', { type: 'bearer' })
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${bobProjectId}/imports/${accepted.snapshotId}`)
      .auth('bob-session', { type: 'bearer' })
      .expect(404);
    await request(app.getHttpServer())
      .get(`${url()}/${randomUUID()}`)
      .auth(token, { type: 'bearer' })
      .expect(404);
  });

  it('una segunda subida con un trabajo activo devuelve 409 sin almacenar el archivo', async () => {
    await upload().expect(202);
    const receive = jest.spyOn(store, 'receive');
    await upload()
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          code: 'IMPORT_ALREADY_ACTIVE',
          message: { es: expect.any(String), en: expect.any(String) },
        }),
      );
    expect(receive).not.toHaveBeenCalled();
    expect(await prisma.catalogSnapshot.count()).toBe(1);

    await worker.runUntilIdle();
    await upload().expect(202);
  });

  it('lista las importaciones del proyecto paginadas y solo para su propietario', async () => {
    await upload().expect(202);
    await worker.runUntilIdle();
    await upload().expect(202);
    const list = (id: string, query = '', session = token) =>
      request(app.getHttpServer())
        .get(`/api/v1/projects/${id}/imports${query}`)
        .auth(session, { type: 'bearer' });

    const all = await list(projectId).expect(200);
    expect(all.body.imports).toHaveLength(2);
    expect(all.body.imports[0]).toMatchObject({
      status: 'pending',
      job: { status: 'queued' },
    });
    expect(all.body.imports[1]).toMatchObject({
      status: 'ready',
      rowCount: 1,
      job: { status: 'succeeded' },
    });
    expect(all.body.imports[0]).not.toHaveProperty('sample');
    expect(all.body.page).toEqual({ limit: 20, offset: 0, hasMore: false });

    const first = await list(projectId, '?limit=1').expect(200);
    expect(first.body.imports).toHaveLength(1);
    expect(first.body.page).toEqual({ limit: 1, offset: 0, hasMore: true });
    await list(projectId, '?limit=101').expect(400);

    await list(projectId, '', 'bob-session').expect(404);
    await list('no-es-uuid').expect(400);
  });

  it('snapshot aceptado bloquea configuración y permite renombrar', async () => {
    await upload().expect(202);
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${projectId}`)
      .auth(token, { type: 'bearer' })
      .send({
        country: 'BO',
        currency: 'BOB',
        channelProfile: 'google_merchant',
      })
      .expect(409)
      .expect(({ body }) =>
        expect(body.code).toBe('PROJECT_CONFIGURATION_LOCKED'),
      );
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${projectId}`)
      .auth(token, { type: 'bearer' })
      .send({ name: 'Renombrado' })
      .expect(200);
  });

  it('un fallo de respuesta posterior al commit conserva archivo y trabajo aceptados', async () => {
    const service = app.get(CatalogImportService);
    const original = service.accept.bind(service);
    jest.spyOn(service, 'accept').mockImplementationOnce(async (...args) => {
      await original(...args);
      throw new Error('Fallo controlado después de commit');
    });
    await upload().expect(500);
    expect(await prisma.catalogSnapshot.count()).toBe(1);
    expect(await readdir(join(root, 'tmp'))).toEqual([]);
    expect(await readdir(join(root, 'artifacts'))).toHaveLength(1);
    await worker.runUntilIdle();
    expect((await prisma.catalogImportJob.findFirstOrThrow()).status).toBe(
      'succeeded',
    );
  });

  it('responde a consultas mientras procesa el máximo de filas', async () => {
    const content = Buffer.from(
      `id,title\n${Array.from({ length: 5000 }, (_, i) => `${i},${'x'.repeat(2000)}`).join('\n')}\n`,
    );
    const accepted: Accepted = (await upload(content).expect(202)).body;
    const processing = worker.runUntilIdle();
    const start = performance.now();
    await request(app.getHttpServer())
      .get(accepted.statusUrl)
      .auth(token, { type: 'bearer' })
      .expect(200);
    const statusLatencyMs = Math.round(performance.now() - start);
    await processing;
    const result = await request(app.getHttpServer())
      .get(accepted.statusUrl)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(result.body.job).toMatchObject({
      status: 'succeeded',
      processedRows: 5000,
    });
    process.stdout.write(
      `${JSON.stringify({ benchmark: 'catalog-http-during-import', bytes: content.length, statusLatencyMs })}\n`,
    );
  });

  describe('DELETE', () => {
    const remove = (path: string, session = token) =>
      request(app.getHttpServer())
        .delete(path)
        .auth(session, { type: 'bearer' });
    const read = (path: string, session = token) =>
      request(app.getHttpServer()).get(path).auth(session, { type: 'bearer' });
    const importPath = (snapshotId: string, project = projectId) =>
      `/api/v1/projects/${project}/imports/${snapshotId}`;
    const artifacts = () => readdir(join(root, 'artifacts'));

    async function finishedImport() {
      const accepted: Accepted = (await upload().expect(202)).body;
      await worker.runUntilIdle();
      return accepted;
    }

    it('borra una importación terminada: 204, después 404 y sin su archivo', async () => {
      const accepted = await finishedImport();
      expect(await artifacts()).toHaveLength(1);

      await remove(importPath(accepted.snapshotId))
        .expect(204)
        .expect(({ text }) => expect(text).toBe(''));
      await read(importPath(accepted.snapshotId)).expect(404);
      await read(accepted.statusUrl).expect(404);
      expect(await artifacts()).toEqual([]);
    });

    it('responde 409 mientras la importación está en cola y la borra al terminar', async () => {
      const accepted: Accepted = (await upload().expect(202)).body;
      for (const path of [
        importPath(accepted.snapshotId),
        `/api/v1/projects/${projectId}`,
      ]) {
        await remove(path)
          .expect(409)
          .expect(({ body }) =>
            expect(body).toMatchObject({
              code: 'IMPORT_IN_PROGRESS',
              message: { es: expect.any(String), en: expect.any(String) },
            }),
          );
      }
      expect(await prisma.catalogSnapshot.count()).toBe(1);

      await worker.runUntilIdle();
      await remove(importPath(accepted.snapshotId)).expect(204);
    });

    it('Bob recibe 404 al intentar borrar recursos de Alice', async () => {
      const accepted = await finishedImport();
      await remove(importPath(accepted.snapshotId), 'bob-session')
        .expect(404)
        .expect(({ body }) => expect(body.code).toBe('IMPORT_NOT_FOUND'));
      await remove(
        importPath(accepted.snapshotId, bobProjectId),
        'bob-session',
      ).expect(404);
      await remove(`/api/v1/projects/${projectId}`, 'bob-session')
        .expect(404)
        .expect(({ body }) => expect(body.code).toBe('PROJECT_NOT_FOUND'));
      expect(await prisma.catalogSnapshot.count()).toBe(1);
      expect(await artifacts()).toHaveLength(1);
    });

    it('borra el proyecto con sus importaciones y archivos sin tocar otros proyectos', async () => {
      await finishedImport();
      await finishedImport();
      expect(await artifacts()).toHaveLength(2);

      await remove(`/api/v1/projects/${projectId}`).expect(204);
      await read(`/api/v1/projects/${projectId}`).expect(404);
      expect(await artifacts()).toEqual([]);
      expect(await prisma.catalogSnapshot.count()).toBe(0);
      await read(`/api/v1/projects/${bobProjectId}`, 'bob-session').expect(200);
    });

    it('tras borrar la última importación se puede volver a cambiar la configuración', async () => {
      const accepted = await finishedImport();
      await remove(importPath(accepted.snapshotId)).expect(204);

      await request(app.getHttpServer())
        .patch(`/api/v1/projects/${projectId}`)
        .auth(token, { type: 'bearer' })
        .send({
          country: 'BO',
          currency: 'BOB',
          channelProfile: 'google_merchant',
        })
        .expect(200)
        .expect(({ body }) =>
          expect(body.project).toMatchObject({
            country: 'BO',
            currency: 'BOB',
            configurationStatus: 'ready',
          }),
        );
    });

    it('valida los UUID, exige sesión y CORS permite DELETE', async () => {
      await remove('/api/v1/projects/no-es-uuid')
        .expect(400)
        .expect(({ body }) => expect(body.code).toBe('INVALID_UUID'));
      await remove(importPath('no-es-uuid'))
        .expect(400)
        .expect(({ body }) => expect(body.code).toBe('INVALID_UUID'));
      await request(app.getHttpServer())
        .delete(`/api/v1/projects/${projectId}`)
        .expect(401);
      await request(app.getHttpServer())
        .options(`/api/v1/projects/${projectId}`)
        .set('Origin', 'http://localhost:4321')
        .set('Access-Control-Request-Method', 'DELETE')
        .expect(204)
        .expect(({ headers }) =>
          expect(headers['access-control-allow-methods']).toContain('DELETE'),
        );
    });
  });
});
