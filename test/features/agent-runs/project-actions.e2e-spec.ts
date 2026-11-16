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
import {
  AGENT_RUN_DEFAULTS,
  AGENT_RUN_OPTIONS,
} from '../../../src/agent-runs/agent-runs.types.js';
import { AI_AUTO_CONFIRM } from '../../../src/agent-runs/auto-confirm.js';
import type { OperationContext } from '../../../src/agent-runs/operations/agent-operation.js';
import {
  AgentOperationCatalog,
  FORBIDDEN_OPERATIONS,
} from '../../../src/agent-runs/operations/agent-operation-catalog.js';
import { EvaluationWorker } from '../../../src/evaluations/evaluations.worker.js';
import { IntegrationsModule } from '../../../src/integrations/integrations.module.js';
import { MCP_ADAPTER_TOKEN } from '../../../src/integrations/integrations.types.js';
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

const ADAPTER_TOKEN = 'adaptador_mcp_de_pruebas_0123456789abcdef';
const MCP = '/internal/v1/mcp-integrations';
const NO_CONTEXT = {
  workbookId: null,
  worksheetId: null,
  revisionId: null,
  selectionId: null,
};

/**
 * Ampliación del 2026-11-15: la IA hace todo menos lo vital. Libros y hojas,
 * aplicar y cancelar borradores, aprobar la exportación y publicar el feed
 * son escrituras del catálogo que usan los servicios de siempre. Con
 * `AI_AUTO_CONFIRM`, el MCP las aplica en la misma llamada.
 */
