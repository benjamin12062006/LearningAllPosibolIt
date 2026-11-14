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
import type { OrganizationRole } from '../../../src/organizations/organization-roles.js';
import { ProjectsService } from '../../../src/projects/projects.service.js';
import { RulesetsModule } from '../../../src/rulesets/rulesets.module.js';
import { UsersService } from '../../../src/users/users.service.js';
import {
  bodyWithRules,
  rulesetBody,
} from '../rulesets/support/ruleset-fixtures.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';
import {
  catalogValues,
  insertReadySnapshot,
} from './support/snapshot-fixtures.js';

type Session = 'alice-session' | 'bob-session';

type PreviewedOutcome = {
  outcome: string;
  problems: { attribute: string; code: string; problem: { es: string } }[];
  excludedByRule: number | null;
};

type Preview = {
  snapshotId: string;
  baseRevision: number;
  counts: Record<'current' | 'proposed', Record<string, number>>;
  problems: Record<
    'appeared' | 'resolved' | 'persisting',
    { attribute: string; code: string; productCount: number }[]
  >;
  outcomeChanges: { from: string; to: string; productCount: number }[];
  changedValues: { attribute: string; productCount: number }[];
  changedProducts: number;
  products: {
    sourceRow: number;
    externalId: string;
    current: PreviewedOutcome;
    proposed: PreviewedOutcome;
    values: {
      attribute: string;
      before: string | null;
      after: string | null;
    }[];
  }[];
  page: { limit: number; offset: number; hasMore: boolean };
};

/** 140 caracteres: con «Acme » delante son 145 y Google admite 150. */
const LONG_NAME = 'M'.repeat(140);

/**
 * Un caso de cada cosa que las reglas propuestas cambian. Las vigentes
 * (`rulesetBody`) limpian título y marca, montan el título como
 * «marca título» y excluyen el id `X1` y los productos sin marca.
 */
const CATALOG = [
  catalogValues('SKU-1'),
  // Tabulador en la descripción: las reglas vigentes no la limpian.
  catalogValues('SKU-2', { Descripción: 'Mesa\tde roble' }),
  // Nombre largo: cabe con el título vigente, pero no con la plantilla propuesta.
  catalogValues('SKU-3', { Nombre: LONG_NAME }),
  catalogValues('SKU-4', { Stock: 'out_of_stock' }),
  // Inválido con las dos: el precio no lo arregla ninguna regla.
  catalogValues('SKU-5', { Precio: '1,50' }),
  catalogValues('X1'),
  catalogValues('SKU-7', { Marca: '' }),
];

/**
 * Limpian también la descripción, montan el título al revés y con una
 * coletilla, y además excluyen lo agotado.
 */
const PROPOSED_RULES = [
  { type: 'clean_text', attributes: ['title', 'description', 'brand'] },
  { type: 'build_title', template: '{title} - {brand} - oferta' },
  {
    type: 'exclude_when',
    attribute: 'availability',
    operator: 'equals',
    value: 'out_of_stock',
  },
  { type: 'exclude_when', attribute: 'id', operator: 'equals', value: 'X1' },
  { type: 'exclude_when', attribute: 'brand', operator: 'is_empty' },
];

/**
 * V5 (plan 02 de cierre, P6): probar unas reglas sobre un catálogo sin
 * guardarlas, con el mismo motor que una evaluación real.
 */
