import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DescopeService } from '../../../src/auth/descope.service.js';
import { publicError } from '../../../src/common/http/public-error.js';
import { configureHttp } from '../../../src/configure-http.js';
import { POSTGRESQL_CONNECTION } from '../../../src/database/postgresql.connection.js';
import { EvaluationsModule } from '../../../src/evaluations/evaluations.module.js';
import { EVALUATION_OPTIONS } from '../../../src/evaluations/evaluations.types.js';
import { EvaluationWorker } from '../../../src/evaluations/evaluations.worker.js';
import { ProjectsService } from '../../../src/projects/projects.service.js';
import { RulesetsModule } from '../../../src/rulesets/rulesets.module.js';
import { UsersService } from '../../../src/users/users.service.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';
import {
  CATALOG_HEADERS,
  catalogValues,
  insertReadySnapshot,
  mixedCatalog,
} from './support/snapshot-fixtures.js';
import { rulesetBody } from '../rulesets/support/ruleset-fixtures.js';

describe('Evaluaciones HTTP con guard, DTOs, worker y persistencia reales', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let worker: EvaluationWorker;
  let projectId: string;
  let snapshotId: string;
  const validateSession = jest.fn<DescopeService['validateSession']>();

  const api = () => request(app.getHttpServer());
  const evaluationsOf = (id: string) => `/api/v1/projects/${id}/evaluations`;
  const accept = (body: unknown, token = 'alice-session', id = projectId) =>
    api()
      .post(evaluationsOf(id))
      .auth(token, { type: 'bearer' })
      .send(body as object);
  const getEvaluation = (path: string, token = 'alice-session') =>
    api().get(path).auth(token, { type: 'bearer' });

  beforeAll(async () => {
    database = await createTestDatabase();
    const module = await Test.createTestingModule({
      imports: [RulesetsModule, EvaluationsModule],
    })
      .overrideProvider(POSTGRESQL_CONNECTION)
      .useValue(database.connection)
      .overrideProvider(DescopeService)
      .useValue({ validateSession })
      .overrideProvider(EVALUATION_OPTIONS)
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
    const pool = database.connection.pool;
    await pool.query('TRUNCATE estadistica_forms.app_users CASCADE');
    const users = app.get(UsersService);
    await users.provision(alice);
    await users.provision(bob);
    projectId = (await app.get(ProjectsService).create(alice, projectInput)).id;
    snapshotId = await insertReadySnapshot(pool, projectId, mixedCatalog(6));
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
    }
  });

  it('acepta con 202, el worker la procesa y la consulta muestra el resultado', async () => {
    const { body: accepted } = await accept({
      snapshotId,
      rulesetRevision: 1,
    }).expect(202);

    expect(accepted).toEqual({
      evaluationId: expect.any(String),
      status: 'queued',
      statusUrl: `/api/v1/projects/${projectId}/evaluations/${accepted.evaluationId}`,
    });
    await getEvaluation(accepted.statusUrl)
      .expect(200)
      .expect(({ body }) =>
        expect(body.evaluation).toMatchObject({
          status: 'queued',
          counts: null,
        }),
      );

    await worker.runUntilIdle();

    await getEvaluation(accepted.statusUrl)
      .expect(200)
      .expect(({ body }) =>
        expect(body.evaluation).toMatchObject({
          id: accepted.evaluationId,
          snapshotId,
          rulesetRevision: 1,
          engineVersion: '2',
          profileVersion: 'google_merchant@2026-11-01',
          status: 'succeeded',
          counts: { total: 6, valid: 2, invalid: 2, excluded: 2 },
          resultChecksum: expect.stringMatching(/^[0-9a-f]{64}$/),
          error: null,
        }),
      );
  });

  it('valida el body: snapshotId UUID y revisión entera positiva', async () => {
    await accept({ snapshotId: 'x', rulesetRevision: '1' })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('VALIDATION_FAILED');
        expect(
          body.issues.map((issue: { field: string }) => issue.field).sort(),
        ).toEqual(['rulesetRevision', 'snapshotId']);
      });
    await accept({ snapshotId, rulesetRevision: 0 }).expect(400);
  });

  it('responde 409 con la lista de atributos sin columna y 409 con otra activa', async () => {
    const pool = database.connection.pool;
    const withoutPrice = await insertReadySnapshot(
      pool,
      projectId,
      [catalogValues('SKU-1')],
      { headers: CATALOG_HEADERS.filter((header) => header !== 'Precio') },
    );
    await accept({ snapshotId: withoutPrice, rulesetRevision: 1 })
      .expect(409)
      .expect(({ body }) => {
        expect(body).toMatchObject(publicError('EVALUATION_COLUMN_MISSING'));
        expect(body.issues).toEqual([
          expect.objectContaining({
            field: 'mapping.price',
            code: 'EVALUATION_COLUMN_MISSING',
          }),
        ]);
      });

    await accept({ snapshotId, rulesetRevision: 1 }).expect(202);
    await accept({ snapshotId, rulesetRevision: 1 })
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('EVALUATION_ALREADY_ACTIVE')),
      );
  });

  it('protege los recursos de Alice: 404 para Bob al aceptar y al consultar', async () => {
    const { body: accepted } = await accept({
      snapshotId,
      rulesetRevision: 1,
    }).expect(202);

    await accept({ snapshotId, rulesetRevision: 1 }, 'bob-session')
      .expect(404)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('PROJECT_NOT_FOUND')),
      );
    await getEvaluation(accepted.statusUrl, 'bob-session')
      .expect(404)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('PROJECT_NOT_FOUND')),
      );
    await getEvaluation(
      `${evaluationsOf(projectId)}/00000000-0000-4000-8000-000000000009`,
    )
      .expect(404)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('EVALUATION_NOT_FOUND')),
      );
  });

  it('sin Bearer responde 401 sin dejar nada en cola', async () => {
    await api()
      .post(evaluationsOf(projectId))
      .send({ snapshotId, rulesetRevision: 1 })
      .expect(401);
    await accept({ snapshotId, rulesetRevision: 1 }).expect(202);
  });
  describe('informe (E4)', () => {
    /** Acepta y procesa una evaluación del snapshot dado; devuelve su `statusUrl`. */
    async function evaluated(id = snapshotId): Promise<string> {
      const { body } = await accept({
        snapshotId: id,
        rulesetRevision: 1,
      }).expect(202);
      await worker.runUntilIdle();
      return body.statusUrl;
    }

    it('incluye una muestra en orden con valores normalizados y problemas en es y en', async () => {
      const statusUrl = await evaluated();

      await getEvaluation(statusUrl)
        .expect(200)
        .expect(({ body }) => {
          expect(
            body.sample.map((row: { sourceRow: number; outcome: string }) => [
              row.sourceRow,
              row.outcome,
            ]),
          ).toEqual([
            [1, 'valid'],
            [2, 'invalid'],
            [3, 'excluded'],
            [4, 'valid'],
            [5, 'invalid'],
            [6, 'excluded'],
          ]);
          expect(body.sample[0]).toMatchObject({
            externalId: 'SKU-1',
            values: { title: 'Acme Mesa SKU-1', price: '149.90 USD' },
            problems: [],
            excludedByRule: null,
          });
          expect(body.sample[1].problems).toEqual([
            {
              attribute: 'price',
              code: 'PRICE_FORMAT_INVALID',
              problem: { es: expect.any(String), en: expect.any(String) },
              suggestion: {
                es: expect.stringContaining('1234.50'),
                en: expect.stringContaining('1234.50'),
              },
            },
          ]);
          expect(body.sample[2]).toMatchObject({
            outcome: 'excluded',
            values: null,
            problems: [],
            excludedByRule: 4,
          });
        });
    });

    it('sin resultados: muestra vacía y 409 en filas y en errores.csv', async () => {
      const { body: accepted } = await accept({
        snapshotId,
        rulesetRevision: 1,
      }).expect(202);

      await getEvaluation(accepted.statusUrl)
        .expect(200)
        .expect(({ body }) => expect(body.sample).toEqual([]));
      for (const suffix of ['/rows', '/errors.csv']) {
        await getEvaluation(`${accepted.statusUrl}${suffix}`)
          .expect(409)
          .expect(({ body }) =>
            expect(body).toMatchObject(
              publicError('EVALUATION_RESULTS_UNAVAILABLE'),
            ),
          );
      }
    });

    it('pagina las filas, filtra por resultado y valida la consulta', async () => {
      const statusUrl = await evaluated();
      const sourceRows = (body: { rows: { sourceRow: number }[] }) =>
        body.rows.map((row) => row.sourceRow);

      await getEvaluation(`${statusUrl}/rows?outcome=invalid&limit=1`)
        .expect(200)
        .expect(({ body }) => {
          expect(sourceRows(body)).toEqual([2]);
          expect(body.page).toEqual({ limit: 1, offset: 0, hasMore: true });
        });
      await getEvaluation(`${statusUrl}/rows?outcome=invalid&limit=1&offset=1`)
        .expect(200)
        .expect(({ body }) => {
          expect(sourceRows(body)).toEqual([5]);
          expect(body.page.hasMore).toBe(false);
        });
      await getEvaluation(`${statusUrl}/rows?limit=4&offset=4`)
        .expect(200)
        .expect(({ body }) => expect(sourceRows(body)).toEqual([5, 6]));

      for (const query of ['?outcome=otro', '?limit=101', '?offset=-1']) {
        await getEvaluation(`${statusUrl}/rows${query}`)
          .expect(400)
          .expect(({ body }) => expect(body.code).toBe('VALIDATION_FAILED'));
      }
    });

    it('descarga errores.csv con BOM, cabeceras de descarga y celdas protegidas', async () => {
      const withFormula = await insertReadySnapshot(
        database.connection.pool,
        projectId,
        [catalogValues('=SKU-7', { Precio: '1,50' }), catalogValues('SKU-8')],
      );
      const statusUrl = await evaluated(withFormula);
      const evaluationId = statusUrl.split('/').pop();

      // `blob` entrega el cuerpo como Buffer: así se ve el BOM tal cual llega.
      const response = await getEvaluation(`${statusUrl}/errors.csv`)
        .responseType('blob')
        .expect(200);

      expect(response.headers['content-type']).toBe(
        'text/csv; charset=utf-8; header=present',
      );
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename="errores-${evaluationId}.csv"`,
      );
      const bytes: Buffer = response.body;
      expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect(bytes.subarray(3).toString('utf8').split('\r\n')).toEqual([
        '"fila","producto","campo","problema","corrección sugerida"',
        '"1","\t=SKU-7","price","El precio no tiene un formato admitido.","Escribe el precio con punto decimal y sin separador de miles ni símbolo, por ejemplo 1234.50."',
        '',
      ]);

      const english = await getEvaluation(`${statusUrl}/errors.csv?lang=en`)
        .responseType('blob')
        .expect(200);
      expect(english.body.toString('utf8')).toContain(
        '"row","product","field","problem","suggested fix"',
      );
      await getEvaluation(`${statusUrl}/errors.csv?lang=fr`).expect(400);
    });

    it('protege el informe de Alice: 404 para Bob en filas y en errores.csv', async () => {
      const statusUrl = await evaluated();
      for (const suffix of ['/rows', '/errors.csv']) {
        await getEvaluation(`${statusUrl}${suffix}`, 'bob-session')
          .expect(404)
          .expect(({ body }) =>
            expect(body).toMatchObject(publicError('PROJECT_NOT_FOUND')),
          );
      }
    });
  });

  describe('historial (plan 02)', () => {
    type ListedEvaluation = { id: string; createdAt: string; status: string };

    /** Más reciente primero; a igual fecha, el id mayor primero. */
    const isNewestFirst = (items: ListedEvaluation[]) =>
      items.every((item, index) => {
        const next = items[index + 1];
        if (!next) return true;
        if (item.createdAt !== next.createdAt) {
          return item.createdAt > next.createdAt;
        }
        return item.id > next.id;
      });

    /** Acepta y, si se pide, deja que el worker la termine antes de la siguiente. */
    const evaluate = async (finish: boolean) => {
      const { body } = await accept({ snapshotId, rulesetRevision: 1 }).expect(
        202,
      );
      if (finish) await worker.runUntilIdle();
      return body.evaluationId as string;
    };

    it('sin evaluaciones devuelve una lista vacía', async () => {
      await getEvaluation(evaluationsOf(projectId))
        .expect(200)
        .expect(({ body }) =>
          expect(body).toEqual({
            evaluations: [],
            page: { limit: 20, offset: 0, hasMore: false },
          }),
        );
    });

    it('lista de la más reciente a la más antigua, por páginas y sin muestra', async () => {
      const created = [
        await evaluate(true),
        await evaluate(true),
        await evaluate(false),
      ];

      const first = await getEvaluation(
        `${evaluationsOf(projectId)}?limit=2`,
      ).expect(200);
      expect(first.body.page).toEqual({ limit: 2, offset: 0, hasMore: true });
      expect(first.body.evaluations).toHaveLength(2);

      const second = await getEvaluation(
        `${evaluationsOf(projectId)}?limit=2&offset=2`,
      ).expect(200);
      expect(second.body.page).toEqual({ limit: 2, offset: 2, hasMore: false });

      const listed: ListedEvaluation[] = [
        ...first.body.evaluations,
        ...second.body.evaluations,
      ];
      expect(listed.map((item) => item.id).sort()).toEqual([...created].sort());
      expect(isNewestFirst(listed)).toBe(true);
      expect(listed.find((item) => item.id === created[2])).toMatchObject({
        status: 'queued',
        counts: null,
      });
      expect(listed.find((item) => item.id === created[0])).toMatchObject({
        snapshotId,
        rulesetRevision: 1,
        status: 'succeeded',
        counts: { total: 6, valid: 2, invalid: 2, excluded: 2 },
      });
      expect(first.body).not.toHaveProperty('sample');
      expect(first.body.evaluations[0]).not.toHaveProperty('sample');
    });

    it('protege el historial de Alice: 404 para Bob y para un proyecto inexistente', async () => {
      await evaluate(true);
      await getEvaluation(evaluationsOf(projectId), 'bob-session')
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('PROJECT_NOT_FOUND')),
        );
      await getEvaluation(
        evaluationsOf('00000000-0000-4000-8000-000000000009'),
      ).expect(404);
    });

    it.each(['?limit=0', '?limit=101', '?offset=-1', '?status=queued'])(
      'rechaza la consulta %s con 400',
      async (query) => {
        await getEvaluation(`${evaluationsOf(projectId)}${query}`).expect(400);
      },
    );
  });
});
