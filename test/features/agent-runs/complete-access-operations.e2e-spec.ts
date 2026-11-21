import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import { HttpException, type INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import request from 'supertest';
import { AI_AUTO_CONFIRM } from '../../../src/agent-runs/auto-confirm.js';
import { apiError } from '../../../src/common/http/api-error.js';
import { EvaluationWorker } from '../../../src/evaluations/evaluations.worker.js';
import { IntegrationsModule } from '../../../src/integrations/integrations.module.js';
import {
  AGENT_RUN_DEFAULTS,
  AGENT_RUN_OPTIONS,
} from '../../../src/agent-runs/agent-runs.types.js';
import type { OperationContext } from '../../../src/agent-runs/operations/agent-operation.js';
import {
  AgentOperationCatalog,
  FORBIDDEN_OPERATIONS,
} from '../../../src/agent-runs/operations/agent-operation-catalog.js';
import {
  KNOWLEDGE_DEFAULTS,
  KNOWLEDGE_OPTIONS,
} from '../../../src/knowledge/knowledge.types.js';
import {
  CATALOG_RULESET,
  catalogValues,
  insertReadySnapshot,
} from '../evaluations/support/snapshot-fixtures.js';
import {
  clientsFor,
  seedTwoOrganizations,
  setRole,
  startGraphqlApp,
} from '../graphql/support/graphql-test-app.js';
import { alice, bob } from '../support/project-fixtures.js';
import {
  columnIdsOf,
  FIXTURE_COLUMNS,
  ROW_IDS,
  seedTwoRevisions,
  type FixtureColumnIds,
} from '../worksheets/support/row-fixtures.js';

const NO_CONTEXT = {
  workbookId: null,
  worksheetId: null,
  revisionId: null,
  selectionId: null,
};

/** Plan 10 de ai-assistant, D8: lo que faltaba para que la IA haga lo de la web. */
const NEW_OPERATIONS = [
  'submit_changeset',
  'reopen_changeset',
  'reject_changeset',
  'rebase_changeset',
  'propose_revert',
  'duplicate_worksheet',
  'open_catalog_as_worksheet',
  'export_worksheet',
  'list_saved_views',
  'update_saved_view',
  'list_import_mappings',
  'create_import_mapping',
  'delete_import_mapping',
  'list_catalog_imports',
  'delete_catalog_import',
  'set_feed_source',
  'set_feed_schedule',
  'approve_feed_policy',
];

describe.each(['agente', 'CLI'])(
  'E5: Hojas, Catálogo y Feed desde %s',
  (channel) => {
    const external = channel === 'CLI';
    let app: INestApplication;
    let pool: Pool;
    let close: () => Promise<void>;
    let organizationId: string;
    let projectId: string;
    let aliceId: string;
    let bobProjectId: string;
    let cliToken: string;
    let lastProposalId: string;
    let bobId: string;
    let workbookId: string;
    let worksheetId: string;
    let col: FixtureColumnIds;

    const rest = (session?: string) => clientsFor(app).rest(session);
    const base = () =>
      `/api/v1/organizations/${organizationId}/projects/${projectId}`;

    const cliBase = '/api/v1/integrations';
    const cliGet = (path: string, token = cliToken) =>
      request(app.getHttpServer())
        .get(`${cliBase}${path}`)
        .auth(token, { type: 'bearer' });
    const cliCall = (
      name: string,
      args: Record<string, unknown>,
      mode: 'execute' | 'prepare',
      token = cliToken,
      callId = randomUUID(),
    ) =>
      request(app.getHttpServer())
        .post(`${cliBase}/operations/${name}`)
        .auth(token, { type: 'bearer' })
        .send({ arguments: args, mode, callId });

    async function issueCli(path: string, session?: string, prepare = true) {
      const { body } = await rest(session)
        .post(`${path}/integrations/credentials`)
        .set('Idempotency-Key', randomUUID())
        .send({
          label: 'Terminal de pruebas',
          audience: 'cli',
          capabilities: prepare ? ['read', 'prepare'] : ['read'],
        })
        .expect(201);
      return body as { token: string; credential: { id: string } };
    }

    async function confirmInWeb(proposalId: string) {
      const path = `${base()}/integrations/proposals/${proposalId}`;
      const { body: preview } = await rest().get(path).expect(200);
      expect(preview.proposal.status).toBe('ready');
      const { body } = await rest()
        .post(`${path}/confirm`)
        .send({ proposalHash: preview.proposal.hash })
        .expect(200);
      return body.proposal;
    }

    function as(identity: typeof alice, actorId: string): OperationContext {
      return {
        identity,
        actorId,
        scope: { organizationId, projectId },
        context: { ...NO_CONTEXT, workbookId, worksheetId },
      };
    }

    function operation(name: string) {
      const found = app.get(AgentOperationCatalog).find(name);
      if (!found) throw new Error(`${name} no está en el catálogo`);
      return found;
    }

    async function read(
      name: string,
      input: Record<string, unknown> = {},
    ): Promise<any> {
      if (external)
        return (await cliCall(name, input, 'execute').expect(200)).body;
      const found = operation(name);
      if (found.level !== 'read') throw new Error(`${name} no es una lectura`);
      return found.execute(as(alice, aliceId), await found.parse(input));
    }

    /** Prepara y confirma, como la persona en la web. */
    async function write(
      name: string,
      input: Record<string, unknown> = {},
      context = as(alice, aliceId),
    ): Promise<any> {
      if (external) {
        let token = cliToken;
        if (context.actorId === bobId) {
          const { rows } = await pool.query(
            'SELECT organization_id FROM estadistica_forms.projects WHERE id = $1',
            [bobProjectId],
          );
          ({ token } = await issueCli(
            `/api/v1/organizations/${rows[0].organization_id}/projects/${bobProjectId}`,
            'bob-session',
          ));
        }
        const prepared = await cliCall(name, input, 'prepare', token);
        if (prepared.status !== 200)
          throw new HttpException(prepared.body, prepared.status);
        lastProposalId = prepared.body.proposalId;
        const status = await cliGet(`/proposals/${lastProposalId}`).expect(200);
        expect(status.body.proposal.status).toBe('ready');
        const confirmed = await confirmInWeb(lastProposalId);
        if (confirmed.status === 'failed') throw apiError(confirmed.error.code);
        expect(confirmed.status).toBe('confirmed');
        return confirmed.result;
      }
      const found = operation(name);
      if (found.level !== 'write') throw new Error(`${name} no es escritura`);
      const prepared = await found.prepare(context, await found.parse(input));
      return found.confirm(context, prepared.plan, randomUUID());
    }

    async function failureOf(work: () => Promise<unknown>) {
      try {
        await work();
      } catch (error) {
        if (error instanceof HttpException) {
          const body = error.getResponse() as { code?: string };
          return { status: error.getStatus(), code: body.code };
        }
        throw error;
      }
      throw new Error('No falló');
    }

    /** Un borrador con un precio nuevo para una fila. */
    function priceDraft(rowId: string, value: string) {
      return write('prepare_sheet_edits', {
        worksheetId,
        explanation: `Precio ${value}`,
        operations: [{ type: 'set_cell', rowId, columnId: col.price, value }],
      });
    }

    beforeAll(async () => {
      ({ app, pool, close } = await startGraphqlApp(
        external ? [IntegrationsModule] : [],
        (builder) =>
          builder
            .overrideProvider(AI_AUTO_CONFIRM)
            .useValue(true)
            .overrideProvider(KNOWLEDGE_OPTIONS)
            .useValue({ ...KNOWLEDGE_DEFAULTS, autoStart: false })
            .overrideProvider(AGENT_RUN_OPTIONS)
            .useValue({ ...AGENT_RUN_DEFAULTS, autoStart: false }),
      ));
    });

    beforeEach(async () => {
      ({ organizationId, projectId, aliceId, bobId, bobProjectId } =
        await seedTwoOrganizations(app, pool));
      const { body: workbook } = await rest()
        .post(`${base()}/workbooks`)
        .send({ name: 'Operaciones' })
        .expect(201);
      workbookId = workbook.workbook.id;
      const { body } = await rest()
        .post(`${base()}/workbooks/${workbookId}/worksheets`)
        .send({ name: 'Precios', columns: FIXTURE_COLUMNS })
        .expect(201);
      worksheetId = body.worksheet.id;
      col = columnIdsOf(body.worksheet);
      await seedTwoRevisions(pool, body.worksheet, organizationId, aliceId);
      if (external) ({ token: cliToken } = await issueCli(base()));
    });

    afterAll(async () => {
      await close?.();
    });

    it('el catálogo ofrece las nuevas, con el permiso de su ruta y ninguna prohibida', async () => {
      const catalog = app.get(AgentOperationCatalog);
      const names = external
        ? (await cliGet('/operations').expect(200)).body.operations.map(
            (item: { name: string }) => item.name,
          )
        : catalog.all().map((found) => found.name);
      if (external) {
        const session = await cliGet('/session').expect(200);
        expect(session.body).toMatchObject({
          projectId,
          organizationId,
          audience: 'cli',
        });
        const { body } = await cliCall(
          'get_project_overview',
          {},
          'execute',
        ).expect(200);
        expect(body.project.id).toBe(projectId);
        expect(
          catalog
            .all(true)
            .every((operation) => names.includes(operation.name)),
        ).toBe(true);
        await cliCall(
          'duplicate_worksheet',
          { name: 'Sin ID' },
          'prepare',
        ).expect(400);
        await cliCall('list_saved_views', {}, 'execute').expect(400);
        const viewer = await issueCli(base(), undefined, false);
        const scoped = await cliGet('/operations', viewer.token).expect(200);
        expect(
          scoped.body.operations.every(
            (item: { level: string }) => item.level === 'read',
          ),
        ).toBe(true);
        await cliCall(
          'refresh_feed',
          { feedId: randomUUID() },
          'prepare',
          viewer.token,
        ).expect(403);
      }
      expect(names).toEqual(expect.arrayContaining(NEW_OPERATIONS));
      expect(
        names.filter((name: string) =>
          FORBIDDEN_OPERATIONS.includes(name as never),
        ),
      ).toEqual([]);

      await setRole(pool, organizationId, bobId, 'viewer');
      const forViewer = (await catalog.describeFor(bob, projectId)).map(
        (found) => found.name,
      );
      expect(forViewer).toEqual(
        expect.arrayContaining([
          'list_saved_views',
          'list_import_mappings',
          'list_catalog_imports',
          'export_worksheet',
        ]),
      );
      expect(forViewer).not.toContain('duplicate_worksheet');
      expect(forViewer).not.toContain('delete_catalog_import');

      await setRole(pool, organizationId, bobId, 'editor');
      const forEditor = (await catalog.describeFor(bob, projectId)).map(
        (found) => found.name,
      );
      expect(forEditor).toEqual(
        expect.arrayContaining(['submit_changeset', 'rebase_changeset']),
      );
      // Aprobar o rechazar y tocar el feed es de quien aprueba.
      expect(forEditor).not.toContain('reject_changeset');
      expect(forEditor).not.toContain('set_feed_schedule');
    });

    it('el ciclo de revisión: enviar, rechazar, reabrir, aplicar y proponer deshacer', async () => {
      const draft = await priceDraft(ROW_IDS.a, '11.00');

      const submitted = await write('submit_changeset', {
        changesetId: draft.changesetId,
      });
      expect(submitted.status).toBe('pending_review');
      const rejected = await write('reject_changeset', {
        changesetId: draft.changesetId,
        reason: 'Falta revisar el redondeo',
      });
      expect(rejected.status).toBe('rejected');
      const reopened = await write('reopen_changeset', {
        changesetId: draft.changesetId,
      });
      expect(reopened.status).toBe('draft');
      expect(
        await failureOf(() =>
          write('reject_changeset', { changesetId: draft.changesetId }),
        ),
      ).toEqual({ status: 409, code: 'CHANGESET_STATE_INVALID' });

      const applied = await write('apply_changeset', {
        changesetId: draft.changesetId,
      });
      const revert = await write('propose_revert', {
        revisionId: applied.revisionId,
      });
      const opened = await read('open_changeset', {
        changesetId: revert.changesetId,
      });
      expect(opened.changeset).toMatchObject({
        status: 'draft',
        source: 'revert',
        worksheetId,
      });
    });

    it('un borrador que se quedó atrás se pone al día con rebase_changeset y ya se aplica', async () => {
      const first = await priceDraft(ROW_IDS.a, '11.00');
      const behind = await priceDraft(ROW_IDS.b, '13.00');
      const firstApplied = await write('apply_changeset', {
        changesetId: first.changesetId,
      });

      const outdated = await failureOf(() =>
        write('apply_changeset', { changesetId: behind.changesetId }),
      );
      expect(outdated).toMatchObject({ status: 409 });
      expect(['CHANGESET_BASE_OUTDATED', 'WORKSHEET_HEAD_CHANGED']).toContain(
        outdated.code,
      );

      const rebased = await write('rebase_changeset', {
        changesetId: behind.changesetId,
        resolutions: [],
      });
      expect(rebased.baseRevisionId).toBe(firstApplied.revisionId);
      const applied = await write('apply_changeset', {
        changesetId: behind.changesetId,
      });
      expect(applied.sequence).toBe(4);
    });

    it('duplica y exporta una hoja, y gestiona sus vistas y plantillas de mapeo', async () => {
      const copy = await write('duplicate_worksheet', {
        worksheetId,
        name: 'Precios copia',
      });
      expect(copy).toMatchObject({ workbookId, name: 'Precios copia' });
      expect(
        (await read('get_sheet_schema', { worksheetId: copy.worksheetId }))
          .name,
      ).toBe('Precios copia');

      const exported = await write('export_worksheet', {
        worksheetId,
        format: 'csv',
      });
      if (external) {
        const file = await cliGet(`/proposals/${lastProposalId}/file`).expect(
          200,
        );
        expect(file.text).toContain('Precio');
        const other = await issueCli(base());
        await cliGet(`/proposals/${lastProposalId}/file`, other.token).expect(
          404,
        );
      }
      expect(exported.downloadUrl).toContain(exported.exportId);
      const exportsPage = await read('list_sheet_history', {
        worksheetId,
        kind: 'exports',
      });
      expect(JSON.stringify(exportsPage)).toContain(exported.exportId);

      const view = await write('suggest_view', {
        worksheetId,
        name: 'Caros',
        visibility: 'team',
        query: { sort: [{ columnId: col.price, direction: 'desc' }] },
      });
      await write('update_saved_view', {
        viewId: view.savedViewId,
        name: 'Caros primero',
        query: { sort: [{ columnId: col.price, direction: 'desc' }] },
      });
      const views = await read('list_saved_views', { worksheetId });
      expect(views.items).toEqual([
        expect.objectContaining({
          id: view.savedViewId,
          name: 'Caros primero',
          visibility: 'team',
        }),
      ]);

      const mapping = await write('create_import_mapping', {
        worksheetId,
        name: 'Proveedor',
        mapping: {
          mode: 'append',
          columns: [{ header: 'Código', columnId: col.sku }],
        },
      });
      expect(
        (await read('list_import_mappings', { worksheetId })).items,
      ).toEqual([
        expect.objectContaining({ id: mapping.mappingId, name: 'Proveedor' }),
      ]);
      await write('delete_import_mapping', { mappingId: mapping.mappingId });
      expect(
        (await read('list_import_mappings', { worksheetId })).items,
      ).toEqual([]);
    });

    it('el catálogo: listar, abrir una importación como hoja y borrarla; lo ajeno es 404', async () => {
      const snapshotId = await insertReadySnapshot(pool, projectId, [
        catalogValues('A1'),
        catalogValues('A2'),
      ]);

      const listed = await read('list_catalog_imports');
      expect(listed.imports).toEqual([
        expect.objectContaining({ id: snapshotId, status: 'ready' }),
      ]);
      const opened = await write('open_catalog_as_worksheet', {
        snapshotId,
        workbookId,
        name: 'Desde el catálogo',
      });
      expect(opened).toMatchObject({ workbookId, name: 'Desde el catálogo' });

      expect(
        await failureOf(() =>
          write('delete_catalog_import', { snapshotId }, as(bob, bobId)),
        ),
      ).toMatchObject({ status: 404 });
      await write('delete_catalog_import', { snapshotId });
      expect((await read('list_catalog_imports')).imports).toEqual([]);
    });

    it('la fuente, el horario y la política del feed; sin feed, 404', async () => {
      expect(
        await failureOf(() =>
          write('set_feed_schedule', {
            ...(external && { feedId: randomUUID() }),
            enabled: true,
            refreshTime: '06:00',
            timeZone: 'America/La_Paz',
          }),
        ),
      ).toEqual({ status: 404, code: 'FEED_NOT_FOUND' });
      const feedId = external
        ? (await write('create_feed')).feedId
        : (await rest().post(`/api/v1/projects/${projectId}/feeds`).expect(201))
            .body.feed.id;
      await write('create_ruleset', { ...CATALOG_RULESET, baseRevision: 0 });

      await write('set_feed_source', {
        feedId,
        url: 'https://tienda.example/catalogo.csv',
        idColumn: 'id',
      });
      await write('set_feed_schedule', {
        feedId,
        enabled: true,
        refreshTime: '06:00',
        timeZone: 'America/La_Paz',
      });
      await write('approve_feed_policy', {
        feedId,
        rulesetRevision: 1,
        maxInvalid: 0,
        maxExcluded: 5,
        maxDropPercent: 10,
      });

      const { body } = await rest()
        .get(`/api/v1/projects/${projectId}/feeds`)
        .expect(200);
      const saved = JSON.stringify(body);
      expect(saved).toContain('https://tienda.example/catalogo.csv');
      expect(saved).toContain('06:00');
      expect(saved).toContain('"maxDropPercent":10');

      if (external) {
        expect(
          await read('get_feed_delivery_status', { feedId }),
        ).toMatchObject({ delivering: false, reason: 'no_published_version' });
        expect(await read('list_feed_versions', { feedId })).toMatchObject({
          versions: [],
        });
        expect(await read('get_feed_configuration', { feedId })).toMatchObject({
          source: { idColumn: 'id' },
          policy: { rulesetRevision: 1 },
          schedule: { refreshTime: '06:00' },
        });
        const { refresh } = await write('refresh_feed', { feedId });
        expect(
          await read('get_feed_refresh', { feedId, refreshId: refresh.id }),
        ).toMatchObject({ id: refresh.id, status: 'queued' });
        expect(await write('disable_feed_delivery', { feedId })).toMatchObject({
          feedId,
          deliveryEnabled: false,
        });
      }
    });
    if (external) {
      it('publica dos exportaciones, vuelve a una versión y descarga el mismo TSV', async () => {
        await write('create_ruleset', { ...CATALOG_RULESET, baseRevision: 0 });
        const products = ['CLI-A', 'CLI-B'];
        const published = [];
        for (const sku of products) {
          const snapshotId = await insertReadySnapshot(pool, projectId, [
            catalogValues(sku),
          ]);
          const { evaluationId } = await write('request_evaluation', {
            snapshotId,
            rulesetRevision: 1,
          });
          await app.get(EvaluationWorker).runUntilIdle();
          const { exportId } = await write('approve_export', { evaluationId });
          published.push({
            exportId,
            ...(await write('publish_feed', { exportId })),
          });
        }
        const [first, latest] = published;
        const { feedId } = latest;
        expect(await read('list_feed_versions', { feedId })).toMatchObject({
          versions: [{ id: latest.versionId }, { id: first.versionId }],
        });
        const result = await write('republish_feed_version', {
          feedId,
          versionId: first.versionId,
        });
        expect(result).toMatchObject({
          feedId,
          generation: 3,
          published: true,
        });
        const data = await read('list_feed_products', {
          feedId,
          versionId: result.versionId,
        });
        expect(JSON.stringify(data)).toContain('CLI-A');
        const tsv = await cliGet(`/exports/${first.exportId}/file`).expect(200);
        const version = await cliGet(
          `/feeds/${feedId}/versions/${result.versionId}/file`,
        ).expect(200);
        expect(tsv.text ?? tsv.body.toString()).toContain('CLI-A');
        expect(version.text ?? version.body.toString()).toBe(
          tsv.text ?? tsv.body.toString(),
        );
      });
    }
  },
);
