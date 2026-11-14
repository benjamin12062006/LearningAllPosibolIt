import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { EvaluationWorker } from '../../../src/evaluations/evaluations.worker.js';
import {
  catalogValues,
  insertReadySnapshot,
} from '../evaluations/support/snapshot-fixtures.js';
import { rulesetBody } from '../rulesets/support/ruleset-fixtures.js';
import {
  clientsFor,
  seedTwoOrganizations,
  setRole,
  startGraphqlApp,
} from './support/graphql-test-app.js';

const PAGE = 'page { limit offset hasMore }';

const SUMMARY = `
  query Summary($id: ID!) {
    project(id: $id) {
      id
      name
      access { organizationId role permissions }
      imports { items { id status rowCount originalName idColumn job { id status processedRows } } ${PAGE} }
      rulesets { items { id revision mapping { attribute column } rules createdAt } ${PAGE} }
      evaluations { items { id status rulesetRevision resultChecksum counts { total valid invalid excluded } } ${PAGE} }
      feeds { id generation deliveryEnabled }
      knowledge { enabled sources { sourceType sourceId syncedAt pending } }
      workbooks { items { id name archivedAt } ${PAGE} }
    }
  }`;

const CREATE_RULESET = `
  mutation CreateRuleset($projectId: ID!, $input: RulesetInput!) {
    createRuleset(projectId: $projectId, input: $input) {
      id revision mapping { attribute column } rules createdAt
    }
  }`;

const REQUEST_EVALUATION = `
  mutation Request($projectId: ID!, $input: RequestEvaluationInput!) {
    requestEvaluation(projectId: $projectId, input: $input) {
      id status snapshotId rulesetRevision counts { total }
    }
  }`;

const PROBLEM = 'attribute code problem { es en } suggestion { es en }';
const EVALUATION_ROWS = `
  query Rows($projectId: ID!, $id: ID!, $outcome: String, $attribute: String, $code: String, $limit: Int) {
    evaluation(projectId: $projectId, id: $id) {
      id status resultChecksum
      counts { total valid invalid excluded }
      rows(outcome: $outcome, attribute: $attribute, code: $code, limit: $limit) {
        items { sourceRow externalId outcome values problems { ${PROBLEM} } excludedByRule }
        ${PAGE}
      }
    }
  }`;

const APPROVE_EXPORT = `
  mutation Approve($projectId: ID!, $input: ApproveExportInput!) {
    approveExport(projectId: $projectId, input: $input) {
      created downloadUrl
      export { id evaluationId rowCount byteSize tsvChecksum acceptedInvalidCount acceptedExcludedCount createdAt }
    }
  }`;

const EXPORT_VIEW = `
  query ExportView($projectId: ID!, $id: ID!, $productId: String!, $search: String) {
    export(projectId: $projectId, id: $id) {
      id rowCount
      products(limit: 2, search: $search) { columns products { line values } ${PAGE} rowCount }
      product(id: $productId) { columns product { line values } source { kind export { id rowCount products(limit: 1) { rowCount } } } }
    }
  }`;

const RULES_PREVIEW = `
  query Preview($projectId: ID!, $input: RulesPreviewInput!, $limit: Int) {
    rulesPreview(projectId: $projectId, input: $input, limit: $limit) {
      snapshotId baseRevision changedProducts
      counts { current { total valid invalid excluded } proposed { total valid invalid excluded } }
      problems { appeared { ${PROBLEM} productCount } resolved { ${PROBLEM} productCount } persisting { ${PROBLEM} productCount } }
      outcomeChanges { from to productCount }
      changedValues { attribute productCount }
      products { sourceRow externalId values { attribute before after }
        current { outcome excludedByRule problems { ${PROBLEM} } }
        proposed { outcome excludedByRule problems { ${PROBLEM} } } }
      ${PAGE}
    }
  }`;

/** Las reglas de `rulesetBody()` escritas con `@oneOf`. */
function rulesetInput() {
  const { mapping } = rulesetBody();
  return {
    mapping,
    rules: [
      { cleanText: { attributes: ['title', 'brand'] } },
      { buildTitle: { template: '{brand} {title}' } },
      { excludeWhen: { attribute: 'id', operator: 'equals', value: 'X1' } },
      { excludeWhen: { attribute: 'brand', operator: 'is_empty' } },
    ],
  };
}

