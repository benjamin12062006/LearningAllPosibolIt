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
import request from 'supertest';
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
const VERSION =
  'id exportId evaluationId rowCount byteSize tsvChecksum publishedBy publishedAt';
const FEED_FIELDS = `
  id generation deliveryEnabled createdAt updatedAt
  publishedVersion { ${VERSION} }
  source { url idColumn delimiter }
  policy { rulesetRevision maxInvalid maxExcluded maxDropPercent engineVersion profileVersion approvedAt }
  schedule { enabled refreshTime timeZone }
  lastRefresh { id status stage outcome scheduledFor createdAt finishedAt }`;

const CREATE_FEED = `
  mutation Create($projectId: ID!) {
    createFeed(projectId: $projectId) { deliveryUrl feed { ${FEED_FIELDS} } }
  }`;
const FEED = `
  query Feed($projectId: ID!, $id: ID!) { feed(projectId: $projectId, id: $id) { ${FEED_FIELDS} } }`;
const SET_SOURCE = `
  mutation Source($projectId: ID!, $feedId: ID!, $input: FeedSourceInput!) {
    setFeedSource(projectId: $projectId, feedId: $feedId, input: $input) { ${FEED_FIELDS} }
  }`;
const SET_SCHEDULE = `
  mutation Schedule($projectId: ID!, $feedId: ID!, $input: FeedScheduleInput!) {
    setFeedSchedule(projectId: $projectId, feedId: $feedId, input: $input) { ${FEED_FIELDS} }
  }`;
const APPROVE_POLICY = `
  mutation Policy($projectId: ID!, $feedId: ID!, $input: FeedPolicyInput!) {
    approveFeedPolicy(projectId: $projectId, feedId: $feedId, input: $input) { ${FEED_FIELDS} }
  }`;
const PUBLISH = `
  mutation Publish($projectId: ID!, $feedId: ID!, $input: PublishFeedInput!) {
    publishFeed(projectId: $projectId, feedId: $feedId, input: $input) {
      published feed { ${FEED_FIELDS} }
    }
  }`;
const VERSIONS = `
  query Versions($projectId: ID!, $id: ID!, $productId: String!) {
    feed(projectId: $projectId, id: $id) {
      versions(limit: 5) {
        items {
          ${VERSION} current fileRetained
          products(limit: 2) { columns products { line values } ${PAGE} rowCount }
          product(id: $productId) { columns product { line values } source { kind feedId version { id current } } }
        }
        ${PAGE}
      }
    }
  }`;
const REFRESH_FIELDS =
  'id feedId status stage attempts outcome snapshotId evaluationId runAfter scheduledFor createdAt finishedAt';
const REQUEST_REFRESH = `
  mutation Refresh($projectId: ID!, $feedId: ID!) {
    requestFeedRefresh(projectId: $projectId, feedId: $feedId) { ${REFRESH_FIELDS} }
  }`;
const FEED_REFRESH = `
  query Refresh($projectId: ID!, $feedId: ID!, $id: ID!) {
    feedRefresh(projectId: $projectId, feedId: $feedId, id: $id) { ${REFRESH_FIELDS} }
  }`;
const REINDEX = `
  mutation Reindex($projectId: ID!) { reindexKnowledge(projectId: $projectId) { status } }`;

const SOURCE = {
  url: 'https://proveedor.example/catalogo.csv',
  idColumn: 'SKU',
  delimiter: 'semicolon',
};
const SCHEDULE = {
  enabled: true,
  refreshTime: '06:30',
  timeZone: 'Europe/Madrid',
};
const POLICY = {
  rulesetRevision: 1,
  maxInvalid: 10,
  maxExcluded: 10,
  maxDropPercent: 20,
};

/**
 * C7.3: feeds y conocimiento por GraphQL. Publicar por GraphQL tiene que dejar
 * el mismo feed que REST y la URL pública tiene que servir el TSV aprobado.
 */