describe('Vista previa de reglas por HTTP: qué cambiaría sin guardar nada', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let root: string;
  let projectId: string;
  let bobProjectId: string;
  let snapshotId: string;
  const validateSession = jest.fn<DescopeService['validateSession']>();

  const pool = () => database.connection.pool;
  const base = (id = projectId) => `/api/v1/projects/${id}`;

  function post(path: string, session: Session = 'alice-session') {
    return request(app.getHttpServer())
      .post(path)
      .auth(session, { type: 'bearer' });
  }

  const previewPath = (query = '', id = projectId) =>
    `${base(id)}/evaluations/preview${query}`;

  const proposedBody = (overrides: Record<string, unknown> = {}) => ({
    ...bodyWithRules(PROPOSED_RULES),
    snapshotId,
    ...overrides,
  });

  async function preview(
    body: Record<string, unknown> = proposedBody(),
    query = '',
  ): Promise<Preview> {
    const response = await post(previewPath(query)).send(body).expect(200);
    return response.body.preview;
  }

  async function setBobRole(role: OrganizationRole) {
    await pool().query(
      `INSERT INTO estadistica_forms.organization_members
         (organization_id, user_id, role, created_at)
       SELECT p.organization_id, u.id, $3, '2026-11-13T09:00:00.000Z'
       FROM estadistica_forms.projects p, estadistica_forms.app_users u
       WHERE p.id = $1 AND u.identity_subject = $2
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = $3`,
      [projectId, bob.subject, role],
    );
  }

  /** Cuántas filas hay en las tablas que una vista previa no debe tocar. */
  async function storedRows() {
    const { rows } = await pool().query<Record<string, number>>(
      `SELECT
         (SELECT count(*)::int FROM estadistica_forms.ruleset_versions) AS rulesets,
         (SELECT count(*)::int FROM estadistica_forms.evaluations) AS evaluations,
         (SELECT count(*)::int FROM estadistica_forms.evaluation_rows) AS "evaluationRows"`,
    );
    return rows[0];
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    root = await mkdtemp(join(tmpdir(), 'rules-preview-http-'));
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
    await post(`${base()}/rulesets`).send(rulesetBody()).expect(201);
    snapshotId = await insertReadySnapshot(pool(), projectId, CATALOG);
  });
  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await database?.close();
      if (root) await rm(root, { recursive: true, force: true });
    }
  });

  describe('qué cambia', () => {
    it('cuenta los resultados con las reglas vigentes y con las propuestas', async () => {
      const found = await preview();

      expect(found.snapshotId).toBe(snapshotId);
      expect(found.baseRevision).toBe(1);
      expect(found.counts).toEqual({
        current: { total: 7, valid: 3, invalid: 2, excluded: 2 },
        proposed: { total: 7, valid: 2, invalid: 2, excluded: 3 },
      });
      expect(found.outcomeChanges).toEqual([
        { from: 'invalid', to: 'valid', productCount: 1 },
        { from: 'valid', to: 'excluded', productCount: 1 },
        { from: 'valid', to: 'invalid', productCount: 1 },
      ]);
    });

    it('dice qué problemas aparecen, cuáles se resuelven y cuáles siguen', async () => {
      const { problems } = await preview();

      expect(problems.appeared).toMatchObject([
        { attribute: 'title', code: 'TEXT_TOO_LONG', productCount: 1 },
      ]);
      expect(problems.resolved).toMatchObject([
        {
          attribute: 'description',
          code: 'TEXT_HAS_LINE_BREAK',
          productCount: 1,
        },
      ]);
      expect(problems.persisting).toMatchObject([
        { attribute: 'price', productCount: 1 },
      ]);
      // Con los mismos textos que el informe de una evaluación.
      expect(problems.appeared[0]).toMatchObject({
        problem: { es: expect.stringContaining('máximo') },
        suggestion: { es: expect.any(String), en: expect.any(String) },
      });
    });

    it('dice qué atributos cambian de valor y en cuántos productos', async () => {
      const found = await preview();

      // El título cambia en los cuatro productos que no quedan excluidos.
      expect(found.changedValues).toEqual([
        { attribute: 'title', productCount: 4 },
        { attribute: 'description', productCount: 1 },
      ]);
      expect(found.changedProducts).toBe(5);
      expect(found.products.map((product) => product.externalId)).toEqual([
        'SKU-1',
        'SKU-2',
        'SKU-3',
        'SKU-4',
        'SKU-5',
      ]);
    });

    it('de cada producto da el antes y el después', async () => {
      const { products } = await preview();
      const byId = new Map(
        products.map((product) => [product.externalId, product]),
      );

      expect(byId.get('SKU-1')).toMatchObject({
        sourceRow: 1,
        current: { outcome: 'valid', problems: [] },
        proposed: { outcome: 'valid', problems: [] },
        values: [
          {
            attribute: 'title',
            before: 'Acme Mesa SKU-1',
            after: 'Mesa SKU-1 - Acme - oferta',
          },
        ],
      });
      expect(byId.get('SKU-2')).toMatchObject({
        current: {
          outcome: 'invalid',
          problems: [{ attribute: 'description', code: 'TEXT_HAS_LINE_BREAK' }],
        },
        proposed: { outcome: 'valid', problems: [] },
      });
      expect(byId.get('SKU-2')?.values).toContainEqual({
        attribute: 'description',
        before: 'Mesa\tde roble',
        after: 'Mesa de roble',
      });
      expect(byId.get('SKU-3')?.proposed).toMatchObject({
        outcome: 'invalid',
        problems: [{ attribute: 'title', code: 'TEXT_TOO_LONG' }],
      });
      expect(byId.get('SKU-4')).toMatchObject({
        current: { outcome: 'valid', excludedByRule: null },
        proposed: { outcome: 'excluded', excludedByRule: 3 },
        values: [],
      });
    });

    it('los excluidos por la misma regla en otra posición no cuentan como cambio', async () => {
      const { products } = await preview();

      // X1 pasa de la posición 3 a la 4 y el producto sin marca, de la 4 a la 5.
      const ids = products.map((product) => product.externalId);
      expect(ids).not.toContain('X1');
      expect(ids).not.toContain('SKU-7');
    });

    it('con las mismas reglas que las vigentes no cambia nada', async () => {
      const found = await preview({ ...rulesetBody(), snapshotId });

      expect(found.changedProducts).toBe(0);
      expect(found.products).toEqual([]);
      expect(found.outcomeChanges).toEqual([]);
      expect(found.changedValues).toEqual([]);
      expect(found.problems.appeared).toEqual([]);
      expect(found.problems.resolved).toEqual([]);
      expect(found.problems.persisting).toHaveLength(2);
      expect(found.counts.current).toEqual(found.counts.proposed);
    });

    it('coincide con una evaluación real de las reglas vigentes', async () => {
      const found = await preview();
      const { body: accepted } = await post(`${base()}/evaluations`)
        .send({ snapshotId, rulesetRevision: 1 })
        .expect(202);
      await app.get(EvaluationWorker).runUntilIdle();
      const { body } = await request(app.getHttpServer())
        .get(accepted.statusUrl)
        .auth('alice-session', { type: 'bearer' })
        .expect(200);

      expect(found.counts.current).toEqual(body.evaluation.counts);
    });
  });

  describe('no guarda nada', () => {
    it('no crea reglas, evaluaciones ni filas, ni cambia la revisión vigente', async () => {
      const before = await storedRows();

      await preview();
      await preview();

      expect(await storedRows()).toEqual(before);
      expect(before).toEqual({
        rulesets: 1,
        evaluations: 0,
        evaluationRows: 0,
      });
      const { body } = await request(app.getHttpServer())
        .get(`${base()}/rulesets`)
        .auth('alice-session', { type: 'bearer' })
        .expect(200);
      expect(body.rulesets).toHaveLength(1);
    });
  });

  describe('con qué se compara', () => {
    it('sin baseRevision, con la última revisión guardada', async () => {
      await post(`${base()}/rulesets`)
        .send(bodyWithRules(PROPOSED_RULES))
        .expect(201);

      const found = await preview();

      // Las propuestas ya son la revisión 2: comparadas consigo mismas, nada cambia.
      expect(found.baseRevision).toBe(2);
      expect(found.changedProducts).toBe(0);
    });

    it('con baseRevision, con esa revisión aunque haya otra posterior', async () => {
      await post(`${base()}/rulesets`)
        .send(bodyWithRules(PROPOSED_RULES))
        .expect(201);

      const found = await preview(proposedBody({ baseRevision: 1 }));

      expect(found.baseRevision).toBe(1);
      expect(found.changedProducts).toBe(5);
    });

    it('la revisión base es la del proyecto, aunque otro tenga una posterior', async () => {
      for (const body of [rulesetBody(), bodyWithRules(PROPOSED_RULES)]) {
        await post(`${base(bobProjectId)}/rulesets`, 'bob-session')
          .send(body)
          .expect(201);
      }

      const found = await preview();

      // La revisión 2 de Bob son justo las propuestas: usarla daría cero cambios.
      expect(found.baseRevision).toBe(1);
      expect(found.changedProducts).toBe(5);
    });

    it('una revisión o un catálogo que no existen responden 404', async () => {
      await post(previewPath())
        .send(proposedBody({ baseRevision: 99 }))
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('RULESET_NOT_FOUND')),
        );
      await post(previewPath())
        .send(proposedBody({ snapshotId: randomUUID() }))
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('IMPORT_NOT_FOUND')),
        );
    });

    it('un catálogo de otro proyecto responde 404', async () => {
      await setBobRole('editor');
      await post(`${base(bobProjectId)}/rulesets`, 'bob-session')
        .send(rulesetBody())
        .expect(201);

      // Bob edita en los dos proyectos, pero el catálogo es del de Alice.
      await post(previewPath('', bobProjectId), 'bob-session')
        .send(proposedBody())
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('IMPORT_NOT_FOUND')),
        );
    });
  });

  describe('paginación y validación', () => {
    it('pagina los productos cambiados; los recuentos son del catálogo entero', async () => {
      const first = await preview(proposedBody(), '?limit=2');
      const last = await preview(proposedBody(), '?limit=2&offset=4');

      expect(first.products.map((product) => product.externalId)).toEqual([
        'SKU-1',
        'SKU-2',
      ]);
      expect(first.page).toEqual({ limit: 2, offset: 0, hasMore: true });
      expect(last.products.map((product) => product.externalId)).toEqual([
        'SKU-5',
      ]);
      expect(last.page).toEqual({ limit: 2, offset: 4, hasMore: false });
      for (const found of [first, last]) {
        expect(found.changedProducts).toBe(5);
        expect(found.counts.proposed.excluded).toBe(3);
      }
    });

    it('evalúa el catálogo entero aunque ocupe más de un lote de lectura', async () => {
      // El worker y la vista previa leen de 250 en 250.
      const rows = Array.from({ length: 260 }, (_, index) =>
        catalogValues(`SKU-${index + 1}`),
      );
      rows[259] = catalogValues('SKU-260', { Stock: 'out_of_stock' });
      snapshotId = await insertReadySnapshot(pool(), projectId, rows);

      const found = await preview(proposedBody(), '?limit=1&offset=259');

      expect(found.counts.current).toEqual({
        total: 260,
        valid: 260,
        invalid: 0,
        excluded: 0,
      });
      expect(found.counts.proposed.excluded).toBe(1);
      expect(found.changedProducts).toBe(260);
      expect(found.products.map((product) => product.externalId)).toEqual([
        'SKU-260',
      ]);
    });

    it('valida el body como al guardar las reglas', async () => {
      const { snapshotId: _omitted, ...withoutSnapshot } = proposedBody();

      for (const body of [
        withoutSnapshot,
        proposedBody({ snapshotId: 'no-es-uuid' }),
        proposedBody({ baseRevision: 0 }),
        proposedBody({ baseRevision: 1.5 }),
        proposedBody({ mapping: [] }),
        proposedBody({ rules: [{ type: 'no_existe' }] }),
        proposedBody({ otro: 1 }),
      ]) {
        await post(previewPath())
          .send(body)
          .expect(400)
          .expect(({ body: error }) => expect(error.code).toBeDefined());
      }
      await post(previewPath('?limit=0')).send(proposedBody()).expect(400);
    });

    it('rechaza unas reglas incoherentes, como al guardarlas', async () => {
      const rules = [{ type: 'build_title', template: '{color} {title}' }];

      await post(previewPath())
        .send(proposedBody({ rules }))
        .expect(400)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('VALIDATION_FAILED')),
        );
    });

    it('rechaza un mapeo a una columna que el catálogo no tiene', async () => {
      const mapping = rulesetBody().mapping.map((item) =>
        item.attribute === 'price' ? { ...item, column: 'PVP' } : item,
      );

      const { body } = await post(previewPath()).send(
        proposedBody({ mapping }),
      );

      expect(body).toMatchObject(publicError('EVALUATION_COLUMN_MISSING'));
      expect(body.issues ?? body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'mapping.price' }),
        ]),
      );
    });
  });

  describe('acceso', () => {
    it('un Viewer no puede probar reglas; un Editor sí', async () => {
      await setBobRole('viewer');
      await post(previewPath(), 'bob-session')
        .send(proposedBody())
        .expect(403)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('FORBIDDEN')),
        );

      await setBobRole('editor');
      const { body } = await post(previewPath(), 'bob-session')
        .send(proposedBody())
        .expect(200);
      expect(body.preview.changedProducts).toBe(5);
    });

    it('otra organización recibe 404 y sin sesión, 401', async () => {
      await post(previewPath(), 'bob-session')
        .send(proposedBody())
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('PROJECT_NOT_FOUND')),
        );
      await request(app.getHttpServer())
        .post(previewPath())
        .send(proposedBody())
        .expect(401);
      await post(`/api/v1/projects/no-es-uuid/evaluations/preview`)
        .send(proposedBody())
        .expect(400);
    });
  });
});
