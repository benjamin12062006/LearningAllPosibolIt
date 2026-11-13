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
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
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
import { ProjectsService } from '../../../src/projects/projects.service.js';
import { RulesetsModule } from '../../../src/rulesets/rulesets.module.js';
import { UsersService } from '../../../src/users/users.service.js';
import { rulesetBody } from '../rulesets/support/ruleset-fixtures.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';
import {
  catalogValues,
  insertReadySnapshot,
} from './support/snapshot-fixtures.js';

type Session = 'alice-session' | 'bob-session';

type Row = {
  externalId: string;
  outcome: string;
  problems: { attribute: string; code: string }[];
  excludedByRule: number | null;
};

type Attention = {
  evaluationId: string;
  affectedProducts: number;
  problemGroups: {
    attribute: string;
    code: string;
    productCount: number;
    problem: { es: string; en: string };
    suggestion: { es: string; en: string };
  }[];
  excludedProducts: number;
  exclusionGroups: {
    rulePosition: number;
    rule: Record<string, unknown>;
    productCount: number;
  }[];
};

/**
 * Catálogo con un caso de cada tipo. Las reglas de `rulesetBody` excluyen el
 * id `X1` (posición 3) y los productos sin marca (posición 4).
 */
const ATTENTION_CATALOG = [
  catalogValues('SKU-1'),
  // Dos problemas en el mismo producto.
  catalogValues('SKU-2', { Precio: '1,50', URL: 'no-es-una-url' }),
  catalogValues('SKU-3', { Precio: '1,50' }),
  catalogValues('SKU-4', { Marca: ' ' }),
  catalogValues('SKU-5', { Imagen: '' }),
  catalogValues('SKU-6', { Marca: '' }),
  catalogValues('X1'),
  catalogValues('SKU-8'),
  // Otro problema en el mismo atributo que SKU-2 y SKU-3, con otro código.
  catalogValues('SKU-9', { Precio: '' }),
];

/**
 * V3 (plan 02 de cierre, P4): «Requiere atención» agrupa los problemas de una
 * evaluación y deja abrir cada grupo con el informe de filas.
 */