describe('GraphQL C7.3: feeds y conocimiento', () => {
  let app: INestApplication;
  let pool: Pool;
  let close: () => Promise<void>;
  let projectId: string;
  let organizationId: string;
  let bobId: string;

  const client = () => clientsFor(app);
  const projectPath = () => `/api/v1/projects/${projectId}`;
  const feedPath = (feedId: string) => `${projectPath()}/feeds/${feedId}`;

  /** Evalúa y exporta un catálogo por REST; devuelve la exportación. */
  async function exportCatalog(skus: string[]) {
    const { rest } = client();
    const snapshotId = await insertReadySnapshot(
      pool,
      projectId,
      skus.map((sku) => catalogValues(sku)),
    );
    const { body: accepted } = await rest()
      .post(`${projectPath()}/evaluations`)
      .send({ snapshotId, rulesetRevision: 1 })
      .expect(202);
    await app.get(EvaluationWorker).runUntilIdle();
    const { body } = await rest().get(accepted.statusUrl).expect(200);
    const { evaluation } = body;
    const { body: created } = await rest()
      .post(`${projectPath()}/exports`)
      .send({
        evaluationId: evaluation.id,
        resultChecksum: evaluation.resultChecksum,
        acceptedInvalidCount: evaluation.counts.invalid,
        acceptedExcludedCount: evaluation.counts.excluded,
      })
      .expect(201);
    return created.export as { id: string; rowCount: number };
  }

  async function createdFeed() {
    const { createFeed } = await client().ok(CREATE_FEED, { projectId });
    return createFeed as { deliveryUrl: string; feed: Record<string, any> };
  }

  beforeAll(async () => {
    ({ app, pool, close } = await startGraphqlApp());
  });
  beforeEach(async () => {
    ({ projectId, organizationId, bobId } = await seedTwoOrganizations(
      app,
      pool,
    ));
    await client()
      .rest()
      .post(`${projectPath()}/rulesets`)
      .send(rulesetBody())
      .expect(201);
  });
  afterAll(async () => {
    await close?.();
  });

  it('crear, configurar y publicar por GraphQL deja el feed como REST y la URL pública entrega el TSV', async () => {
    const { rest, ok } = client();
    const { feed, deliveryUrl } = await createdFeed();
    expect(deliveryUrl).toMatch(/^\/feeds\/[A-Za-z0-9_-]{43}\.tsv$/);
    expect(feed).toMatchObject({
      generation: 0,
      publishedVersion: null,
      source: null,
    });
    const variables = { projectId, feedId: feed.id };

    const source = (await ok(SET_SOURCE, { ...variables, input: SOURCE }))
      .setFeedSource;
    expect(source.source).toEqual(SOURCE);
    const schedule = (await ok(SET_SCHEDULE, { ...variables, input: SCHEDULE }))
      .setFeedSchedule;
    expect(schedule.schedule).toEqual(SCHEDULE);
    const policy = (await ok(APPROVE_POLICY, { ...variables, input: POLICY }))
      .approveFeedPolicy;
    expect(policy.policy).toMatchObject(POLICY);

    const exported = await exportCatalog(['SKU-1', 'SKU-2', 'SKU-3']);
    const { publishFeed } = await ok(PUBLISH, {
      ...variables,
      input: { exportId: exported.id, expectedGeneration: 0 },
    });
    expect(publishFeed.published).toBe(true);
    expect(publishFeed.feed.generation).toBe(1);
    expect(publishFeed.feed.publishedVersion).toMatchObject({
      exportId: exported.id,
      rowCount: 3,
      publishedBy: 'operator',
    });

    // El feed que deja GraphQL es el que lee REST.
    const { body: restFeed } = await rest().get(feedPath(feed.id)).expect(200);
    const { feed: graphqlFeed } = await ok(FEED, { projectId, id: feed.id });
    expect(graphqlFeed).toEqual(restFeed.feed);
    expect(publishFeed.feed).toEqual(restFeed.feed);

    // Publicar otra vez lo mismo no crea otra versión (200 en REST).
    const again = await ok(PUBLISH, {
      ...variables,
      input: { exportId: exported.id, expectedGeneration: 1 },
    });
    expect(again.publishFeed).toMatchObject({
      published: false,
      feed: { generation: 1 },
    });

    // La URL pública sirve, sin sesión, el mismo TSV que se aprobó.
    const served = await request(app.getHttpServer())
      .get(deliveryUrl)
      .responseType('blob')
      .expect(200);
    const approved = await rest()
      .get(`${projectPath()}/exports/${exported.id}/productos.tsv`)
      .responseType('blob')
      .expect(200);
    expect(Buffer.compare(served.body as Buffer, approved.body as Buffer)).toBe(
      0,
    );
  });

  it('el historial y el visor de una versión dan lo mismo que REST', async () => {
    const { rest, ok } = client();
    const { feed } = await createdFeed();
    const first = await exportCatalog(['SKU-1', 'SKU-2', 'SKU-3']);
    const second = await exportCatalog(['SKU-1', 'SKU-4']);
    const variables = { projectId, feedId: feed.id };
    await ok(PUBLISH, {
      ...variables,
      input: { exportId: first.id, expectedGeneration: 0 },
    });
    await ok(PUBLISH, {
      ...variables,
      input: { exportId: second.id, expectedGeneration: 1 },
    });

    const data = await ok(VERSIONS, {
      projectId,
      id: feed.id,
      productId: 'SKU-1',
    });

    const { body: versions } = await rest()
      .get(`${feedPath(feed.id)}/versions?limit=5`)
      .expect(200);
    const items = data.feed.versions.items as Record<string, any>[];
    expect(data.feed.versions.page).toEqual(versions.page);
    expect(items.map(({ products, product, ...version }) => version)).toEqual(
      versions.versions,
    );
    expect(items.map((version) => version.current)).toEqual([true, false]);

    for (const version of items) {
      const base = `${feedPath(feed.id)}/versions/${version.id}`;
      const { body: products } = await rest()
        .get(`${base}/products?limit=2`)
        .expect(200);
      const { body: product } = await rest()
        .get(`${base}/product?id=SKU-1`)
        .expect(200);
      expect(version.products).toEqual(products);
      expect(version.product).toEqual({
        columns: product.columns,
        product: product.product,
        source: {
          kind: 'feed_version',
          feedId: feed.id,
          version: { id: version.id, current: version.current },
        },
      });
    }
    expect(items[1].products.rowCount).toBe(3);
  });

  it('pedir una actualización la deja en cola y se sigue con feedRefresh, como REST', async () => {
    const { rest, ok, failure } = client();
    const { feed } = await createdFeed();
    const variables = { projectId, feedId: feed.id };
    await ok(SET_SOURCE, { ...variables, input: SOURCE });

    // Sin política aprobada, el mismo 409 que REST.
    const blocked = await failure(REQUEST_REFRESH, variables);
    const { body: restBlocked } = await rest()
      .post(`${feedPath(feed.id)}/refreshes`)
      .expect(409);
    expect(blocked.extensions.code).toBe(restBlocked.code);

    await ok(APPROVE_POLICY, { ...variables, input: POLICY });
    const { requestFeedRefresh } = await ok(REQUEST_REFRESH, variables);
    expect(requestFeedRefresh).toMatchObject({
      feedId: feed.id,
      status: 'queued',
      stage: 'fetch',
      outcome: null,
    });

    const { feedRefresh } = await ok(FEED_REFRESH, {
      ...variables,
      id: requestFeedRefresh.id,
    });
    const { body: restRefresh } = await rest()
      .get(`${feedPath(feed.id)}/refreshes/${requestFeedRefresh.id}`)
      .expect(200);
    const { error: _error, ...withoutError } = restRefresh.refresh;
    expect(feedRefresh).toEqual(withoutError);
    expect(requestFeedRefresh).toEqual(feedRefresh);

    const { feed: withLast } = await ok(FEED, { projectId, id: feed.id });
    expect(withLast.lastRefresh).toMatchObject({
      id: requestFeedRefresh.id,
      status: 'queued',
    });

    const twice = await failure(REQUEST_REFRESH, variables);
    expect(twice.extensions.code).toBe('FEED_REFRESH_ALREADY_ACTIVE');
    const missing = await failure(FEED_REFRESH, {
      ...variables,
      id: randomUUID(),
    });
    expect(missing.extensions.code).toBe('FEED_REFRESH_NOT_FOUND');
  });

  describe('errores como en REST', () => {
    it('fuente, horario y política inválidos dan los mismos campos que REST', async () => {
      const { rest, failure } = client();
      const { feed } = await createdFeed();
      const variables = { projectId, feedId: feed.id };
      const cases = [
        [
          SET_SOURCE,
          'source',
          {
            url: 'http://inseguro.example/a.csv',
            idColumn: ' ',
            delimiter: 'tab',
          },
        ],
        [
          SET_SCHEDULE,
          'schedule',
          { enabled: true, refreshTime: '25:00', timeZone: 'Marte/Olimpo' },
        ],
        [
          APPROVE_POLICY,
          'policy',
          {
            rulesetRevision: 0,
            maxInvalid: -1,
            maxExcluded: 0,
            maxDropPercent: 101,
          },
        ],
      ] as const;

      for (const [mutation, route, input] of cases) {
        const error = await failure(mutation, { ...variables, input });
        const { body } = await rest()
          .put(`${feedPath(feed.id)}/${route}`)
          .send(input)
          .expect(400);
        expect(error.extensions.code).toBe('VALIDATION_FAILED');
        expect(error.extensions.issues).toEqual(body.issues);
        expect(error.extensions.issues.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('una política con una revisión que no existe y una publicación con la generación vieja', async () => {
      const { rest, failure, ok } = client();
      const { feed } = await createdFeed();
      const variables = { projectId, feedId: feed.id };

      const policy = await failure(APPROVE_POLICY, {
        ...variables,
        input: { ...POLICY, rulesetRevision: 9 },
      });
      const { body: restPolicy } = await rest()
        .put(`${feedPath(feed.id)}/policy`)
        .send({ ...POLICY, rulesetRevision: 9 });
      expect(policy.extensions.code).toBe(restPolicy.code);
      expect(restPolicy.code).toBe('RULESET_NOT_FOUND');

      const exported = await exportCatalog(['SKU-1']);
      await ok(PUBLISH, {
        ...variables,
        input: { exportId: exported.id, expectedGeneration: 0 },
      });
      const other = await exportCatalog(['SKU-2']);
      const stale = await failure(PUBLISH, {
        ...variables,
        input: { exportId: other.id, expectedGeneration: 0 },
      });
      const { body: restStale } = await rest()
        .post(`${feedPath(feed.id)}/publications`)
        .send({ exportId: other.id, expectedGeneration: 0 })
        .expect(409);
      expect(stale.extensions.code).toBe(restStale.code);
    });

    it('reindexar sin servicio de IA da el mismo error que REST', async () => {
      const { rest, failure } = client();
      const error = await failure(REINDEX, { projectId });
      const { body } = await rest().post(`${projectPath()}/knowledge/reindex`);
      expect(error.extensions.code).toBe(body.code);
      expect(body.code).toBe('KNOWLEDGE_DISABLED');
    });
  });

  describe('permisos como en REST', () => {
    it('un Editor lee el feed pero no lo crea, configura ni publica; otra organización ve 404', async () => {
      const { rest, ok, failure } = client();
      const { feed } = await createdFeed();
      const exported = await exportCatalog(['SKU-1']);
      const variables = { projectId, feedId: feed.id };

      const foreign = await failure(
        FEED,
        { projectId, id: feed.id },
        'bob-session',
      );
      expect(foreign.extensions.code).toBe('PROJECT_NOT_FOUND');

      await setRole(pool, organizationId, bobId, 'editor');
      const read = await ok(FEED, { projectId, id: feed.id }, 'bob-session');
      expect(read.feed.id).toBe(feed.id);

      const denied = [
        await failure(CREATE_FEED, { projectId }, 'bob-session'),
        await failure(
          SET_SOURCE,
          { ...variables, input: SOURCE },
          'bob-session',
        ),
        await failure(
          SET_SCHEDULE,
          { ...variables, input: SCHEDULE },
          'bob-session',
        ),
        await failure(
          APPROVE_POLICY,
          { ...variables, input: POLICY },
          'bob-session',
        ),
        await failure(
          PUBLISH,
          {
            ...variables,
            input: { exportId: exported.id, expectedGeneration: 0 },
          },
          'bob-session',
        ),
        await failure(REINDEX, { projectId }, 'bob-session'),
      ];
      expect(denied.map((error) => error.extensions.code)).toEqual(
        Array(denied.length).fill('FORBIDDEN'),
      );
      const { body: restDenied } = await rest('bob-session')
        .put(`${feedPath(feed.id)}/source`)
        .send(SOURCE)
        .expect(403);
      expect(restDenied.code).toBe('FORBIDDEN');

      const anonymous = await failure(FEED, { projectId, id: feed.id }, '');
      expect(anonymous.extensions.code).toBe('AUTH_SESSION_REQUIRED');
    });
  });
});
