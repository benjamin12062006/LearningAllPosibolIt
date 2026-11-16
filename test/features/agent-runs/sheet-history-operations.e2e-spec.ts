import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import { HttpException, type INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import {
  AGENT_RUN_DEFAULTS,
  AGENT_RUN_OPTIONS,
} from '../../../src/agent-runs/agent-runs.types.js';
import type { OperationContext } from '../../../src/agent-runs/operations/agent-operation.js';
import { AgentOperationCatalog } from '../../../src/agent-runs/operations/agent-operation-catalog.js';
import {
  KNOWLEDGE_DEFAULTS,
  KNOWLEDGE_OPTIONS,
} from '../../../src/knowledge/knowledge.types.js';
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
  SECOND_REVISION_ID,
  seedTwoRevisions,
  type FixtureColumnIds,
} from '../worksheets/support/row-fixtures.js';

const NEW_ROW_ID = '00000000-0000-4000-8000-0000000000f1';
const CURRENCY_COLUMN_ID = '00000000-0000-4000-8000-00000000c0c1';

const NO_CONTEXT = {
  workbookId: null,
  worksheetId: null,
  revisionId: null,
  selectionId: null,
};

/**
 * Plan 09 del asistente, etapa 1: desde un chat de proyecto, listar libros e
 * historial de una hoja, abrir un borrador que ya existía y comparar dos
 * revisiones. Las operaciones se llaman como lo hace la pasarela (parse y
 * execute) con los servicios reales.
 *
 * La hoja «Precios» tiene tres revisiones:
 * - 1: A, B, C y D (`seedTwoRevisions`).
 * - 2: B cambia de precio, C se borra y entra E.
 * - 3 (borrador aplicado por REST): «Cantidad» pasa a «Existencias», se añade
 *   «Moneda», A cambia de precio, se borra D y entra F.
 * Además queda abierto un borrador manual que edita E.
 */