describe('Acciones del proyecto desde la IA y confirmación automática', () => {
  let app: INestApplication;
  let pool: Pool;
  let close: () => Promise<void>;
  let organizationId: string;
  let projectId: string;
  let aliceId: string;
  let bobId: string;
  let workbookId: string;
  let worksheetId: string;
  let col: FixtureColumnIds;

  const rest = (session?: string) => clientsFor(app).rest(session);
  const base = () =>
    `/api/v1/organizations/${organizationId}/projects/${projectId}`;

  function asAlice(): OperationContext {
    return {
      identity: alice,
      actorId: aliceId,
      scope: { organizationId, projectId },
      context: NO_CONTEXT,
    };
  }

  function asBob(): OperationContext {
    return {
      identity: bob,
      actorId: bobId,
      scope: { organizationId, projectId },
      context: NO_CONTEXT,
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
    const found = operation(name);
    if (found.level !== 'read') throw new Error(`${name} no es una lectura`);
    return found.execute(asAlice(), await found.parse(input));
  }

  /** Prepara y confirma, como la persona en la web. */
  async function write(
    name: string,
    input: Record<string, unknown> = {},
    context = asAlice(),
  ): Promise<any> {
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

  beforeAll(async () => {
    ({ app, pool, close } = await startGraphqlApp(
      [IntegrationsModule],
      (builder) =>
        builder
          .overrideProvider(KNOWLEDGE_OPTIONS)
          .useValue({ ...KNOWLEDGE_DEFAULTS, autoStart: false })
          .overrideProvider(AGENT_RUN_OPTIONS)
          .useValue({ ...AGENT_RUN_DEFAULTS, autoStart: false })
          .overrideProvider(MCP_ADAPTER_TOKEN)
          .useValue(ADAPTER_TOKEN)
          .overrideProvider(AI_AUTO_CONFIRM)
          .useValue(true),
    ));
  });

  beforeEach(async () => {
    ({ organizationId, projectId, aliceId, bobId } = await seedTwoOrganizations(
      app,
      pool,
    ));
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
  });

  afterAll(async () => {
    await close?.();
  });

  it('crea, renombra, archiva y restaura libros y hojas', async () => {
    const created = await write('create_workbook', { name: 'Inventario' });
    expect(created.name).toBe('Inventario');
    await write('rename_workbook', {
      workbookId: created.workbookId,
      name: 'Inventario 2026',
    });
    await write('rename_worksheet', { worksheetId, name: 'Precios BOB' });
    const archived = await write('archive_worksheet', { worksheetId });
    expect(archived.archivedAt).not.toBeNull();
    const restored = await write('restore_worksheet', { worksheetId });
    expect(restored.archivedAt).toBeNull();
    await write('archive_workbook', { workbookId: created.workbookId });

    const { workbooks } = await read('list_workbooks', { archived: true });
    expect(workbooks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: created.workbookId,
          name: 'Inventario 2026',
          archived: true,
        }),
      ]),
    );
    const schema = await read('get_sheet_schema', { worksheetId });
    expect(schema.name).toBe('Precios BOB');
  });

  it('aplica un borrador de punta a punta y cancela otro', async () => {
    const draft = await write('prepare_sheet_edits', {
      worksheetId,
      explanation: 'Subir A',
      operations: [
        {
          type: 'set_cell',
          rowId: ROW_IDS.a,
          columnId: col.price,
          value: '11.00',
        },
      ],
    });
    const applied = await write('apply_changeset', {
      changesetId: draft.changesetId,
    });
    expect(applied).toMatchObject({
      changesetId: draft.changesetId,
      sequence: 3,
    });
    const opened = await read('open_changeset', {
      changesetId: draft.changesetId,
    });
    expect(opened.changeset).toMatchObject({
      status: 'applied',
      appliedRevisionId: applied.revisionId,
    });

    const other = await write('prepare_sheet_edits', {
      worksheetId,
      explanation: 'Borrar B',
      operations: [{ type: 'delete_row', rowId: ROW_IDS.b }],
    });
    const cancelled = await write('cancel_changeset', {
      changesetId: other.changesetId,
    });
    expect(cancelled.status).toBe('cancelled');
    expect(
      await failureOf(() =>
        write('apply_changeset', { changesetId: other.changesetId }),
      ),
    ).toEqual({ status: 409, code: 'CHANGESET_STATE_INVALID' });

    const view = await write('suggest_view', {
      worksheetId,
      name: 'Caros',
      query: { sort: [{ columnId: col.price, direction: 'desc' }] },
    });
    await write('delete_saved_view', { viewId: view.savedViewId });
    expect(
      await failureOf(() =>
        write('delete_saved_view', { viewId: view.savedViewId }),
      ),
    ).toMatchObject({ status: 404 });
  });

  it('llega hasta Productos: reglas, evaluación, exportación y feed', async () => {
    const snapshotId = await insertReadySnapshot(pool, projectId, [
      catalogValues('A1'),
      catalogValues('A2'),
      catalogValues('A3', { Marca: '' }),
    ]);
    await write('create_ruleset', { ...CATALOG_RULESET, baseRevision: 0 });
    await write('request_evaluation', { snapshotId, rulesetRevision: 1 });
    await app.get(EvaluationWorker).runUntilIdle();
    const report = await read('get_evaluation_report');
    expect(report.evaluation.counts).toMatchObject({ valid: 2, excluded: 1 });

    const approved = await write('approve_export');
    expect(approved.created).toBe(true);
    const published = await write('publish_feed', {
      exportId: approved.exportId,
    });
    expect(published).toMatchObject({ generation: 1, published: true });
    expect(JSON.stringify(published)).not.toContain('/feeds/');

    const products = await read('list_feed_products', {
      feedId: published.feedId,
      versionId: published.versionId,
    });
    expect(JSON.stringify(products)).toContain('A1');
    expect(JSON.stringify(products)).not.toContain('A3');
    const status = await read('get_feed_status');
    expect(status.feeds[0].delivery.delivering).toBe(true);

    // Publicar otra vez la misma exportación no crea otra versión.
    const again = await write('publish_feed', { exportId: approved.exportId });
    expect(again).toMatchObject({ generation: 1, published: false });
  });

  it('cada rol recibe solo lo que puede hacer y lo vital no existe', async () => {
    const names = app
      .get(AgentOperationCatalog)
      .all()
      .map(({ name }) => name);
    for (const forbidden of FORBIDDEN_OPERATIONS) {
      expect(names).not.toContain(forbidden);
    }

    await setRole(pool, organizationId, bobId, 'editor');
    const editor = (
      await app.get(AgentOperationCatalog).describeFor(bob, projectId)
    ).map(({ name }) => name);
    expect(editor).toEqual(
      expect.arrayContaining(['create_workbook', 'cancel_changeset']),
    );
    for (const approval of [
      'apply_changeset',
      'approve_export',
      'publish_feed',
    ]) {
      expect(editor).not.toContain(approval);
    }
    // Aunque la llamara, el servicio exige el permiso de aprobar.
    const draft = await write('prepare_sheet_edits', {
      worksheetId,
      explanation: 'De Bob',
      operations: [{ type: 'delete_row', rowId: ROW_IDS.a }],
    });
    expect(
      await failureOf(() =>
        write('apply_changeset', { changesetId: draft.changesetId }, asBob()),
      ),
    ).toMatchObject({ status: 403 });

    await setRole(pool, organizationId, bobId, 'viewer');
    const viewer = (
      await app.get(AgentOperationCatalog).describeFor(bob, projectId)
    ).map(({ name }) => name);
    expect(viewer).not.toContain('create_workbook');
  });

  it('con AI_AUTO_CONFIRM, el MCP aplica en la misma llamada', async () => {
    const { body: issued } = await rest()
      .post(`${base()}/integrations/credentials`)
      .set('Idempotency-Key', randomUUID())
      .send({
        label: 'MCP autónomo',
        audience: 'mcp',
        capabilities: ['read', 'prepare'],
      })
      .expect(201);
    const call = (name: string, args: object, callId = randomUUID()) =>
      request(app.getHttpServer())
        .post(`${MCP}/operations/${name}`)
        .auth(ADAPTER_TOKEN, { type: 'bearer' })
        .set('X-Ktsu-Delegation', `Bearer ${issued.token}`)
        .send({ callId, mode: 'prepare', arguments: args });

    const callId = randomUUID();
    const { body } = await call(
      'create_workbook',
      { name: 'Desde el MCP' },
      callId,
    ).expect(200);
    expect(body).toMatchObject({
      status: 'confirmed',
      result: { name: 'Desde el MCP' },
    });
    expect(body).not.toHaveProperty('reviewPath');

    // Repetir la llamada devuelve lo mismo y no crea otro libro.
    const { body: repeated } = await call(
      'create_workbook',
      { name: 'Desde el MCP' },
      callId,
    ).expect(200);
    expect(repeated.result).toEqual(body.result);
    const { rows } = await pool.query(
      `SELECT id FROM estadistica_forms.workbooks WHERE name = 'Desde el MCP'`,
    );
    expect(rows).toHaveLength(1);

    // Del borrador a la revisión aplicada, sin pasar por la web.
    const { body: draft } = await call('prepare_sheet_edits', {
      worksheetId,
      explanation: 'Corregir A',
      operations: [
        {
          type: 'set_cell',
          rowId: ROW_IDS.a,
          columnId: col.price,
          value: '12.00',
        },
      ],
    }).expect(200);
    expect(draft.status).toBe('confirmed');
    const { body: applied } = await call('apply_changeset', {
      changesetId: draft.result.changesetId,
    }).expect(200);
    expect(applied).toMatchObject({
      status: 'confirmed',
      result: { sequence: 3 },
    });
  });
});
