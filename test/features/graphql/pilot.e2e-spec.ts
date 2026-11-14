import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import { type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import request from 'supertest';
import { ARTIFACT_STORE_OPTIONS } from '../../../src/artifacts/artifacts.types.js';
import { DescopeService } from '../../../src/auth/descope.service.js';
import { CATALOG_IMPORT_OPTIONS } from '../../../src/catalog-import/import.types.js';
import { configureHttp } from '../../../src/configure-http.js';
import { POSTGRESQL_CONNECTION } from '../../../src/database/postgresql.connection.js';
import { EVALUATION_OPTIONS } from '../../../src/evaluations/evaluations.types.js';
import { EvaluationWorker } from '../../../src/evaluations/evaluations.worker.js';
import { EXPORT_OPTIONS } from '../../../src/exports/exports.types.js';
import { FEED_REFRESH_OPTIONS } from '../../../src/feed-refreshes/feed-refreshes.types.js';
import { FEED_OPTIONS } from '../../../src/feeds/feeds.types.js';
import { GraphqlApiModule } from '../../../src/graphql/graphql-api.module.js';
import { ProjectsService } from '../../../src/projects/projects.service.js';
import { RulesetsModule } from '../../../src/rulesets/rulesets.module.js';
import { UsersService } from '../../../src/users/users.service.js';
import {
  catalogValues,
  insertReadySnapshot,
} from '../evaluations/support/snapshot-fixtures.js';
import { rulesetBody } from '../rulesets/support/ruleset-fixtures.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';
import {
  FIXTURE_COLUMNS,
  seedTwoRevisions,
} from '../worksheets/support/row-fixtures.js';

type GraphQLBody = {
  data?: Record<string, any> | null;
  errors?: { message: string; extensions: Record<string, any> }[];
};

const WORKSHEET_QUERY = `
  query Worksheet($organizationId: ID!, $projectId: ID!, $id: ID!, $limit: Int, $cursor: String) {
    worksheet(organizationId: $organizationId, projectId: $projectId, id: $id) {
      id
      name
      generation
      headRevision { id sequence rowCount }
      columns { id name type position required }
      rows(limit: $limit, cursor: $cursor) { items nextCursor revisionId schemaVersion }
    }
  }`;

const DIAGNOSIS_QUERY = `
  query Diagnosis($projectId: ID!, $feedId: ID!, $exportId: ID!, $evaluationId: ID!) {
    feed(projectId: $projectId, id: $feedId) {
      id
      generation
      publishedVersion { id rowCount evaluationId }
      delivery { delivering reason deliveryEnabled }
      comparison(exportId: $exportId) {
        candidate { id evaluationId rowCount }
        counts { added removed modified unchanged }
        changedFields { field productCount }
        changes { id change fields { field before after } }
        page { limit offset hasMore }
      }
    }
    evaluation(projectId: $projectId, id: $evaluationId) {
      id
      status
      counts { total valid invalid excluded }
      attention {
        affectedProducts
        problemGroups { attribute code productCount problem { es en } suggestion { es en } }
        excludedProducts
        exclusionGroups { rulePosition rule productCount }
      }
    }
  }`;

/**
 * Piloto de C7: dos lecturas compuestas por GraphQL. Lo que se comprueba es la
 * paridad con REST (mismos datos, mismos permisos), no un contrato nuevo.
 */
describe('GraphQL piloto: la hoja con filas y el diagnóstico del feed', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let root: string;
  let projectId: string;
  let organizationId: string;
  let aliceId: string;

  const pool = () => database.connection.pool;
  const rest = (token = 'alice-session') => {
    const agent = request(app.getHttpServer());
    return {
      get: (path: string) => agent.get(path).auth(token, { type: 'bearer' }),
      post: (path: string) => agent.post(path).auth(token, { type: 'bearer' }),
    };
  };

  function gql(query: string, variables: object, token = 'alice-session') {
    const call = request(app.getHttpServer()).post('/api/graphql');
    if (token) call.auth(token, { type: 'bearer' });
    return call.send({ query, variables });
  }
  async function ok(query: string, variables: object, token?: string) {
    const { body } = await gql(query, variables, token).expect(200);
    const result = body as GraphQLBody;
    expect(result.errors).toBeUndefined();
    return result.data!;
  }
  async function failure(query: string, variables: object, token?: string) {
    const { body } = await gql(query, variables, token);
    const result = body as GraphQLBody;
    expect(result.errors).toHaveLength(1);
    return result.errors![0];
  }

  /** Las sentencias SQL que llegan a PostgreSQL mientras corre `work`. */
  async function captureStatements(work: () => Promise<unknown>) {
    const statements: string[] = [];
    const original = pg.Client.prototype.query;
    const capturing = function (this: pg.Client, ...args: unknown[]) {
      const [config] = args;
      statements.push(
        typeof config === 'string'
          ? config
          : String((config as { text?: unknown })?.text ?? ''),
      );
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    };
    pg.Client.prototype.query = capturing as typeof original;
    try {
      await work();
    } finally {
      pg.Client.prototype.query = original;
    }
    return statements;
  }

  const projectPath = () => `/api/v1/projects/${projectId}`;
  const scopePath = () =>
    `/api/v1/organizations/${organizationId}/projects/${projectId}`;

  /** Una hoja con dos revisiones y cuatro filas vivas en la actual. */
  async function seededWorksheet() {
    const { body: workbook } = await rest()
      .post(`${scopePath()}/workbooks`)
      .send({ name: 'Libro' })
      .expect(201);
    const { body } = await rest()
      .post(`${scopePath()}/workbooks/${workbook.workbook.id}/worksheets`)
      .send({ name: 'Inventario', columns: FIXTURE_COLUMNS })
      .expect(201);
    await seedTwoRevisions(pool(), body.worksheet, organizationId, aliceId);
    return body.worksheet.id as string;
  }

  /** Evalúa y exporta un catálogo; devuelve la exportación y su evaluación. */
  async function exportRows(rows: Record<string, string>[]) {
    const snapshotId = await insertReadySnapshot(pool(), projectId, rows);
    const { body: accepted } = await rest()
      .post(`${projectPath()}/evaluations`)
      .send({ snapshotId, rulesetRevision: 1 })
      .expect(202);
    await app.get(EvaluationWorker).runUntilIdle();
    const { body } = await rest().get(accepted.statusUrl).expect(200);
    const { body: created } = await rest()
      .post(`${projectPath()}/exports`)
      .send({
        evaluationId: body.evaluation.id,
        resultChecksum: body.evaluation.resultChecksum,
        acceptedInvalidCount: body.evaluation.counts.invalid,
        acceptedExcludedCount: body.evaluation.counts.excluded,
      })
      .expect(201);
    return {
      exportId: created.export.id as string,
      evaluationId: body.evaluation.id as string,
    };
  }

  /** Un feed publicado y una exportación candidata con cambios y problemas. */
  async function publishedFeedWithCandidate() {
    const { body: feed } = await rest()
      .post(`${projectPath()}/feeds`)
      .expect(201);
    const feedId = feed.feed.id as string;
    const before = await exportRows([
      catalogValues('SKU-1', { Precio: '10.00' }),
      catalogValues('SKU-2', { Precio: '20.00' }),
      catalogValues('SKU-3'),
    ]);
    await rest()
      .post(`${projectPath()}/feeds/${feedId}/publications`)
      .send({ exportId: before.exportId, expectedGeneration: 0 })
      .expect(201);
    const candidate = await exportRows([
      catalogValues('SKU-1', { Precio: '10.00' }),
      catalogValues('SKU-2', { Precio: '25.00' }),
      catalogValues('SKU-4'),
      catalogValues('SKU-5', { Imagen: '' }),
      catalogValues('SKU-6', { Marca: '' }),
    ]);
    return { feedId, ...candidate };
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    root = await mkdtemp(join(tmpdir(), 'graphql-pilot-'));
    const idle = { autoStart: false, pollMs: 1000, shutdownMs: 1000 };
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        // Trae también las rutas REST de los módulos que usa: sirven para comparar.
        GraphqlApiModule,
        RulesetsModule,
      ],
    })
      .overrideProvider(POSTGRESQL_CONNECTION)
      .useValue(database.connection)
      .overrideProvider(ARTIFACT_STORE_OPTIONS)
      .useValue({ root })
      .overrideProvider(CATALOG_IMPORT_OPTIONS)
      .useValue(idle)
      .overrideProvider(EVALUATION_OPTIONS)
      .useValue(idle)
      .overrideProvider(EXPORT_OPTIONS)
      .useValue({ autoStart: false })
      .overrideProvider(FEED_REFRESH_OPTIONS)
      .useValue({
        autoStart: false,
        pollMs: 1_000,
        waitMs: 0,
        leaseMs: 60_000,
        shutdownMs: 200,
        retry: { baseDelayMs: 1, maxDelayMs: 4, maxAttempts: 3 },
        clock: () => new Date(),
      })
      .overrideProvider(FEED_OPTIONS)
      .useValue({ autoStart: false, retainedFiles: 3 })
      .overrideProvider(DescopeService)
      .useValue({
        validateSession: async (session: string) => {
          const identities: Record<string, typeof alice> = {
            'alice-session': alice,
            'bob-session': bob,
          };
          const identity = identities[session];
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
  });
  beforeEach(async () => {
    await pool().query('TRUNCATE estadistica_forms.app_users CASCADE');
    const users = app.get(UsersService);
    aliceId = (await users.provision(alice)).id;
    await users.provision(bob);
    projectId = (await app.get(ProjectsService).create(alice, projectInput)).id;
    await app.get(ProjectsService).create(bob, projectInput);
    const { rows } = await pool().query<{ id: string }>(
      `SELECT organization_id AS id FROM estadistica_forms.projects WHERE id = $1`,
      [projectId],
    );
    organizationId = rows[0].id;
    await rest()
      .post(`${projectPath()}/rulesets`)
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

  describe('hoja con columnas y filas', () => {
    it('una llamada da lo mismo que la hoja y la consulta de filas por REST', async () => {
      const worksheetId = await seededWorksheet();
      const variables = {
        organizationId,
        projectId,
        id: worksheetId,
        limit: 3,
      };

      const { worksheet } = await ok(WORKSHEET_QUERY, variables);

      const { body: sheet } = await rest()
        .get(`${scopePath()}/worksheets/${worksheetId}`)
        .expect(200);
      const { body: rows } = await rest()
        .post(`${scopePath()}/worksheets/${worksheetId}/rows/query`)
        .send({ limit: 3 })
        .expect(200);
      expect(worksheet).toMatchObject({
        id: worksheetId,
        name: sheet.worksheet.name,
        generation: 2,
        headRevision: {
          sequence: 2,
          rowCount: sheet.worksheet.headRevision.rowCount,
        },
      });
      expect(worksheet.columns).toEqual(
        sheet.worksheet.columns.map((column: Record<string, unknown>) => ({
          id: column.id,
          name: column.name,
          type: column.type,
          position: column.position,
          required: column.required,
        })),
      );
      expect(worksheet.rows).toEqual(rows);
      expect(worksheet.rows.items).toHaveLength(3);
      expect(worksheet.rows.nextCursor).not.toBeNull();
    });

    it('el cursor lleva a la página siguiente, como en REST', async () => {
      const worksheetId = await seededWorksheet();
      const variables = {
        organizationId,
        projectId,
        id: worksheetId,
        limit: 3,
      };
      const first = (await ok(WORKSHEET_QUERY, variables)).worksheet.rows;

      const { worksheet } = await ok(WORKSHEET_QUERY, {
        ...variables,
        cursor: first.nextCursor,
      });

      expect(worksheet.rows.items).toHaveLength(1);
      expect(worksheet.rows.nextCursor).toBeNull();
      expect(worksheet.rows.revisionId).toBe(first.revisionId);
    });

    it('valida la página y responde 404 a lo ajeno, como REST', async () => {
      const worksheetId = await seededWorksheet();
      const variables = { organizationId, projectId, id: worksheetId };

      const tooMany = await failure(WORKSHEET_QUERY, {
        ...variables,
        limit: 101,
      });
      expect(tooMany.extensions.code).toBe('VALIDATION_FAILED');

      const foreign = await failure(WORKSHEET_QUERY, variables, 'bob-session');
      expect(foreign.extensions.code).toBe('PROJECT_NOT_FOUND');
      const missing = await failure(WORKSHEET_QUERY, {
        ...variables,
        id: randomUUID(),
      });
      expect(missing.extensions.code).toBe('WORKSHEET_NOT_FOUND');
    });
  });

  describe('límite de coste', () => {
    it('rechaza con 400 una consulta demasiado cara antes de ejecutarla', async () => {
      const { feedId, exportId } = await publishedFeedWithCandidate();
      const page = 'changes { id change fields { field before after } }';
      const query = `
        query Costly($projectId: ID!, $feedId: ID!, $exportId: ID!) {
          feed(projectId: $projectId, id: $feedId) {
            a: comparison(exportId: $exportId, limit: 100) { ${page} }
            b: comparison(exportId: $exportId, limit: 100) { ${page} }
          }
        }`;
      const variables = { projectId, feedId, exportId };

      const { status, body } = await gql(query, variables);

      expect(status).toBe(400);
      const result = body as GraphQLBody;
      expect(result.data).toBeUndefined();
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0].extensions).toMatchObject({
        code: 'GRAPHQL_QUERY_TOO_COSTLY',
        maxCost: 1000,
      });
      expect(result.errors![0].extensions.cost).toBeGreaterThan(1000);
      expect(result.errors![0].extensions.requestId).toEqual(
        expect.any(String),
      );

      // La misma lectura con un límite razonable sí pasa.
      const cheap = query.replaceAll('limit: 100', 'limit: 20');
      const data = await ok(cheap, variables);
      expect(data.feed.a.changes).toEqual(data.feed.b.changes);
    });

    it('el límite llega también por variables', async () => {
      const { feedId, exportId } = await publishedFeedWithCandidate();
      const query = `
        query Costly($projectId: ID!, $feedId: ID!, $exportId: ID!, $limit: Int) {
          feed(projectId: $projectId, id: $feedId) {
            a: comparison(exportId: $exportId, limit: $limit) { changes { id change fields { field before after } } }
            b: comparison(exportId: $exportId, limit: $limit) { changes { id change fields { field before after } } }
          }
        }`;

      const costly = await failure(query, {
        projectId,
        feedId,
        exportId,
        limit: 100,
      });
      expect(costly.extensions.code).toBe('GRAPHQL_QUERY_TOO_COSTLY');
      await ok(query, { projectId, feedId, exportId, limit: 5 });
    });
  });

  describe('diagnóstico del feed', () => {
    it('una llamada da lo mismo que las cuatro rutas REST', async () => {
      const { feedId, exportId, evaluationId } =
        await publishedFeedWithCandidate();

      const data = await ok(DIAGNOSIS_QUERY, {
        projectId,
        feedId,
        exportId,
        evaluationId,
      });

      const feedPath = `${projectPath()}/feeds/${feedId}`;
      const { body: feed } = await rest().get(feedPath).expect(200);
      const { body: delivery } = await rest()
        .get(`${feedPath}/delivery`)
        .expect(200);
      const { body: comparison } = await rest()
        .get(`${feedPath}/comparison?exportId=${exportId}`)
        .expect(200);
      const { body: attention } = await rest()
        .get(`${projectPath()}/evaluations/${evaluationId}/attention`)
        .expect(200);

      expect(data.feed).toMatchObject({
        id: feedId,
        generation: feed.feed.generation,
        publishedVersion: { id: feed.feed.publishedVersion.id, rowCount: 3 },
        delivery: {
          delivering: delivery.delivery.delivering,
          reason: delivery.delivery.reason,
          deliveryEnabled: delivery.delivery.deliveryEnabled,
        },
      });
      expect(data.feed.delivery.delivering).toBe(true);
      expect(data.feed.comparison.counts).toEqual(comparison.comparison.counts);
      expect(data.feed.comparison.changedFields).toEqual(
        comparison.comparison.changedFields,
      );
      expect(data.feed.comparison.changes).toEqual(
        comparison.comparison.changes,
      );
      expect(data.feed.comparison.page).toEqual(comparison.comparison.page);
      expect(data.feed.comparison.counts).toEqual({
        added: 1,
        removed: 1,
        modified: 1,
        unchanged: 1,
      });

      const { evaluationId: _id, ...restAttention } = attention.attention;
      expect(data.evaluation.attention).toEqual(restAttention);
      expect(data.evaluation.attention.affectedProducts).toBe(1);
      expect(data.evaluation.attention.excludedProducts).toBe(1);
      expect(data.evaluation.counts).toEqual({
        total: 5,
        valid: 3,
        invalid: 1,
        excluded: 1,
      });
    });

    it('no hace más SQL que las cuatro rutas REST (caché por petición)', async () => {
      const { feedId, exportId, evaluationId } =
        await publishedFeedWithCandidate();
      const feedPath = `${projectPath()}/feeds/${feedId}`;

      const restStatements = await captureStatements(async () => {
        await rest().get(feedPath).expect(200);
        await rest().get(`${feedPath}/delivery`).expect(200);
        await rest()
          .get(`${feedPath}/comparison?exportId=${exportId}`)
          .expect(200);
        await rest()
          .get(`${projectPath()}/evaluations/${evaluationId}/attention`)
          .expect(200);
      });
      const graphqlStatements = await captureStatements(() =>
        ok(DIAGNOSIS_QUERY, { projectId, feedId, exportId, evaluationId }),
      );

      // Sin la caché eran 38 frente a 33 (piloto); con ella, 22 frente a 26.
      expect(graphqlStatements.length).toBeLessThanOrEqual(
        restStatements.length,
      );
      // Dentro de una petición, la persona y su acceso se leen una sola vez
      // aunque cada campo los vuelva a pedir (plan C7, G2).
      const reads = (marker: string) =>
        graphqlStatements.filter((text) => text.includes(marker)).length;
      expect(reads('AND identity_subject =')).toBe(1);
      expect(reads('AS "isArchived"')).toBe(1);
    });

    it('la comparación admite el tipo de cambio y la página, como REST', async () => {
      const { feedId, exportId } = await publishedFeedWithCandidate();
      const query = `
        query Changes($projectId: ID!, $feedId: ID!, $exportId: ID!) {
          feed(projectId: $projectId, id: $feedId) {
            added: comparison(exportId: $exportId, change: added) {
              changes { id change }
              counts { added removed modified unchanged }
            }
            firstOfAll: comparison(exportId: $exportId, limit: 1) {
              changes { id }
              page { limit offset hasMore }
            }
          }
        }`;

      const { feed } = await ok(query, { projectId, feedId, exportId });

      const path = `${projectPath()}/feeds/${feedId}/comparison?exportId=${exportId}`;
      const { body: added } = await rest()
        .get(`${path}&change=added`)
        .expect(200);
      const { body: first } = await rest().get(`${path}&limit=1`).expect(200);
      expect(feed.added.changes).toEqual([{ id: 'SKU-4', change: 'added' }]);
      expect(feed.added.counts).toEqual(added.comparison.counts);
      expect(feed.firstOfAll.changes).toHaveLength(1);
      expect(feed.firstOfAll.page).toEqual(first.comparison.page);
      expect(feed.firstOfAll.page).toEqual({
        limit: 1,
        offset: 0,
        hasMore: true,
      });
    });

    it('sin versión publicada, la comparación falla con el mismo error que REST', async () => {
      const { body: feed } = await rest()
        .post(`${projectPath()}/feeds`)
        .expect(201);
      const candidate = await exportRows([catalogValues('SKU-1')]);

      const { body } = await gql(DIAGNOSIS_QUERY, {
        projectId,
        feedId: feed.feed.id,
        exportId: candidate.exportId,
        evaluationId: candidate.evaluationId,
      });

      const result = body as GraphQLBody;
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0].extensions.code).toBe('FEED_NOT_PUBLISHED');
      // `comparison` no es anulable: su fallo anula `feed` y, con él, la respuesta.
      expect(result.data).toBeNull();
    });

    it('otra organización recibe 404 y sin sesión, 401', async () => {
      const { feedId, exportId, evaluationId } =
        await publishedFeedWithCandidate();
      const variables = { projectId, feedId, exportId, evaluationId };

      const { body } = await gql(DIAGNOSIS_QUERY, variables, 'bob-session');
      const foreign = body as GraphQLBody;
      expect(foreign.data).toBeNull();
      for (const error of foreign.errors ?? []) {
        expect(['PROJECT_NOT_FOUND', 'FEED_NOT_FOUND']).toContain(
          error.extensions.code,
        );
      }
      expect(foreign.errors?.length).toBeGreaterThan(0);

      const anonymous = await failure(DIAGNOSIS_QUERY, variables, '');
      expect(anonymous.extensions.code).toMatch(/^AUTH_/);
    });
  });
});