describe('Plan 09, etapa 1: consultar hoja e historial desde el chat', () => {
  let app: INestApplication;
  let pool: Pool;
  let close: () => Promise<void>;
  let organizationId: string;
  let projectId: string;
  let bobProjectId: string;
  let aliceId: string;
  let bobId: string;
  let workbookId: string;
  let worksheetId: string;
  let col: FixtureColumnIds;
  let firstRevisionId: string;
  let thirdRevisionId: string;
  let appliedChangesetId: string;
  let openChangesetId: string;

  const rest = (session?: string) => clientsFor(app).rest(session);
  const base = () =>
    `/api/v1/organizations/${organizationId}/projects/${projectId}`;

  function asAlice(context = {}): OperationContext {
    return {
      identity: alice,
      actorId: aliceId,
      scope: { organizationId, projectId },
      context: { ...NO_CONTEXT, ...context },
    };
  }

  function asBob(scope = { organizationId, projectId }): OperationContext {
    return { identity: bob, actorId: bobId, scope, context: NO_CONTEXT };
  }

  async function run(
    name: string,
    input: Record<string, unknown>,
    context = asAlice(),
  ): Promise<any> {
    const operation = app.get(AgentOperationCatalog).find(name);
    if (operation?.level !== 'read') {
      throw new Error(`${name} no es una lectura del catálogo`);
    }
    return operation.execute(context, await operation.parse(input));
  }

  async function failure(
    name: string,
    input: Record<string, unknown>,
    context = asAlice(),
  ) {
    try {
      await run(name, input, context);
    } catch (error) {
      if (error instanceof HttpException) {
        const body = error.getResponse() as { code?: string };
        return { status: error.getStatus(), code: body.code };
      }
      throw error;
    }
    throw new Error(`${name} no falló`);
  }

  /** Crea, guarda, envía, aprueba y aplica un borrador; devuelve su revisión. */
  async function applyThirdRevision() {
    const changeset = await draftWith('Precios de noviembre', [
      { type: 'rename_column', columnId: col.quantity, name: 'Existencias' },
      {
        type: 'add_column',
        columnId: CURRENCY_COLUMN_ID,
        name: 'Moneda',
        columnType: 'text',
      },
      {
        type: 'set_cell',
        rowId: ROW_IDS.a,
        columnId: col.price,
        value: '11.00',
      },
      { type: 'delete_row', rowId: ROW_IDS.d },
      {
        type: 'insert_row',
        rowId: NEW_ROW_ID,
        sortKey: 'f',
        values: { [col.sku]: 'F-006', [col.price]: '2.00' },
      },
    ]);
    appliedChangesetId = changeset.id;
    const { body: sent } = await rest()
      .post(`${base()}/changesets/${changeset.id}/submit`)
      .send({ draftVersion: changeset.draftVersion })
      .expect(200);
    const pending = sent.changeset;
    await rest()
      .post(`${base()}/changesets/${pending.id}/decisions`)
      .send({
        decision: 'accept',
        contentHash: pending.contentHash,
        draftVersion: pending.draftVersion,
        expectedHeadRevisionId: pending.baseRevisionId,
      })
      .expect(201);
    const { body } = await rest()
      .post(`${base()}/changesets/${pending.id}/apply`)
      .set('Idempotency-Key', `etapa-1-${pending.id}`)
      .send({
        contentHash: pending.contentHash,
        expectedHeadRevisionId: pending.baseRevisionId,
      })
      .expect(200);
    return body.applied.revisionId as string;
  }

  async function draftWith(title: string, operations: object[]) {
    const { body: created } = await rest()
      .post(`${base()}/worksheets/${worksheetId}/changesets`)
      .send({ title })
      .expect(201);
    const { body: saved } = await rest()
      .put(`${base()}/changesets/${created.changeset.id}/operations`)
      .set('If-Match', `"${created.changeset.draftVersion}"`)
      .send({ operations })
      .expect(200);
    return saved.changeset as {
      id: string;
      draftVersion: number;
    };
  }

  beforeAll(async () => {
    ({ app, pool, close } = await startGraphqlApp([], (builder) =>
      builder
        .overrideProvider(KNOWLEDGE_OPTIONS)
        .useValue({ ...KNOWLEDGE_DEFAULTS, autoStart: false })
        .overrideProvider(AGENT_RUN_OPTIONS)
        .useValue({ ...AGENT_RUN_DEFAULTS, autoStart: false }),
    ));
  });

  beforeEach(async () => {
    ({ organizationId, projectId, bobProjectId, aliceId, bobId } =
      await seedTwoOrganizations(app, pool));
    const { body: workbook } = await rest()
      .post(`${base()}/workbooks`)
      .send({ name: 'Inventario' })
      .expect(201);
    workbookId = workbook.workbook.id;
    const { body } = await rest()
      .post(`${base()}/workbooks/${workbookId}/worksheets`)
      .send({ name: 'Precios', columns: FIXTURE_COLUMNS })
      .expect(201);
    worksheetId = body.worksheet.id;
    firstRevisionId = body.worksheet.headRevision.id;
    col = columnIdsOf(body.worksheet);
    await seedTwoRevisions(pool, body.worksheet, organizationId, aliceId);
    thirdRevisionId = await applyThirdRevision();
    openChangesetId = (
      await draftWith('Revisar E', [
        {
          type: 'set_cell',
          rowId: ROW_IDS.e,
          columnId: col.price,
          value: '1.75',
        },
      ])
    ).id;
  });

  afterAll(async () => {
    await close?.();
  });

  it('lista los libros y el historial de la hoja por páginas', async () => {
    const { workbooks } = await run('list_workbooks', {});
    expect(workbooks).toEqual([
      expect.objectContaining({
        id: workbookId,
        name: 'Inventario',
        archived: false,
      }),
    ]);

    const revisions = await run('list_sheet_history', {
      worksheetId,
      kind: 'revisions',
    });
    expect(revisions.items.map((item: { id: string }) => item.id)).toEqual([
      thirdRevisionId,
      SECOND_REVISION_ID,
      firstRevisionId,
    ]);

    const firstPage = await run('list_sheet_history', {
      worksheetId,
      kind: 'revisions',
      limit: 2,
    });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.page).toMatchObject({
      limit: 2,
      offset: 0,
      hasMore: true,
    });

    // La hoja de la conversación sirve sin repetir el ID.
    const drafts = await run(
      'list_sheet_history',
      { kind: 'changesets', status: 'draft' },
      asAlice({ worksheetId }),
    );
    expect(drafts.items.map((item: { id: string }) => item.id)).toEqual([
      openChangesetId,
    ]);
    expect(drafts.items[0]).not.toHaveProperty('operations');
    expect(drafts.items[0].operationCount).toBe(1);

    const imports = await run('list_sheet_history', {
      worksheetId,
      kind: 'imports',
    });
    expect(imports.items).toEqual([]);
    const exports = await run('list_sheet_history', {
      worksheetId,
      kind: 'exports',
    });
    expect(exports.items).toEqual([]);
  });

  it('abre un borrador abierto con su revisión y uno aplicado con su resultado', async () => {
    const open = await run('open_changeset', { changesetId: openChangesetId });
    expect(open.worksheetId).toBe(worksheetId);
    expect(open.changeset).toMatchObject({
      id: openChangesetId,
      status: 'draft',
      operationCount: 1,
    });
    expect(open.changeset).not.toHaveProperty('operations');
    expect(open.review).toMatchObject({
      baseRevisionId: thirdRevisionId,
      headRevisionId: thirdRevisionId,
      upToDate: true,
      counts: { change: 1, conflict: 0 },
      entries: { total: 1, truncated: false },
      problems: { total: 0, items: [] },
    });
    expect(open.review.entries.items[0]).toMatchObject({
      rowId: ROW_IDS.e,
      columnId: col.price,
      proposed: '1.75',
    });

    const applied = await run('open_changeset', {
      changesetId: appliedChangesetId,
    });
    expect(applied.changeset).toMatchObject({
      status: 'applied',
      appliedRevisionId: thirdRevisionId,
      operationCount: 5,
    });
    expect(applied.review).toBeNull();
  });

  it('compara dos revisiones: filas añadidas, quitadas y editadas, y esquema', async () => {
    const older = await run('compare_revisions', {
      worksheetId,
      fromRevisionId: firstRevisionId,
      toRevisionId: SECOND_REVISION_ID,
    });
    expect(older.from).toMatchObject({ id: firstRevisionId, sequence: 1 });
    expect(older.to).toMatchObject({ id: SECOND_REVISION_ID, sequence: 2 });
    expect(older.columns).toEqual({ added: [], removed: [], changed: [] });
    expect(older.rows.counts).toEqual({ added: 1, removed: 1, edited: 1 });
    expect(older.rows.items).toEqual([
      {
        rowId: ROW_IDS.b,
        change: 'edited',
        changedColumnIds: [col.price],
        before: { [col.price]: '9.99' },
        after: { [col.price]: '12.00' },
      },
      expect.objectContaining({
        rowId: ROW_IDS.c,
        change: 'removed',
        after: null,
      }),
      expect.objectContaining({
        rowId: ROW_IDS.e,
        change: 'added',
        before: null,
      }),
    ]);

    // Sin `toRevisionId`, con la vigente (la 3).
    const latest = await run('compare_revisions', {
      worksheetId,
      fromRevisionId: SECOND_REVISION_ID,
    });
    expect(latest.to.id).toBe(thirdRevisionId);
    expect(latest.columns.added).toEqual([
      { id: CURRENCY_COLUMN_ID, name: 'Moneda', type: 'text' },
    ]);
    expect(latest.columns.changed).toEqual([
      expect.objectContaining({
        id: col.quantity,
        fields: ['name'],
        after: expect.objectContaining({ name: 'Existencias' }),
      }),
    ]);
    // Añadir «Moneda» no cuenta como edición de cada fila.
    expect(latest.rows.counts).toEqual({ added: 1, removed: 1, edited: 1 });
    expect(
      latest.rows.items.map(({ rowId, change }: Record<string, string>) => [
        rowId,
        change,
      ]),
    ).toEqual([
      [ROW_IDS.a, 'edited'],
      [ROW_IDS.d, 'removed'],
      [NEW_ROW_ID, 'added'],
    ]);

    // Al revés, lo añadido pasa a quitado. La muestra se corta, los totales no.
    const backwards = await run('compare_revisions', {
      worksheetId,
      fromRevisionId: thirdRevisionId,
      toRevisionId: firstRevisionId,
      limit: 2,
    });
    expect(backwards.rows.counts).toEqual({ added: 2, removed: 2, edited: 2 });
    expect(backwards.rows.items).toHaveLength(2);
    expect(backwards.rows.truncated).toBe(true);
    expect(backwards.columns.removed).toEqual([
      { id: CURRENCY_COLUMN_ID, name: 'Moneda', type: 'text' },
    ]);

    const same = await run('compare_revisions', {
      worksheetId,
      fromRevisionId: thirdRevisionId,
    });
    expect(same.rows).toEqual({
      counts: { added: 0, removed: 0, edited: 0 },
      items: [],
      truncated: false,
    });
  });

  it('lee las columnas de una revisión antigua', async () => {
    const old = await run('get_sheet_schema', {
      worksheetId,
      revisionId: firstRevisionId,
    });
    expect(old.headRevision.id).toBe(thirdRevisionId);
    expect(old.revision).toMatchObject({ id: firstRevisionId, sequence: 1 });
    expect(old.columns.map(({ name }: { name: string }) => name)).toEqual([
      'SKU',
      'Precio',
      'Cantidad',
      'Alta',
      'Activo',
    ]);
    const current = await run('get_sheet_schema', { worksheetId });
    expect(current.revision).toBeNull();
    expect(current.columns.map(({ name }: { name: string }) => name)).toContain(
      'Existencias',
    );
  });

  it('responde 404 a lo ajeno y 400 a una consulta incoherente', async () => {
    const { body: other } = await rest()
      .post(`${base()}/workbooks/${workbookId}/worksheets`)
      .send({ name: 'Otra hoja', columns: [{ name: 'SKU', type: 'text' }] })
      .expect(201);

    // Una revisión de otra hoja del mismo proyecto no existe para esta.
    expect(
      await failure('compare_revisions', {
        worksheetId: other.worksheet.id,
        fromRevisionId: firstRevisionId,
      }),
    ).toEqual({ status: 404, code: 'WORKSHEET_REVISION_NOT_FOUND' });
    expect(
      await failure('get_sheet_schema', {
        worksheetId: other.worksheet.id,
        revisionId: firstRevisionId,
      }),
    ).toEqual({ status: 404, code: 'WORKSHEET_REVISION_NOT_FOUND' });

    // Bob, en su organización, no ve la hoja ni el borrador de Alice.
    const bobScope = await bobOwnScope();
    expect(
      await failure(
        'list_sheet_history',
        { worksheetId, kind: 'revisions' },
        asBob(bobScope),
      ),
    ).toMatchObject({ status: 404 });
    expect(
      await failure(
        'open_changeset',
        { changesetId: openChangesetId },
        asBob(bobScope),
      ),
    ).toEqual({ status: 404, code: 'CHANGESET_NOT_FOUND' });
    expect(
      await failure(
        'compare_revisions',
        { worksheetId, fromRevisionId: firstRevisionId },
        asBob(bobScope),
      ),
    ).toMatchObject({ status: 404 });
    // Ni pasando el ámbito de Alice sin ser miembro.
    expect(await failure('list_workbooks', {}, asBob())).toMatchObject({
      status: 404,
    });

    expect(
      await failure('list_sheet_history', {
        worksheetId,
        kind: 'revisions',
        status: 'draft',
      }),
    ).toMatchObject({ status: 400 });
    expect(
      await failure('compare_revisions', { worksheetId, limit: 51 }),
    ).toMatchObject({ status: 400 });
    expect(await failure('list_sheet_history', { kind: 'revisions' })).toEqual({
      status: 404,
      code: 'WORKSHEET_NOT_FOUND',
    });
  });

  it('un Viewer de la organización puede consultar el historial', async () => {
    await setRole(pool, organizationId, bobId, 'viewer');
    const offered = await app
      .get(AgentOperationCatalog)
      .describeFor(bob, projectId);
    expect(offered.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'list_workbooks',
        'list_sheet_history',
        'open_changeset',
        'compare_revisions',
      ]),
    );
    const drafts = await run(
      'list_sheet_history',
      { worksheetId, kind: 'changesets' },
      asBob(),
    );
    expect(drafts.items).toHaveLength(2);
    const comparison = await run(
      'compare_revisions',
      { worksheetId, fromRevisionId: firstRevisionId },
      asBob(),
    );
    expect(comparison.rows.counts.edited).toBeGreaterThan(0);
  });

  async function bobOwnScope() {
    const { rows } = await pool.query<{ organization_id: string }>(
      'SELECT organization_id FROM estadistica_forms.projects WHERE id = $1',
      [bobProjectId],
    );
    return { organizationId: rows[0].organization_id, projectId: bobProjectId };
  }
});