const CATALOG = [
  catalogValues('SKU-1'),
  catalogValues('SKU-2', { Precio: '' }),
  catalogValues('SKU-3', { Marca: '' }),
  catalogValues('X1'),
  catalogValues('SKU-4', { Nombre: 'Silla plegable' }),
];

/**
 * C7.2: proyecto, reglas, evaluaciones y exportaciones por GraphQL. Lo que se
 * comprueba es la paridad con REST: mismos datos, mismos errores y mismos
 * permisos, porque los resolvers llaman a los mismos servicios.
 */
describe('GraphQL C7.2: proyecto, reglas, evaluaciones y exportaciones', () => {
  let app: INestApplication;
  let pool: Pool;
  let close: () => Promise<void>;
  let projectId: string;
  let organizationId: string;
  let bobId: string;
  let bobProjectId: string;

  const client = () => clientsFor(app);
  const projectPath = () => `/api/v1/projects/${projectId}`;

  /** Evalúa el catálogo con la revisión dada por REST y espera al worker. */
  async function evaluateByRest(snapshotId: string, rulesetRevision = 1) {
    const { body } = await client()
      .rest()
      .post(`${projectPath()}/evaluations`)
      .send({ snapshotId, rulesetRevision })
      .expect(202);
    await app.get(EvaluationWorker).runUntilIdle();
    const { body: done } = await client()
      .rest()
      .get(`${projectPath()}/evaluations/${body.evaluationId}`)
      .expect(200);
    return done.evaluation;
  }

  function approvalOf(evaluation: Record<string, any>) {
    return {
      evaluationId: evaluation.id,
      resultChecksum: evaluation.resultChecksum,
      acceptedInvalidCount: evaluation.counts.invalid,
      acceptedExcludedCount: evaluation.counts.excluded,
    };
  }

  beforeAll(async () => {
    ({ app, pool, close } = await startGraphqlApp());
  });
  beforeEach(async () => {
    ({ projectId, organizationId, bobId, bobProjectId } =
      await seedTwoOrganizations(app, pool));
  });
  afterAll(async () => {
    await close?.();
  });

  it('el resumen del proyecto en una llamada da lo mismo que siete rutas REST', async () => {
    const { rest, ok } = client();
    await rest()
      .post(`${projectPath()}/rulesets`)
      .send(rulesetBody())
      .expect(201);
    const snapshotId = await insertReadySnapshot(pool, projectId, CATALOG);
    await evaluateByRest(snapshotId);
    await rest().post(`${projectPath()}/feeds`).expect(201);
    const scopePath = `/api/v1/organizations/${organizationId}/projects/${projectId}`;
    await rest()
      .post(`${scopePath}/workbooks`)
      .send({ name: 'Libro' })
      .expect(201);

    const { project } = await ok(SUMMARY, { id: projectId });

    const get = async (path: string) =>
      (await rest().get(path).expect(200)).body;
    const access = await get(`/api/v1/projects/${projectId}/access`);
    expect(project.access).toEqual({
      organizationId: access.access.organizationId,
      role: access.access.role,
      permissions: access.access.permissions,
    });
    expect(project.access.role).toBe('owner');

    const imports = await get(`${projectPath()}/imports`);
    expect(project.imports.page).toEqual(imports.page);
    expect(project.imports.items).toEqual(
      imports.imports.map((item: Record<string, any>) => ({
        id: item.id,
        status: item.status,
        rowCount: item.rowCount,
        originalName: item.originalName,
        idColumn: item.idColumn,
        job: item.job,
      })),
    );
    expect(
      project.imports.items.map((item: { id: string }) => item.id),
    ).toEqual([snapshotId]);

    const rulesets = await get(`${projectPath()}/rulesets`);
    expect(project.rulesets).toEqual({
      items: rulesets.rulesets,
      page: rulesets.page,
    });

    const evaluations = await get(`${projectPath()}/evaluations`);
    expect(project.evaluations.page).toEqual(evaluations.page);
    expect(project.evaluations.items).toEqual(
      evaluations.evaluations.map((item: Record<string, any>) => ({
        id: item.id,
        status: item.status,
        rulesetRevision: item.rulesetRevision,
        resultChecksum: item.resultChecksum,
        counts: item.counts,
      })),
    );

    const feeds = await get(`${projectPath()}/feeds`);
    expect(project.feeds).toEqual(
      feeds.items.map((feed: Record<string, any>) => ({
        id: feed.id,
        generation: feed.generation,
        deliveryEnabled: feed.deliveryEnabled,
      })),
    );
    expect(project.feeds).toHaveLength(1);

    expect(project.knowledge).toEqual(await get(`${projectPath()}/knowledge`));

    const workbooks = await get(`${scopePath}/workbooks`);
    expect(project.workbooks.page).toEqual(workbooks.page);
    expect(project.workbooks.items).toEqual(
      workbooks.workbooks.map((workbook: Record<string, any>) => ({
        id: workbook.id,
        name: workbook.name,
        archivedAt: workbook.archivedAt,
      })),
    );
  });

  it('las evaluaciones y los feeds del proyecto traen sus propios campos', async () => {
    const { rest, ok } = client();
    await rest()
      .post(`${projectPath()}/rulesets`)
      .send(rulesetBody())
      .expect(201);
    const snapshotId = await insertReadySnapshot(pool, projectId, CATALOG);
    const evaluation = await evaluateByRest(snapshotId);
    const { body: feed } = await rest()
      .post(`${projectPath()}/feeds`)
      .expect(201);

    const { project } = await ok(
      `query($id: ID!) {
        project(id: $id) {
          evaluations(limit: 5) { items { id attention { affectedProducts excludedProducts } } }
          feeds { id delivery { delivering reason } }
        }
      }`,
      { id: projectId },
    );

    const { body: attention } = await rest()
      .get(`${projectPath()}/evaluations/${evaluation.id}/attention`)
      .expect(200);
    expect(project.evaluations.items).toEqual([
      {
        id: evaluation.id,
        attention: {
          affectedProducts: attention.attention.affectedProducts,
          excludedProducts: attention.attention.excludedProducts,
        },
      },
    ]);
    const { body: delivery } = await rest()
      .get(`${projectPath()}/feeds/${feed.feed.id}/delivery`)
      .expect(200);
    expect(project.feeds).toEqual([
      {
        id: feed.feed.id,
        delivery: {
          delivering: delivery.delivery.delivering,
          reason: delivery.delivery.reason,
        },
      },
    ]);
  });

  it('organizationProjects pagina como GET /organizations/:id/projects', async () => {
    const { rest, ok } = client();
    const query = `
      query Projects($organizationId: ID!, $limit: Int) {
        organizationProjects(organizationId: $organizationId, limit: $limit) {
          items { id name country currency channelProfile configurationStatus createdAt }
          ${PAGE}
        }
      }`;

    const data = await ok(query, { organizationId, limit: 1 });

    const { body } = await rest()
      .get(`/api/v1/organizations/${organizationId}/projects?limit=1`)
      .expect(200);
    expect(data.organizationProjects).toEqual({
      items: body.projects,
      page: body.page,
    });
    expect(data.organizationProjects.items[0].id).toBe(projectId);
  });

  it('reglas → evaluar → exportar por GraphQL deja lo mismo que REST', async () => {
    const { rest, ok } = client();
    const snapshotId = await insertReadySnapshot(pool, projectId, CATALOG);

    const { createRuleset } = await ok(CREATE_RULESET, {
      projectId,
      input: rulesetInput(),
    });
    const { body: saved } = await rest()
      .get(`${projectPath()}/rulesets/1`)
      .expect(200);
    expect(createRuleset).toEqual(saved.ruleset);
    // Las mismas reglas guardadas por REST quedan igual que las de GraphQL.
    const { body: byRest } = await rest()
      .post(`${projectPath()}/rulesets`)
      .send(rulesetBody())
      .expect(201);
    expect(byRest.ruleset.mapping).toEqual(createRuleset.mapping);
    expect(byRest.ruleset.rules).toEqual(createRuleset.rules);

    const { requestEvaluation } = await ok(REQUEST_EVALUATION, {
      projectId,
      input: { snapshotId, rulesetRevision: 1 },
    });
    expect(requestEvaluation).toMatchObject({
      status: 'queued',
      snapshotId,
      rulesetRevision: 1,
      counts: null,
    });
    await app.get(EvaluationWorker).runUntilIdle();

    const evaluationId = requestEvaluation.id as string;
    const { evaluation } = await ok(EVALUATION_ROWS, {
      projectId,
      id: evaluationId,
      limit: 50,
    });
    const { body: restRows } = await rest()
      .get(`${projectPath()}/evaluations/${evaluationId}/rows?limit=50`)
      .expect(200);
    expect(evaluation.status).toBe('succeeded');
    expect(evaluation.counts).toEqual({
      total: 5,
      valid: 2,
      invalid: 1,
      excluded: 2,
    });
    expect(evaluation.rows).toEqual({
      items: restRows.rows,
      page: restRows.page,
    });

    const invalid = await ok(EVALUATION_ROWS, {
      projectId,
      id: evaluationId,
      outcome: 'invalid',
    });
    const { body: restInvalid } = await rest()
      .get(`${projectPath()}/evaluations/${evaluationId}/rows?outcome=invalid`)
      .expect(200);
    expect(invalid.evaluation.rows.items).toEqual(restInvalid.rows);
    expect(
      invalid.evaluation.rows.items.map(
        (row: { externalId: string }) => row.externalId,
      ),
    ).toEqual(['SKU-2']);

    const { approveExport } = await ok(APPROVE_EXPORT, {
      projectId,
      input: approvalOf(evaluation),
    });
    expect(approveExport.created).toBe(true);
    const exportId = approveExport.export.id as string;
    expect(approveExport.downloadUrl).toBe(
      `/api/v1/projects/${projectId}/exports/${exportId}/productos.tsv`,
    );
    const { body: restExport } = await rest()
      .get(`${projectPath()}/exports/${exportId}`)
      .expect(200);
    expect(approveExport.export).toEqual(restExport.export);

    // Aprobar otra vez la misma evaluación devuelve la que ya había, como REST (200).
    const again = await ok(APPROVE_EXPORT, {
      projectId,
      input: approvalOf(evaluation),
    });
    expect(again.approveExport).toMatchObject({
      created: false,
      export: { id: exportId },
    });

    const view = await ok(EXPORT_VIEW, {
      projectId,
      id: exportId,
      productId: 'SKU-1',
    });
    const { body: restProducts } = await rest()
      .get(`${projectPath()}/exports/${exportId}/products?limit=2`)
      .expect(200);
    const { body: restProduct } = await rest()
      .get(`${projectPath()}/exports/${exportId}/product?id=SKU-1`)
      .expect(200);
    expect(view.export.products).toEqual(restProducts);
    expect(view.export.product).toEqual({
      columns: restProduct.columns,
      product: restProduct.product,
      source: {
        kind: 'export',
        export: {
          id: exportId,
          rowCount: restExport.export.rowCount,
          products: { rowCount: restProducts.rowCount },
        },
      },
    });

    const searched = await ok(EXPORT_VIEW, {
      projectId,
      id: exportId,
      productId: 'SKU-1',
      search: 'silla',
    });
    expect(
      searched.export.products.products.map(
        (p: { values: { id: string } }) => p.values.id,
      ),
    ).toEqual(['SKU-4']);
  });

  it('rulesPreview da lo mismo que POST …/evaluations/preview', async () => {
    const { rest, ok } = client();
    await rest()
      .post(`${projectPath()}/rulesets`)
      .send(rulesetBody())
      .expect(201);
    const snapshotId = await insertReadySnapshot(pool, projectId, CATALOG);
    // Propuesta: sin la regla que excluye por marca vacía.
    const proposed = rulesetInput();
    proposed.rules = proposed.rules.slice(0, 3);

    const data = await ok(RULES_PREVIEW, {
      projectId,
      input: { ...proposed, snapshotId },
      limit: 10,
    });

    const body = { ...rulesetBody(), snapshotId };
    body.rules = body.rules.slice(0, 3);
    const { body: restPreview } = await rest()
      .post(`${projectPath()}/evaluations/preview?limit=10`)
      .send(body)
      .expect(200);
    expect(data.rulesPreview).toEqual(restPreview.preview);
    expect(data.rulesPreview.changedProducts).toBeGreaterThan(0);

    // Con otra revisión guardada, `baseRevision` elige con cuál se compara.
    await rest()
      .post(`${projectPath()}/rulesets`)
      .send({ ...rulesetBody(), rules: [] })
      .expect(201);
    const againstFirst = await ok(RULES_PREVIEW, {
      projectId,
      input: { ...proposed, snapshotId, baseRevision: 1 },
      limit: 10,
    });
    const { body: restAgainstFirst } = await rest()
      .post(`${projectPath()}/evaluations/preview?limit=10`)
      .send({ ...body, baseRevision: 1 })
      .expect(200);
    expect(againstFirst.rulesPreview).toEqual(restAgainstFirst.preview);
    expect(againstFirst.rulesPreview.baseRevision).toBe(1);
    expect(againstFirst.rulesPreview).toEqual(data.rulesPreview);
  });

  describe('errores como en REST', () => {
    it('una regla inválida da los mismos campos que REST', async () => {
      const { rest, failure } = client();
      const input = rulesetInput();
      input.rules = [
        { cleanText: { attributes: ['color'] } },
        { buildTitle: { template: '' } },
      ] as typeof input.rules;

      const error = await failure(CREATE_RULESET, { projectId, input });

      const { body } = await rest()
        .post(`${projectPath()}/rulesets`)
        .send({
          mapping: input.mapping,
          rules: [
            { type: 'clean_text', attributes: ['color'] },
            { type: 'build_title', template: '' },
          ],
        })
        .expect(400);
      expect(error.extensions.code).toBe('VALIDATION_FAILED');
      expect(error.extensions.issues).toEqual(body.issues);
      expect(
        error.extensions.issues.map((issue: { field: string }) => issue.field),
      ).toEqual(
        expect.arrayContaining(['rules.0.attributes', 'rules.1.template']),
      );
    });

    it('rulesPreview valida las reglas y el catálogo como REST', async () => {
      const { rest, failure } = client();
      const input = {
        ...rulesetInput(),
        rules: [{ buildTitle: { template: '' } }],
        snapshotId: 'no-es-un-uuid',
      };

      const error = await failure(RULES_PREVIEW, { projectId, input });

      const { body } = await rest()
        .post(`${projectPath()}/evaluations/preview`)
        .send({
          mapping: input.mapping,
          rules: [{ type: 'build_title', template: '' }],
          snapshotId: 'no-es-un-uuid',
        })
        .expect(400);
      expect(error.extensions.code).toBe('VALIDATION_FAILED');
      expect(error.extensions.issues).toEqual(body.issues);
      expect(
        error.extensions.issues.map((issue: { field: string }) => issue.field),
      ).toEqual(expect.arrayContaining(['rules.0.template', 'snapshotId']));
    });

    it('@oneOf rechaza dos tipos en una regla, o ninguno, antes del resolver', async () => {
      const { failure, rest } = client();
      for (const rule of [
        {
          cleanText: { attributes: ['title'] },
          buildTitle: { template: '{title}' },
        },
        {},
      ]) {
        const input = { ...rulesetInput(), rules: [rule] };
        const error = await failure(CREATE_RULESET, { projectId, input });
        expect(error.extensions.code).toBe('BAD_REQUEST');
      }
      const { body } = await rest()
        .get(`${projectPath()}/rulesets`)
        .expect(200);
      expect(body.rulesets).toEqual([]);
    });

    it('lo incoherente entre mapeo y reglas también llega igual', async () => {
      const { rest, failure } = client();
      const input = {
        mapping: [{ attribute: 'title', column: 'Nombre' }],
        rules: [] as unknown[],
      };
      const error = await failure(CREATE_RULESET, { projectId, input });
      const { body } = await rest()
        .post(`${projectPath()}/rulesets`)
        .send(input)
        .expect(400);
      expect(error.extensions.code).toBe(body.code);
      expect(error.extensions.issues).toEqual(body.issues);
    });

    it('los filtros de filas se validan como en REST', async () => {
      const { rest, ok, failure } = client();
      await rest()
        .post(`${projectPath()}/rulesets`)
        .send(rulesetBody())
        .expect(201);
      const snapshotId = await insertReadySnapshot(pool, projectId, CATALOG);
      const evaluation = await evaluateByRest(snapshotId);

      const error = await failure(EVALUATION_ROWS, {
        projectId,
        id: evaluation.id,
        attribute: 'price',
      });
      const { body } = await rest()
        .get(
          `${projectPath()}/evaluations/${evaluation.id}/rows?attribute=price`,
        )
        .expect(400);
      expect(error.extensions.code).toBe('VALIDATION_FAILED');
      expect(error.extensions.issues).toEqual(body.issues);

      const byProblem = await ok(EVALUATION_ROWS, {
        projectId,
        id: evaluation.id,
        attribute: 'price',
        code: 'FIELD_MISSING',
      });
      const { body: restByProblem } = await rest()
        .get(
          `${projectPath()}/evaluations/${evaluation.id}/rows?attribute=price&code=FIELD_MISSING`,
        )
        .expect(200);
      expect(byProblem.evaluation.rows.items).toEqual(restByProblem.rows);
    });

    it('una revisión, una evaluación o una exportación que no existen dan 404', async () => {
      const { failure } = client();
      const ruleset = await failure(
        'query($p: ID!) { ruleset(projectId: $p, revision: 7) { id } }',
        { p: projectId },
      );
      expect(ruleset.extensions.code).toBe('RULESET_NOT_FOUND');
      const exported = await failure(
        'query($p: ID!, $id: ID!) { export(projectId: $p, id: $id) { id } }',
        { p: projectId, id: randomUUID() },
      );
      expect(exported.extensions.code).toBe('EXPORT_NOT_FOUND');
    });
  });

  describe('permisos como en REST', () => {
    it('otra organización ve 404 y sin sesión, 401', async () => {
      const { failure } = client();
      const foreign = await failure(SUMMARY, { id: projectId }, 'bob-session');
      expect(foreign.extensions.code).toBe('PROJECT_NOT_FOUND');
      const rules = await failure(
        CREATE_RULESET,
        { projectId, input: rulesetInput() },
        'bob-session',
      );
      expect(rules.extensions.code).toBe('PROJECT_NOT_FOUND');
      const mine = await failure(
        'query($o: ID!) { organizationProjects(organizationId: $o) { items { id } } }',
        { o: organizationId },
        'bob-session',
      );
      expect(mine.extensions.code).toBe('ORGANIZATION_NOT_FOUND');
      const anonymous = await failure(SUMMARY, { id: projectId }, '');
      expect(anonymous.extensions.code).toBe('AUTH_SESSION_REQUIRED');
      // Bob ve su propio proyecto.
      await client().ok(
        'query($id: ID!) { project(id: $id) { access { role } } }',
        { id: bobProjectId },
        'bob-session',
      );
    });

    it('un Viewer lee pero no crea reglas ni pide evaluaciones; un Editor no aprueba', async () => {
      const { rest, ok, failure } = client();
      await rest()
        .post(`${projectPath()}/rulesets`)
        .send(rulesetBody())
        .expect(201);
      const snapshotId = await insertReadySnapshot(pool, projectId, CATALOG);
      const evaluation = await evaluateByRest(snapshotId);

      await setRole(pool, organizationId, bobId, 'viewer');
      const read = await ok(SUMMARY, { id: projectId }, 'bob-session');
      expect(read.project.access.role).toBe('viewer');
      expect(read.project.rulesets.items).toHaveLength(1);

      const rules = await failure(
        CREATE_RULESET,
        { projectId, input: rulesetInput() },
        'bob-session',
      );
      const restRules = await rest('bob-session')
        .post(`${projectPath()}/rulesets`)
        .send(rulesetBody());
      expect(rules.extensions.code).toBe(restRules.body.code);
      expect(restRules.status).toBe(403);

      const requested = await failure(
        REQUEST_EVALUATION,
        { projectId, input: { snapshotId, rulesetRevision: 1 } },
        'bob-session',
      );
      const restRequested = await rest('bob-session')
        .post(`${projectPath()}/evaluations`)
        .send({ snapshotId, rulesetRevision: 1 });
      expect(requested.extensions.code).toBe(restRequested.body.code);
      expect(restRequested.status).toBe(403);

      await setRole(pool, organizationId, bobId, 'editor');
      const approved = await failure(
        APPROVE_EXPORT,
        { projectId, input: approvalOf(evaluation) },
        'bob-session',
      );
      expect(approved.extensions.code).toBe('FORBIDDEN');
      const preview = await ok(
        RULES_PREVIEW,
        { projectId, input: { ...rulesetInput(), snapshotId } },
        'bob-session',
      );
      expect(preview.rulesPreview.baseRevision).toBe(1);
    });
  });
});