describe('Requiere atención por HTTP: problemas agrupados y exclusiones', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let root: string;
  let projectId: string;
  let bobProjectId: string;
  let evaluationId: string;
  const validateSession = jest.fn<DescopeService['validateSession']>();

  const pool = () => database.connection.pool;
  const base = (id = projectId) => `/api/v1/projects/${id}`;

  function get(path: string, session: Session = 'alice-session') {
    return request(app.getHttpServer())
      .get(path)
      .auth(session, { type: 'bearer' });
  }

  const attentionPath = (id = evaluationId, project = projectId) =>
    `${base(project)}/evaluations/${id}/attention`;
  const rowsPath = (query: string, id = evaluationId) =>
    `${base()}/evaluations/${id}/rows${query}`;

  async function attention(): Promise<Attention> {
    const { body } = await get(attentionPath()).expect(200);
    return body.attention;
  }

  async function rows(query: string): Promise<Row[]> {
    const { body } = await get(rowsPath(query)).expect(200);
    return body.rows;
  }

  const idsOf = (found: Row[]) => found.map((row) => row.externalId);

  /** Pide la evaluación del catálogo; `run: false` la deja en cola. */
  async function requestEvaluation(
    catalog: Record<string, string>[],
    { run } = { run: true },
  ) {
    const snapshotId = await insertReadySnapshot(pool(), projectId, catalog);
    const { body } = await request(app.getHttpServer())
      .post(`${base()}/evaluations`)
      .auth('alice-session', { type: 'bearer' })
      .send({ snapshotId, rulesetRevision: 1 })
      .expect(202);
    if (run) {
      await app.get(EvaluationWorker).runUntilIdle();
    }
    return body.evaluationId as string;
  }

  /** Bob entra en la organización de Alice solo para leer. */
  async function makeBobViewerOfAlice() {
    await pool().query(
      `INSERT INTO estadistica_forms.organization_members
         (organization_id, user_id, role, created_at)
       SELECT p.organization_id, u.id, 'viewer', '2026-11-12T09:00:00.000Z'
       FROM estadistica_forms.projects p, estadistica_forms.app_users u
       WHERE p.id = $1 AND u.identity_subject = $2`,
      [projectId, bob.subject],
    );
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    root = await mkdtemp(join(tmpdir(), 'attention-http-'));
    const idle = { autoStart: false, pollMs: 1000, shutdownMs: 1000 };
    const module = await Test.createTestingModule({
      imports: [CatalogImportModule, RulesetsModule, EvaluationsModule],
    })
      .overrideProvider(POSTGRESQL_CONNECTION)
      .useValue(database.connection)
      .overrideProvider(DescopeService)
      .useValue({ validateSession })
      .overrideProvider(ARTIFACT_STORE_OPTIONS)
      .useValue({ root })
      .overrideProvider(CATALOG_IMPORT_OPTIONS)
      .useValue(idle)
      .overrideProvider(EVALUATION_OPTIONS)
      .useValue(idle)
      .compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
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
    const users = app.get(UsersService);
    await users.provision(alice);
    await users.provision(bob);
    projectId = (await app.get(ProjectsService).create(alice, projectInput)).id;
    bobProjectId = (await app.get(ProjectsService).create(bob, projectInput))
      .id;
    await request(app.getHttpServer())
      .post(`${base()}/rulesets`)
      .auth('alice-session', { type: 'bearer' })
      .send(rulesetBody())
      .expect(201);
    evaluationId = await requestEvaluation(ATTENTION_CATALOG);
  });
  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await database?.close();
      if (root) await rm(root, { recursive: true, force: true });
    }
  });

  describe('resumen', () => {
    it('un producto con dos problemas está en dos grupos y cuenta una vez en el total', async () => {
      const found = await attention();

      expect(found.evaluationId).toBe(evaluationId);
      expect(found.affectedProducts).toBe(4);
      expect(
        found.problemGroups.map((group) => [
          group.attribute,
          group.productCount,
        ]),
      ).toEqual([
        ['price', 2],
        ['image_link', 1],
        ['link', 1],
        ['price', 1],
      ]);
      const inGroups = found.problemGroups.reduce(
        (sum, group) => sum + group.productCount,
        0,
      );
      expect(inGroups).toBe(5);
    });

    it('cada grupo lleva su código y los textos en español e inglés', async () => {
      const found = await attention();

      const byAttribute = new Map(
        found.problemGroups.map((group) => [group.attribute, group]),
      );
      expect(byAttribute.get('image_link')).toMatchObject({
        code: 'FIELD_MISSING',
        problem: { es: 'Falta un valor obligatorio para Google.' },
      });
      expect(byAttribute.get('link')?.code).toBe('URL_INVALID');
      for (const group of found.problemGroups) {
        expect(group.problem.es).not.toBe('');
        expect(group.problem.en).not.toBe('');
        expect(group.suggestion.es).not.toBe('');
        expect(group.suggestion.en).not.toBe('');
      }
    });

    it('las exclusiones van aparte, por regla y con la regla que las causó', async () => {
      const found = await attention();

      expect(found.excludedProducts).toBe(3);
      expect(found.exclusionGroups).toEqual([
        {
          rulePosition: 3,
          rule: {
            type: 'exclude_when',
            attribute: 'id',
            operator: 'equals',
            value: 'X1',
          },
          productCount: 1,
        },
        {
          rulePosition: 4,
          rule: expect.objectContaining({
            type: 'exclude_when',
            attribute: 'brand',
            operator: 'is_empty',
          }),
          productCount: 2,
        },
      ]);
      // Un excluido no es un afectado: no hay nada que arreglar en él.
      expect(found.affectedProducts).toBe(4);
      expect(found.affectedProducts + found.excludedProducts).toBe(7);
    });

    it('coincide con lo que dice la evaluación y con sus filas', async () => {
      const found = await attention();
      const { body } = await get(
        `${base()}/evaluations/${evaluationId}`,
      ).expect(200);
      const invalid = await rows('?outcome=invalid&limit=100');

      expect(found.affectedProducts).toBe(body.evaluation.counts.invalid);
      expect(found.excludedProducts).toBe(body.evaluation.counts.excluded);
      const problemsInRows = invalid.reduce(
        (sum, row) => sum + row.problems.length,
        0,
      );
      expect(problemsInRows).toBe(5);
    });

    it('un catálogo sin problemas no tiene grupos', async () => {
      evaluationId = await requestEvaluation([
        catalogValues('SKU-1'),
        catalogValues('SKU-2'),
      ]);

      expect(await attention()).toEqual({
        evaluationId,
        affectedProducts: 0,
        problemGroups: [],
        excludedProducts: 0,
        exclusionGroups: [],
      });
    });
  });

  describe('abrir un grupo con el informe de filas', () => {
    it('por problema: las filas que tienen ese atributo y ese código', async () => {
      const found = await attention();
      const price = found.problemGroups[0];

      const withPrice = await rows(
        `?attribute=price&code=${price.code}&limit=100`,
      );
      const withLink = await rows('?attribute=link&code=URL_INVALID');
      const withImage = await rows('?attribute=image_link&code=FIELD_MISSING');
      const withoutPrice = await rows('?attribute=price&code=FIELD_MISSING');

      expect(idsOf(withPrice)).toEqual(['SKU-2', 'SKU-3']);
      expect(idsOf(withLink)).toEqual(['SKU-2']);
      expect(idsOf(withImage)).toEqual(['SKU-5']);
      // El mismo atributo con otro código es otro grupo.
      expect(idsOf(withoutPrice)).toEqual(['SKU-9']);
      expect(price.code).not.toBe('FIELD_MISSING');
      // El grupo dice cuántas filas hay al abrirlo.
      expect(withPrice).toHaveLength(price.productCount);
    });

    it('el atributo y el código tienen que coincidir en el mismo problema', async () => {
      // SKU-2 tiene `link: URL_INVALID` y un problema de precio, pero no esta mezcla.
      expect(await rows('?attribute=price&code=URL_INVALID')).toEqual([]);
      expect(await rows('?attribute=link&code=FIELD_MISSING')).toEqual([]);
    });

    it('por regla: las filas que excluyó la regla de esa posición', async () => {
      expect(idsOf(await rows('?rule=3'))).toEqual(['X1']);
      expect(idsOf(await rows('?rule=4'))).toEqual(['SKU-4', 'SKU-6']);
      expect(await rows('?rule=1')).toEqual([]);
    });

    it('los filtros se suman entre sí y con la paginación', async () => {
      const price = (await attention()).problemGroups[0];
      const query = `?attribute=price&code=${price.code}`;

      expect(await rows(`${query}&outcome=valid`)).toEqual([]);
      expect(await rows('?rule=4&outcome=invalid')).toEqual([]);
      expect(idsOf(await rows('?rule=4&outcome=excluded'))).toEqual([
        'SKU-4',
        'SKU-6',
      ]);

      const { body: first } = await get(rowsPath(`${query}&limit=1`)).expect(
        200,
      );
      const { body: second } = await get(
        rowsPath(`${query}&limit=1&offset=1`),
      ).expect(200);
      expect(idsOf(first.rows)).toEqual(['SKU-2']);
      expect(first.page).toEqual({ limit: 1, offset: 0, hasMore: true });
      expect(idsOf(second.rows)).toEqual(['SKU-3']);
      expect(second.page.hasMore).toBe(false);
    });

    it('sin filtros nuevos el informe sigue igual que antes', async () => {
      expect(idsOf(await rows('?limit=100'))).toEqual([
        'SKU-1',
        'SKU-2',
        'SKU-3',
        'SKU-4',
        'SKU-5',
        'SKU-6',
        'X1',
        'SKU-8',
        'SKU-9',
      ]);
      expect(idsOf(await rows('?outcome=valid'))).toEqual(['SKU-1', 'SKU-8']);
    });

    it('valida los filtros', async () => {
      for (const query of [
        '?attribute=price',
        '?code=URL_INVALID',
        '?attribute=precio&code=URL_INVALID',
        '?attribute=price&code=NO_EXISTE',
        '?rule=0',
        '?rule=1001',
        '?rule=tres',
        '?rule=1.5',
      ]) {
        await get(rowsPath(query))
          .expect(400)
          .expect(({ body }) => expect(body.code).toBeDefined());
      }
    });
  });

  describe('acceso y estados', () => {
    it('una evaluación sin terminar no tiene informe todavía', async () => {
      const queued = await requestEvaluation(ATTENTION_CATALOG, { run: false });

      await get(attentionPath(queued))
        .expect(409)
        .expect(({ body }) =>
          expect(body).toMatchObject(
            publicError('EVALUATION_RESULTS_UNAVAILABLE'),
          ),
        );
    });

    it('una evaluación que no existe o un id que no es UUID', async () => {
      await get(attentionPath(randomUUID()))
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('EVALUATION_NOT_FOUND')),
        );
      await get(attentionPath('no-es-uuid')).expect(400);
    });

    it('un Viewer lo lee; otra organización recibe 404 y sin sesión, 401', async () => {
      await get(attentionPath(), 'bob-session').expect(404);
      await get(attentionPath(evaluationId, bobProjectId), 'bob-session')
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('EVALUATION_NOT_FOUND')),
        );
      await request(app.getHttpServer()).get(attentionPath()).expect(401);

      await makeBobViewerOfAlice();
      const { body } = await get(attentionPath(), 'bob-session').expect(200);
      expect(body.attention.affectedProducts).toBe(4);
    });
  });
});
