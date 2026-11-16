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
import {
  AGENT_RUN_DEFAULTS,
  AGENT_RUN_OPTIONS,
} from '../../../src/agent-runs/agent-runs.types.js';
import type {
  OperationContext,
  PreparedEffect,
} from '../../../src/agent-runs/operations/agent-operation.js';
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
  seedTwoRevisions,
  type FixtureColumnIds,
} from '../worksheets/support/row-fixtures.js';

const NO_CONTEXT = {
  workbookId: null,
  worksheetId: null,
  revisionId: null,
  selectionId: null,
};

type Sheet = { id: string; columnIds: string[] };

/**
 * Plan 09 del asistente, etapa 2: el chat prepara cambios de filas, celdas y
 * columnas en un borrador nuevo o en uno abierto, cambia un sufijo de texto y
 * propone borrar duplicados con su criterio. Las operaciones se llaman como la
 * pasarela (parse, prepare o execute y confirm) con los servicios reales.
 *
 * «Precios» tiene las dos revisiones de `seedTwoRevisions`: la vigente lleva
 * A, B, D y E.
 */
describe('Plan 09, etapa 2: editar filas, celdas y columnas desde el chat', () => {
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

  function operation(name: string) {
    const found = app.get(AgentOperationCatalog).find(name);
    if (!found) throw new Error(`${name} no está en el catálogo`);
    return found;
  }

  async function read(
    name: string,
    input: Record<string, unknown>,
    context = asAlice(),
  ): Promise<any> {
    const found = operation(name);
    if (found.level !== 'read') throw new Error(`${name} no es una lectura`);
    return found.execute(context, await found.parse(input));
  }

  async function prepare(
    name: string,
    input: Record<string, unknown>,
    context = asAlice(),
  ): Promise<PreparedEffect> {
    const found = operation(name);
    if (found.level !== 'write') throw new Error(`${name} no es escritura`);
    return found.prepare(context, await found.parse(input));
  }

  async function confirm(
    name: string,
    prepared: PreparedEffect,
    context = asAlice(),
  ): Promise<any> {
    const found = operation(name);
    if (found.level !== 'write') throw new Error(`${name} no es escritura`);
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

  /** Prepara y confirma un borrador nuevo; devuelve su ID. */
  async function draftFromChat(
    sheetId: string,
    operations: object[],
    explanation = 'Cambios del chat',
  ) {
    const prepared = await prepare('prepare_sheet_edits', {
      worksheetId: sheetId,
      explanation,
      operations,
    });
    const saved = await confirm('prepare_sheet_edits', prepared);
    return saved.changesetId as string;
  }

  /** Envía, aprueba y aplica un borrador por REST, como en el editor. */
  async function applyDraft(changesetId: string) {
    const { body: found } = await rest()
      .get(`${base()}/changesets/${changesetId}`)
      .expect(200);
    const { body: sent } = await rest()
      .post(`${base()}/changesets/${changesetId}/submit`)
      .send({ draftVersion: found.changeset.draftVersion })
      .expect(200);
    const pending = sent.changeset;
    await rest()
      .post(`${base()}/changesets/${changesetId}/decisions`)
      .send({
        decision: 'accept',
        contentHash: pending.contentHash,
        draftVersion: pending.draftVersion,
        expectedHeadRevisionId: pending.baseRevisionId,
      })
      .expect(201);
    const { body } = await rest()
      .post(`${base()}/changesets/${changesetId}/apply`)
      .set('Idempotency-Key', `etapa-2-${changesetId}`)
      .send({
        contentHash: pending.contentHash,
        expectedHeadRevisionId: pending.baseRevisionId,
      })
      .expect(200);
    return body.applied.revisionId as string;
  }

  /** Una hoja con filas ya aplicadas: la crea el editor y la llena el chat. */
  async function sheetWithRows(
    name: string,
    columns: object[],
    rows: (string | null)[][],
  ): Promise<Sheet & { rowIds: string[] }> {
    const { body } = await rest()
      .post(`${base()}/workbooks/${workbookId}/worksheets`)
      .send({ name, columns })
      .expect(201);
    const columnIds = body.worksheet.columns.map(
      ({ id }: { id: string }) => id,
    );
    const rowIds = rows.map(() => randomUUID());
    const changesetId = await draftFromChat(
      body.worksheet.id,
      rows.map((values, index) => ({
        type: 'insert_row',
        rowId: rowIds[index],
        sortKey: String(index).padStart(3, '0'),
        values: Object.fromEntries(
          values
            .map((value, at) => [columnIds[at], value] as const)
            .filter(([, value]) => value !== null),
        ),
      })),
      `Cargar ${name}`,
    );
    await applyDraft(changesetId);
    return { id: body.worksheet.id, columnIds, rowIds };
  }

  async function changesetOf(changesetId: string) {
    const { body } = await rest()
      .get(`${base()}/changesets/${changesetId}`)
      .expect(200);
    return body.changeset;
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

  it('prepara sin escribir y, al confirmar, crea un borrador con filas, celdas y columnas', async () => {
    const newRow = randomUUID();
    const currency = randomUUID();
    const prepared = await prepare('prepare_sheet_edits', {
      worksheetId,
      title: 'Ajustes de noviembre',
      explanation: 'Corregir precios y añadir la moneda',
      operations: [
        {
          type: 'add_column',
          columnId: currency,
          name: 'Moneda',
          columnType: 'text',
        },
        { type: 'rename_column', columnId: col.quantity, name: 'Existencias' },
        {
          type: 'set_cell',
          rowId: ROW_IDS.a,
          columnId: col.price,
          value: '11.00',
        },
        {
          type: 'set_cell',
          rowId: ROW_IDS.b,
          columnId: col.quantity,
          value: null,
        },
        { type: 'delete_row', rowId: ROW_IDS.d },
        {
          type: 'insert_row',
          rowId: newRow,
          values: { [col.sku]: 'F-006', [currency]: 'BOB' },
        },
      ],
    });
    expect(prepared.summary).toBe(
      'Crear el borrador «Ajustes de noviembre» en la hoja «Precios»: 1 columnas nuevas, 1 columnas renombradas, 2 celdas, 1 filas borradas, 1 filas nuevas. Corregir precios y añadir la moneda',
    );
    expect(prepared.target).toEqual({ worksheetId, changesetId: null });
    const before = await pool.query(
      'SELECT id FROM estadistica_forms.worksheet_changesets WHERE worksheet_id = $1',
      [worksheetId],
    );
    expect(before.rowCount).toBe(0);

    const saved = await confirm('prepare_sheet_edits', prepared);
    const changeset = await changesetOf(saved.changesetId);
    expect(changeset).toMatchObject({
      source: 'ai',
      status: 'draft',
      title: 'Ajustes de noviembre',
    });
    expect(saved.operationCount).toBe(6);

    // La revisión del borrador es la del editor. Vaciar la cantidad de B, que
    // ya estaba vacía, no cambia nada: cuenta como `noop`.
    const opened = await read('open_changeset', {
      changesetId: saved.changesetId,
    });
    expect(opened.review.counts).toMatchObject({
      change: 5,
      noop: 1,
      conflict: 0,
    });
    expect(opened.review.problems.total).toBe(0);

    const revisionId = await applyDraft(saved.changesetId);
    const compared = await read('compare_revisions', {
      worksheetId,
      fromRevisionId: changeset.baseRevisionId,
      toRevisionId: revisionId,
    });
    expect(compared.rows.counts).toEqual({ added: 1, removed: 1, edited: 1 });
    expect(compared.columns.added).toEqual([
      { id: currency, name: 'Moneda', type: 'text' },
    ]);
  });

  it('continúa un borrador abierto y conserva sus cambios anteriores', async () => {
    const { body: created } = await rest()
      .post(`${base()}/worksheets/${worksheetId}/changesets`)
      .send({ title: 'Revisión manual' })
      .expect(201);
    const { body: saved } = await rest()
      .put(`${base()}/changesets/${created.changeset.id}/operations`)
      .set('If-Match', `"${created.changeset.draftVersion}"`)
      .send({
        operations: [
          {
            type: 'set_cell',
            rowId: ROW_IDS.b,
            columnId: col.price,
            value: '13.00',
          },
        ],
      })
      .expect(200);
    const draft = saved.changeset;

    const prepared = await prepare(
      'prepare_sheet_edits',
      {
        changesetId: draft.id,
        explanation: 'Corregir E',
        operations: [
          {
            type: 'set_cell',
            rowId: ROW_IDS.e,
            columnId: col.price,
            value: '1.75',
          },
        ],
      },
      asAlice({ worksheetId }),
    );
    expect(prepared.summary).toContain(
      `Añadir al borrador «Revisión manual» (versión ${draft.draftVersion}) de la hoja «Precios»: 1 celdas. Conserva sus 1 cambios anteriores.`,
    );
    expect(prepared.target).toEqual({ worksheetId, changesetId: draft.id });

    const result = await confirm('prepare_sheet_edits', prepared);
    expect(result).toMatchObject({
      changesetId: draft.id,
      draftVersion: draft.draftVersion + 1,
      operationCount: 2,
    });
    const after = await changesetOf(draft.id);
    expect(after.operations).toEqual([
      {
        type: 'set_cell',
        rowId: ROW_IDS.b,
        columnId: col.price,
        value: '13.00',
      },
      {
        type: 'set_cell',
        rowId: ROW_IDS.e,
        columnId: col.price,
        value: '1.75',
      },
    ]);
  });

  it('no pisa un borrador que otro guardó después ni escribe en uno enviado', async () => {
    const { body: created } = await rest()
      .post(`${base()}/worksheets/${worksheetId}/changesets`)
      .send({ title: 'Compartido' })
      .expect(201);
    const draft = created.changeset;
    const prepared = await prepare('prepare_sheet_edits', {
      worksheetId,
      changesetId: draft.id,
      explanation: 'Corregir A',
      operations: [
        {
          type: 'set_cell',
          rowId: ROW_IDS.a,
          columnId: col.price,
          value: '20.00',
        },
      ],
    });
    const { body: meanwhile } = await rest()
      .put(`${base()}/changesets/${draft.id}/operations`)
      .set('If-Match', `"${draft.draftVersion}"`)
      .send({
        operations: [{ type: 'delete_row', rowId: ROW_IDS.b }],
      })
      .expect(200);

    expect(
      await failureOf(() => confirm('prepare_sheet_edits', prepared)),
    ).toEqual({ status: 412, code: 'CHANGESET_VERSION_MISMATCH' });
    expect((await changesetOf(draft.id)).operations).toEqual([
      { type: 'delete_row', rowId: ROW_IDS.b },
    ]);

    // El borrador tiene que ser de la hoja que se edita.
    const { body: other } = await rest()
      .post(`${base()}/workbooks/${workbookId}/worksheets`)
      .send({ name: 'Otra', columns: [{ name: 'SKU', type: 'text' }] })
      .expect(201);
    expect(
      await failureOf(() =>
        prepare('prepare_sheet_edits', {
          worksheetId: other.worksheet.id,
          changesetId: draft.id,
          explanation: 'Hoja equivocada',
          operations: [{ type: 'delete_row', rowId: ROW_IDS.a }],
        }),
      ),
    ).toEqual({ status: 404, code: 'CHANGESET_NOT_FOUND' });

    await rest()
      .post(`${base()}/changesets/${draft.id}/submit`)
      .send({ draftVersion: meanwhile.changeset.draftVersion })
      .expect(200);
    expect(
      await failureOf(() =>
        prepare('prepare_sheet_edits', {
          worksheetId,
          changesetId: draft.id,
          explanation: 'Otra vez',
          operations: [{ type: 'delete_row', rowId: ROW_IDS.a }],
        }),
      ),
    ).toEqual({ status: 409, code: 'CHANGESET_STATE_INVALID' });
  });

  it('un borrador nuevo se prepara otra vez si la hoja avanzó', async () => {
    const prepared = await prepare('prepare_sheet_edits', {
      worksheetId,
      explanation: 'Sobre la revisión 2',
      operations: [{ type: 'delete_row', rowId: ROW_IDS.e }],
    });
    await applyDraft(
      await draftFromChat(worksheetId, [
        { type: 'delete_row', rowId: ROW_IDS.d },
      ]),
    );
    expect(
      await failureOf(() => confirm('prepare_sheet_edits', prepared)),
    ).toEqual({ status: 409, code: 'CHANGESET_BASE_OUTDATED' });
  });

  it('rechaza valores y columnas que el editor rechazaría', async () => {
    const invalid = await failureOf(() =>
      prepare('prepare_sheet_edits', {
        worksheetId,
        explanation: 'Precio mal escrito',
        operations: [
          {
            type: 'set_cell',
            rowId: ROW_IDS.a,
            columnId: col.price,
            value: 'doce',
          },
        ],
      }),
    );
    expect(invalid.status).toBe(400);
    expect(
      await failureOf(() =>
        prepare('prepare_sheet_edits', {
          worksheetId,
          explanation: 'Columna ajena',
          operations: [
            {
              type: 'set_cell',
              rowId: ROW_IDS.a,
              columnId: randomUUID(),
              value: 'x',
            },
          ],
        }),
      ),
    ).toMatchObject({ status: 400 });
    expect(
      await failureOf(() =>
        prepare('prepare_sheet_edits', {
          worksheetId,
          explanation: 'Sin cambios',
          operations: [],
        }),
      ),
    ).toMatchObject({ status: 400 });
  });

  it('cambia el sufijo USD por BOB y conserva el número', async () => {
    const sheet = await sheetWithRows(
      'Catálogo',
      [
        { name: 'SKU', type: 'text' },
        { name: 'Precio', type: 'text' },
      ],
      [
        ['P-1', '59.99 USD'],
        ['P-2', '10.00 USD'],
        ['P-3', 'USD 5'],
        ['P-4', '7.50 BOB'],
      ],
    );
    const [, price] = sheet.columnIds;
    const context = asAlice({ worksheetId: sheet.id });
    const selection = await read(
      'select_rows',
      {
        columnIds: [price],
        rows: {
          kind: 'allMatchingFilter',
          filter: { column: price, op: 'contains', value: 'USD' },
        },
      },
      context,
    );
    expect(selection.rowCount).toBe(3);
    const preview = await read(
      'preview_transform',
      {
        selectionId: selection.selectionId,
        columnIds: [price],
        transform: {
          kind: 'replace_text',
          find: 'USD',
          replace: 'BOB',
          match: 'suffix',
        },
      },
      context,
    );
    expect(preview).toMatchObject({ affectedCells: 2, issueCount: 0 });
    expect(
      preview.sample.map(({ before, after }: Record<string, string>) => [
        before,
        after,
      ]),
    ).toEqual([
      ['59.99 USD', '59.99 BOB'],
      ['10.00 USD', '10.00 BOB'],
    ]);

    // «contains» también cambia el prefijo; un número no es texto y se rechaza.
    const everywhere = await read(
      'preview_transform',
      {
        selectionId: selection.selectionId,
        columnIds: [price],
        transform: {
          kind: 'replace_text',
          find: 'USD',
          replace: 'BOB',
          match: 'contains',
        },
      },
      context,
    );
    expect(everywhere.affectedCells).toBe(3);
    const numeric = await read(
      'select_rows',
      {
        columnIds: [col.price],
        rows: { kind: 'selectedRows', rowIds: [ROW_IDS.a] },
      },
      asAlice({ worksheetId }),
    );
    expect(
      await failureOf(() =>
        read(
          'preview_transform',
          {
            selectionId: numeric.selectionId,
            columnIds: [col.price],
            transform: {
              kind: 'replace_text',
              find: '5',
              replace: '6',
              match: 'suffix',
            },
          },
          asAlice({ worksheetId }),
        ),
      ),
    ).toMatchObject({ status: 400 });
  });

  it('encuentra duplicados con su criterio y prepara las bajas en otro esquema', async () => {
    const sheet = await sheetWithRows(
      'Inventario',
      [
        { name: 'Referencia', type: 'text' },
        { name: 'Nombre', type: 'text' },
        { name: 'Existencias', type: 'integer' },
      ],
      [
        ['R-1', 'Tornillo', '10'],
        ['R-2', 'Arandela', '4'],
        [' r-1 ', 'Tornillo', '3'],
        ['R-1', 'Tuerca', '8'],
        [null, 'Sin referencia', '1'],
        [null, 'Otra sin referencia', '2'],
      ],
    );
    const [reference] = sheet.columnIds;
    const exact = await read('find_duplicates', {
      worksheetId: sheet.id,
      columnIds: [reference],
    });
    expect(exact.criterion).toEqual({
      columns: [{ id: reference, name: 'Referencia', type: 'text' }],
      comparison: 'exact',
      keep: 'first',
    });
    expect(exact.counts).toEqual({
      groups: 1,
      rowsToRemove: 1,
      rowsWithEmptyKey: 2,
    });
    expect(exact.groups).toEqual([
      {
        key: { [reference]: 'R-1' },
        keepRowId: sheet.rowIds[0],
        removeRowIds: [sheet.rowIds[3]],
      },
    ]);

    const normalized = await read('find_duplicates', {
      worksheetId: sheet.id,
      columnIds: [reference],
      comparison: 'normalized',
      keep: 'last',
    });
    expect(normalized.groups).toEqual([
      {
        key: { [reference]: 'R-1' },
        keepRowId: sheet.rowIds[3],
        removeRowIds: [sheet.rowIds[0], sheet.rowIds[2]],
      },
    ]);

    const prepared = await prepare('prepare_sheet_edits', {
      worksheetId: sheet.id,
      explanation: 'Quitar referencias repetidas; se conserva la última',
      operations: normalized.groups[0].removeRowIds.map((rowId: string) => ({
        type: 'delete_row',
        rowId,
      })),
    });
    expect(prepared.summary).toContain('2 filas borradas');
    const saved = await confirm('prepare_sheet_edits', prepared);
    const opened = await read('open_changeset', {
      changesetId: saved.changesetId,
    });
    expect(opened.review.counts.change).toBe(2);

    expect(
      await failureOf(() =>
        read('find_duplicates', {
          worksheetId: sheet.id,
          columnIds: [randomUUID()],
        }),
      ),
    ).toMatchObject({ status: 400 });
  });

  it('un Viewer no recibe la edición y nadie de fuera ve la hoja', async () => {
    await setRole(pool, organizationId, bobId, 'viewer');
    const offered = (
      await app.get(AgentOperationCatalog).describeFor(bob, projectId)
    ).map(({ name }) => name);
    expect(offered).toContain('find_duplicates');
    expect(offered).not.toContain('prepare_sheet_edits');
    // Aunque llegara a preparar, guardar exige `worksheet.write`.
    const prepared = await prepare('prepare_sheet_edits', {
      worksheetId,
      explanation: 'Intento',
      operations: [{ type: 'delete_row', rowId: ROW_IDS.a }],
    });
    expect(
      await failureOf(() => confirm('prepare_sheet_edits', prepared, asBob())),
    ).toMatchObject({ status: 403 });

    const { rows } = await pool.query<{ organization_id: string }>(
      'SELECT organization_id FROM estadistica_forms.projects WHERE id = $1',
      [bobProjectId],
    );
    const outside = asBob({
      organizationId: rows[0].organization_id,
      projectId: bobProjectId,
    });
    expect(
      await failureOf(() =>
        prepare(
          'prepare_sheet_edits',
          {
            worksheetId,
            explanation: 'De fuera',
            operations: [{ type: 'delete_row', rowId: ROW_IDS.a }],
          },
          outside,
        ),
      ),
    ).toMatchObject({ status: 404 });
    expect(
      await failureOf(() =>
        read('find_duplicates', { worksheetId, columnIds: [col.sku] }, outside),
      ),
    ).toMatchObject({ status: 404 });
  });
});
