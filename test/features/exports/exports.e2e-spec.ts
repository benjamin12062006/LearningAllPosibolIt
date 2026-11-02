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
import { ProjectsService } from '../../../src/projects/projects.service.js';
import { RulesetsModule } from '../../../src/rulesets/rulesets.module.js';
import { UsersService } from '../../../src/users/users.service.js';
import { rulesetBody } from '../rulesets/support/ruleset-fixtures.js';
import {
  catalogValues,
  insertReadySnapshot,
  mixedCatalog,
} from '../evaluations/support/snapshot-fixtures.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';

type Approval = {
  evaluationId: string;
  resultChecksum: string;
  acceptedInvalidCount: number;
  acceptedExcludedCount: number;
};

describe('Exportaciones HTTP con guard, DTOs, evaluación y almacén reales', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let worker: EvaluationWorker;
  let root: string;
  let projectId: string;
  let bobProjectId: string;
  /** Snapshot de la última llamada a `evaluateCatalog`, para borrarlo. */
  let lastSnapshotId: string;
  const validateSession = jest.fn<DescopeService['validateSession']>();

  const api = () => request(app.getHttpServer());
  const exportsOf = (id = projectId) => `/api/v1/projects/${id}/exports`;
  const postExport = (body: unknown, token = 'alice-session', id = projectId) =>
    api()
      .post(exportsOf(id))
      .auth(token, { type: 'bearer' })
      .send(body as object);
  const getExport = (
    exportId: string,
    token = 'alice-session',
    id = projectId,
  ) =>
    api()
      .get(`${exportsOf(id)}/${exportId}`)
      .auth(token, { type: 'bearer' });
  const pool = () => database.connection.pool;

  /** Importa el catálogo como snapshot listo, lo evalúa y devuelve la aprobación tal como se lee por HTTP. */
  async function evaluateCatalog(rows: Record<string, string>[]) {
    const snapshotId = await insertReadySnapshot(pool(), projectId, rows);
    lastSnapshotId = snapshotId;
    const { body: accepted } = await api()
      .post(`/api/v1/projects/${projectId}/evaluations`)
      .auth('alice-session', { type: 'bearer' })
      .send({ snapshotId, rulesetRevision: 1 })
      .expect(202);
    await worker.runUntilIdle();
    const { body } = await api()
      .get(accepted.statusUrl)
      .auth('alice-session', { type: 'bearer' })
      .expect(200);
    return approvalFrom(body.evaluation);
  }

  function approvalFrom(evaluation: {
    id: string;
    resultChecksum: string;
    counts: { invalid: number; excluded: number };
  }): Approval {
    return {
      evaluationId: evaluation.id,
      resultChecksum: evaluation.resultChecksum,
      acceptedInvalidCount: evaluation.counts.invalid,
      acceptedExcludedCount: evaluation.counts.excluded,
    };
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    root = await mkdtemp(join(tmpdir(), 'exports-http-'));
    const module = await Test.createTestingModule({
      imports: [
        CatalogImportModule,
        RulesetsModule,
        EvaluationsModule,
        ExportsModule,
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

  it('recorrido: evaluar, aprobar lo leído, exportar con 201 y consultar', async () => {
    const approval = await evaluateCatalog(mixedCatalog(6));

    const { body: created } = await postExport(approval).expect(201);

    expect(created).toEqual({
      export: {
        id: expect.any(String),
        evaluationId: approval.evaluationId,
        acceptedInvalidCount: 2,
        acceptedExcludedCount: 2,
        rowCount: 2,
        byteSize: expect.any(Number),
        tsvChecksum: expect.stringMatching(/^[0-9a-f]{64}$/),
        createdAt: expect.any(String),
      },
      downloadUrl: `/api/v1/projects/${projectId}/exports/${created.export.id}/productos.tsv`,
    });
    const [file] = await readdir(join(root, 'exports'));
    expect(JSON.stringify(created)).not.toContain(file);
    await getExport(created.export.id)
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({ export: created.export }));
  });

  it('el TSV guardado solo contiene los productos válidos', async () => {
    const approval = await evaluateCatalog(mixedCatalog(6));
    await postExport(approval).expect(201);

    const [file] = await readdir(join(root, 'exports'));
    const content = await readFile(join(root, 'exports', file), 'utf8');

    expect(content.split('\n')[0]).toBe(
      'id\tbrand\ttitle\tdescription\tlink\timage_link\tprice\tavailability',
    );
    for (const sku of ['SKU-1', 'SKU-4'])
      expect(content).toContain(`\n${sku}\t`);
    for (const sku of ['SKU-2', 'SKU-3', 'SKU-5', 'SKU-6']) {
      expect(content).not.toContain(`${sku}\t`);
    }
  });

  it('repetir la misma petición devuelve 200 con la misma exportación', async () => {
    const approval = await evaluateCatalog(mixedCatalog(6));
    const { body: first } = await postExport(approval).expect(201);

    await postExport(approval)
      .expect(200)
      .expect(({ body }) => expect(body).toEqual(first));
    expect(await readdir(join(root, 'exports'))).toHaveLength(1);
  });

  it('valida el body: UUID, suma en hexadecimal minúscula y conteos enteros', async () => {
    await postExport({
      evaluationId: 'x',
      resultChecksum: 'A'.repeat(64),
      acceptedInvalidCount: -1,
      acceptedExcludedCount: '0',
    })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('VALIDATION_FAILED');
        expect(
          body.issues.map((issue: { field: string }) => issue.field).sort(),
        ).toEqual([
          'acceptedExcludedCount',
          'acceptedInvalidCount',
          'evaluationId',
          'resultChecksum',
        ]);
      });
    await postExport({}).expect(400);
  });

  describe('409 cuando no se puede exportar', () => {
    it('la aprobación no coincide con lo guardado', async () => {
      const approval = await evaluateCatalog(mixedCatalog(6));

      await postExport({ ...approval, acceptedExcludedCount: 0 })
        .expect(409)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('EXPORT_APPROVAL_MISMATCH')),
        );
      expect(await readdir(join(root, 'exports'))).toEqual([]);
    });

    it('la evaluación no tiene productos válidos', async () => {
      const approval = await evaluateCatalog([
        catalogValues('SKU-1', { Precio: '1,50' }),
      ]);

      await postExport(approval)
        .expect(409)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('EXPORT_NO_VALID_PRODUCTS')),
        );
    });

    it('una evaluación posterior la reemplaza', async () => {
      const approval = await evaluateCatalog(mixedCatalog(6));
      await evaluateCatalog(mixedCatalog(3));

      await postExport(approval)
        .expect(409)
        .expect(({ body }) =>
          expect(body).toMatchObject(
            publicError('EXPORT_EVALUATION_SUPERSEDED'),
          ),
        );
    });

    it('se evaluó con otra versión del perfil', async () => {
      const approval = await evaluateCatalog(mixedCatalog(6));
      await pool().query(
        `UPDATE estadistica_forms.evaluations
         SET profile_version = 'google_merchant@2026-10-31' WHERE id = $1`,
        [approval.evaluationId],
      );

      await postExport(approval)
        .expect(409)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('EXPORT_EVALUATION_OUTDATED')),
        );
    });

    it('la evaluación todavía no terminó', async () => {
      const snapshotId = await insertReadySnapshot(
        pool(),
        projectId,
        mixedCatalog(3),
      );
      const { body: accepted } = await api()
        .post(`/api/v1/projects/${projectId}/evaluations`)
        .auth('alice-session', { type: 'bearer' })
        .send({ snapshotId, rulesetRevision: 1 })
        .expect(202);

      await postExport({
        evaluationId: accepted.evaluationId,
        resultChecksum: 'a'.repeat(64),
        acceptedInvalidCount: 0,
        acceptedExcludedCount: 0,
      })
        .expect(409)
        .expect(({ body }) =>
          expect(body).toMatchObject(
            publicError('EVALUATION_RESULTS_UNAVAILABLE'),
          ),
        );
    });
  });

  describe('404 para recursos ajenos o inexistentes', () => {
    it('Bob no exporta ni consulta en el proyecto de Alice', async () => {
      const approval = await evaluateCatalog(mixedCatalog(6));
      const { body: created } = await postExport(approval).expect(201);

      await postExport(approval, 'bob-session')
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('PROJECT_NOT_FOUND')),
        );
      await getExport(created.export.id, 'bob-session')
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('PROJECT_NOT_FOUND')),
        );
    });

    it('Bob no usa una evaluación ni una exportación de Alice desde su proyecto', async () => {
      const approval = await evaluateCatalog(mixedCatalog(6));
      const { body: created } = await postExport(approval).expect(201);

      await postExport(approval, 'bob-session', bobProjectId)
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('EVALUATION_NOT_FOUND')),
        );
      await getExport(created.export.id, 'bob-session', bobProjectId)
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('EXPORT_NOT_FOUND')),
        );
    });

    it('una evaluación o una exportación que no existen', async () => {
      await postExport({
        evaluationId: randomUUID(),
        resultChecksum: 'a'.repeat(64),
        acceptedInvalidCount: 0,
        acceptedExcludedCount: 0,
      })
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('EVALUATION_NOT_FOUND')),
        );
      await getExport(randomUUID())
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('EXPORT_NOT_FOUND')),
        );
      await getExport('no-es-uuid').expect(400);
    });
  });

  describe('descarga de productos.tsv', () => {
    const download = (
      exportId: string,
      token = 'alice-session',
      id = projectId,
    ) =>
      api()
        .get(`${exportsOf(id)}/${exportId}/productos.tsv`)
        .auth(token, { type: 'bearer' })
        .responseType('blob');

    async function exported() {
      const { body } = await postExport(
        await evaluateCatalog(mixedCatalog(6)),
      ).expect(201);
      return body as {
        export: { id: string; byteSize: number; tsvChecksum: string };
        downloadUrl: string;
      };
    }

    it('entrega el archivo guardado con su tipo, nombre, tamaño y suma', async () => {
      const created = await exported();
      const [file] = await readdir(join(root, 'exports'));
      const stored = await readFile(join(root, 'exports', file));

      const response = await api()
        .get(created.downloadUrl)
        .auth('alice-session', { type: 'bearer' })
        .responseType('blob')
        .expect(200);

      expect(response.headers['content-type']).toBe(
        'text/tab-separated-values; charset=utf-8',
      );
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename="productos-${created.export.id}.tsv"`,
      );
      expect(Number(response.headers['content-length'])).toBe(
        created.export.byteSize,
      );
      const body = response.body as Buffer;
      expect(body.equals(stored)).toBe(true);
      expect(createHash('sha256').update(body).digest('hex')).toBe(
        created.export.tsvChecksum,
      );
    });

    it('Bob no descarga el archivo de Alice', async () => {
      const created = await exported();

      await download(created.export.id, 'bob-session')
        .expect(404)
        .expect(({ body }) =>
          expect(JSON.parse(String(body))).toMatchObject(
            publicError('PROJECT_NOT_FOUND'),
          ),
        );
      await download(created.export.id, 'bob-session', bobProjectId)
        .expect(404)
        .expect(({ body }) =>
          expect(JSON.parse(String(body))).toMatchObject(
            publicError('EXPORT_NOT_FOUND'),
          ),
        );
    });

    it('si falta el archivo responde 503 y lo registra sin datos del catálogo', async () => {
      const created = await exported();
      const [file] = await readdir(join(root, 'exports'));
      await rm(join(root, 'exports', file));
      const logError = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await download(created.export.id)
        .expect(503)
        .expect(({ body }) =>
          expect(JSON.parse(String(body))).toMatchObject(
            publicError('EXPORT_FILE_UNAVAILABLE'),
          ),
        );
      expect(logError).toHaveBeenCalledWith({
        code: 'EXPORT_FILE_MISSING',
        exportId: created.export.id,
      });
      logError.mockRestore();
    });

    it('una exportación inexistente, un id no UUID y sin sesión', async () => {
      await download(randomUUID()).expect(404);
      await download('no-es-uuid').expect(400);
      await api()
        .get(`${exportsOf()}/${randomUUID()}/productos.tsv`)
        .expect(401);
    });
  });

  describe('borrados', () => {
    it('borrar la importación borra la exportación y retira su TSV', async () => {
      const { body: created } = await postExport(
        await evaluateCatalog(mixedCatalog(6)),
      ).expect(201);

      await api()
        .delete(`/api/v1/projects/${projectId}/imports/${lastSnapshotId}`)
        .auth('alice-session', { type: 'bearer' })
        .expect(204);

      expect(await readdir(join(root, 'exports'))).toEqual([]);
      await getExport(created.export.id).expect(404);
    });

    it('borrar el proyecto retira los TSV de todas sus exportaciones', async () => {
      await postExport(await evaluateCatalog(mixedCatalog(6))).expect(201);
      await postExport(await evaluateCatalog(mixedCatalog(3))).expect(201);
      expect(await readdir(join(root, 'exports'))).toHaveLength(2);

      await api()
        .delete(`/api/v1/projects/${projectId}`)
        .auth('alice-session', { type: 'bearer' })
        .expect(204);

      expect(await readdir(join(root, 'exports'))).toEqual([]);
    });
  });

  it('sin sesión responde 401', async () => {
    await api().post(exportsOf()).send({}).expect(401);
    await api().get(`${exportsOf()}/${randomUUID()}`).expect(401);
  });
});
