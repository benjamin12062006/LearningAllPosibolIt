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
import {
  clientsFor,
  seedTwoOrganizations,
  setRole,
  startGraphqlApp,
} from '../graphql/support/graphql-test-app.js';
import {
  columnIdsOf,
  FIXTURE_COLUMNS,
  ROW_IDS,
  SECOND_REVISION_ID,
  seedTwoRevisions,
  type FixtureColumnIds,
} from '../worksheets/support/row-fixtures.js';

const FIVE_PERCENT = {
  kind: 'percentage',
  rate: '5',
  scale: 2,
  rounding: 'half_up',
};

/**
 * H6: las herramientas de hoja del agente. La hoja tiene, en la revisión 2,
 * las filas A (10.50), B (12.00), D (precio mal guardado) y E (1.5). Nada de
 * esto escribe en la hoja: como mucho deja un borrador de origen `ai`.
 */
describe('H6: selecciones, vistas previas y propuestas de hoja', () => {
  let app: INestApplication;
  let pool: Pool;
  let close: () => Promise<void>;
  let organizationId: string;
  let projectId: string;
  let aliceId: string;
  let bobId: string;
  let worksheetId: string;
  let col: FixtureColumnIds;

  const client = () => clientsFor(app);
  const base = () =>
    `/api/v1/organizations/${organizationId}/projects/${projectId}`;
  const sheet = () => `${base()}/worksheets/${worksheetId}`;

  function select(rows: object, columnIds = [col.price], token?: string) {
    return client()
      .rest(token)
      .post(`${sheet()}/selections`)
      .send({ revisionId: SECOND_REVISION_ID, columnIds, rows });
  }
  function preview(
    selectionId: string,
    transform: object,
    columnIds = [col.price],
  ) {
    return client()
      .rest()
      .post(`${sheet()}/transform-previews`)
      .send({ selectionId, columnIds, transform });
  }
  function propose(previewId: string, key: string, explanation = 'Subir 5 %') {
    return client()
      .rest()
      .post(`${sheet()}/change-proposals`)
      .set('Idempotency-Key', key)
      .send({ previewId, explanation });
  }
  async function previewOfRows(rowIds: string[], transform = FIVE_PERCENT) {
    const { body: selection } = await select({
      kind: 'selectedRows',
      rowIds,
    }).expect(201);
    const { body } = await preview(selection.selectionId, transform).expect(
      201,
    );
    return body;
  }
  async function liveValues() {
    const { body } = await client()
      .rest()
      .post(`${sheet()}/rows/query`)
      .send({})
      .expect(200);
    return body.items.map(
      (row: { values: Record<string, unknown> }) => row.values[col.price],
    );
  }

  beforeAll(async () => {
    ({ app, pool, close } = await startGraphqlApp());
  });
  beforeEach(async () => {
    ({ organizationId, projectId, aliceId, bobId } = await seedTwoOrganizations(
      app,
      pool,
    ));
    const { rest } = client();
    const { body: workbook } = await rest()
      .post(`${base()}/workbooks`)
      .send({ name: 'Libro' })
      .expect(201);
    const { body } = await rest()
      .post(`${base()}/workbooks/${workbook.workbook.id}/worksheets`)
      .send({ name: 'Precios', columns: FIXTURE_COLUMNS })
      .expect(201);
    worksheetId = body.worksheet.id;
    col = columnIdsOf(body.worksheet);
    await seedTwoRevisions(pool, body.worksheet, organizationId, aliceId);
  });
  afterAll(async () => {
    await close?.();
  });

  it('un 5 % exacto sobre la selección y la propuesta queda como borrador, sin tocar la hoja', async () => {
    const before = await liveValues();

    const result = await previewOfRows([ROW_IDS.a, ROW_IDS.b, ROW_IDS.e]);

    expect(result).toMatchObject({
      revisionId: SECOND_REVISION_ID,
      affectedRows: 3,
      affectedCells: 3,
      issueCount: 0,
      canCreateProposal: true,
    });
    expect(
      result.sample.map((change: { rowId: string; after: string }) => [
        change.rowId,
        change.after,
      ]),
    ).toEqual([
      [ROW_IDS.a, '11.03'],
      [ROW_IDS.b, '12.60'],
      [ROW_IDS.e, '1.58'],
    ]);

    const { body: proposal } = await propose(result.previewId, 'p-1').expect(
      201,
    );
    expect(proposal).toMatchObject({
      worksheetId,
      baseRevisionId: SECOND_REVISION_ID,
      draftVersion: 1,
      status: 'draft',
    });
    const { body: draft } = await client()
      .rest()
      .get(`${base()}/changesets/${proposal.id}`)
      .expect(200);
    expect(draft.changeset).toMatchObject({ source: 'ai', status: 'draft' });
    expect(draft.changeset.operations).toEqual([
      {
        type: 'set_cell',
        rowId: ROW_IDS.a,
        columnId: col.price,
        value: '11.03',
      },
      {
        type: 'set_cell',
        rowId: ROW_IDS.b,
        columnId: col.price,
        value: '12.60',
      },
      {
        type: 'set_cell',
        rowId: ROW_IDS.e,
        columnId: col.price,
        value: '1.58',
      },
    ]);
    // La hoja sigue igual: aplicar es de la persona, por el flujo de borradores.
    expect(await liveValues()).toEqual(before);

    // Repetir con la misma clave devuelve el mismo borrador.
    const { body: again } = await propose(result.previewId, 'p-1').expect(201);
    expect(again.id).toBe(proposal.id);
    const reused = await propose(result.previewId, 'p-1', 'Otro texto').expect(
      422,
    );
    expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    const used = await propose(result.previewId, 'p-2').expect(409);
    expect(used.body.code).toBe('AI_SHEET_PREVIEW_ALREADY_USED');
  });

  it('la vista previa pagina el diff completo', async () => {
    const result = await previewOfRows([ROW_IDS.a, ROW_IDS.b, ROW_IDS.e]);

    const { body } = await client()
      .rest()
      .get(`${sheet()}/transform-previews/${result.previewId}?limit=2&offset=1`)
      .expect(200);

    expect(body.items.map((change: { rowId: string }) => change.rowId)).toEqual(
      [ROW_IDS.b, ROW_IDS.e],
    );
    expect(body.page).toEqual({ limit: 2, offset: 1, hasMore: false });
  });

  it('una selección por filtro, las otras transformaciones y las celdas con problemas', async () => {
    const { body: byFilter } = await select(
      {
        kind: 'allMatchingFilter',
        filter: { column: col.sku, op: 'contains', value: '-' },
      },
      [col.sku, col.price],
    ).expect(201);
    expect(byFilter.rowCount).toBe(3);

    const { body: mapped } = await preview(
      byFilter.selectionId,
      { kind: 'map_values', pairs: [{ from: 'A-001', to: 'A-100' }] },
      [col.sku],
    ).expect(201);
    expect(mapped.sample).toEqual([
      { rowId: ROW_IDS.a, columnId: col.sku, before: 'A-001', after: 'A-100' },
    ]);

    // D tiene un precio mal guardado: se cuenta y no se puede proponer.
    // Con A (válida) y D (precio mal guardado): un cambio y un problema.
    const broken = await previewOfRows([ROW_IDS.a, ROW_IDS.d]);
    expect(broken).toMatchObject({
      affectedCells: 1,
      issueCount: 1,
      canCreateProposal: false,
    });
    const invalid = await propose(broken.previewId, 'p-d').expect(422);
    expect(invalid.body.code).toBe('AI_SHEET_PREVIEW_INVALID');

    // Recortar texto no se aplica a un decimal.
    const { body: selection } = await select({
      kind: 'selectedRows',
      rowIds: [ROW_IDS.a],
    }).expect(201);
    const trimmed = await preview(selection.selectionId, {
      kind: 'trim_text',
    }).expect(400);
    expect(trimmed.body.code).toBe('VALIDATION_FAILED');
    const outside = await preview(selection.selectionId, FIVE_PERCENT, [
      col.sku,
    ]).expect(404);
    expect(outside.body.code).toBe('AI_SHEET_SELECTION_COLUMN_NOT_FOUND');
  });

  it('valida la selección: filas borradas, sin filtro, límites y transformaciones mal formadas', async () => {
    const deleted = await select({
      kind: 'selectedRows',
      rowIds: [ROW_IDS.a, ROW_IDS.c],
    }).expect(404);
    expect(deleted.body.code).toBe('AI_SHEET_SELECTION_ROW_NOT_FOUND');

    const noFilter = await select({ kind: 'allMatchingFilter' }).expect(400);
    expect(noFilter.body.code).toBe('VALIDATION_FAILED');
    const badFilter = await select({
      kind: 'allMatchingFilter',
      filter: { column: col.sku, op: 'between', value: 1 },
    }).expect(400);
    expect(badFilter.body.code).toBe('VALIDATION_FAILED');

    const tooMany = await select({
      kind: 'selectedRows',
      rowIds: Array.from({ length: 201 }, () => randomUUID()),
    }).expect(422);
    expect(tooMany.body.code).toBe('AI_SHEET_TRANSFORM_LIMIT');

    const { body: selection } = await select({
      kind: 'selectedRows',
      rowIds: [ROW_IDS.a],
    }).expect(201);
    for (const transform of [
      { kind: 'percentage', rate: '5%', scale: 2, rounding: 'half_up' },
      { kind: 'percentage', rate: '5', scale: 9, rounding: 'half_up' },
      { kind: 'trim_text', extra: true },
      { kind: 'borrar_todo' },
    ]) {
      const { body } = await preview(selection.selectionId, transform).expect(
        400,
      );
      expect(body.code).toBe('VALIDATION_FAILED');
    }
  });

  it('si la hoja cambia o la vista previa caduca, la propuesta se rechaza', async () => {
    const stale = await previewOfRows([ROW_IDS.a]);
    // Otra revisión pasa a ser la vigente.
    const newHead = randomUUID();
    await pool.query(
      `INSERT INTO estadistica_forms.worksheet_revisions
         (id, organization_id, worksheet_id, sequence, schema_version, source,
          row_count, created_by, created_at)
       VALUES ($1, $2, $3, 3, 1, 'changeset', 4, $4, now())`,
      [newHead, organizationId, worksheetId, aliceId],
    );
    await pool.query(
      `UPDATE estadistica_forms.worksheets SET head_revision_id = $2, generation = 3 WHERE id = $1`,
      [worksheetId, newHead],
    );
    const staleResponse = await propose(stale.previewId, 'p-stale').expect(409);
    expect(staleResponse.body.code).toBe('AI_SHEET_PREVIEW_STALE');

    await pool.query(
      `UPDATE estadistica_forms.worksheets SET head_revision_id = $2, generation = 2 WHERE id = $1`,
      [worksheetId, SECOND_REVISION_ID],
    );
    const expiring = await previewOfRows([ROW_IDS.b]);
    await pool.query(
      `UPDATE estadistica_forms.worksheet_transform_previews
       SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [expiring.previewId],
    );
    const expired = await propose(expiring.previewId, 'p-expired').expect(409);
    expect(expired.body.code).toBe('AI_SHEET_PREVIEW_EXPIRED');
  });

  it('permisos: un Viewer no transforma, la selección de otra persona no existe y lo ajeno da 404', async () => {
    const anonymous = await client()
      .rest('')
      .post(`${sheet()}/selections`)
      .send({});
    expect(anonymous.status).toBe(401);

    const foreign = await select(
      { kind: 'selectedRows', rowIds: [ROW_IDS.a] },
      [col.price],
      'bob-session',
    ).expect(404);
    expect(foreign.body.code).toBe('WORKSHEET_NOT_FOUND');

    await setRole(pool, organizationId, bobId, 'viewer');
    const viewer = await select(
      { kind: 'selectedRows', rowIds: [ROW_IDS.a] },
      [col.price],
      'bob-session',
    ).expect(403);
    expect(viewer.body.code).toBe('FORBIDDEN');

    await setRole(pool, organizationId, bobId, 'editor');
    const { body: mine } = await select({
      kind: 'selectedRows',
      rowIds: [ROW_IDS.a],
    }).expect(201);
    const othersSelection = await client()
      .rest('bob-session')
      .post(`${sheet()}/transform-previews`)
      .send({
        selectionId: mine.selectionId,
        columnIds: [col.price],
        transform: FIVE_PERCENT,
      })
      .expect(404);
    expect(othersSelection.body.code).toBe('AI_SHEET_SELECTION_NOT_FOUND');

    await client().rest().post(`${sheet()}/archive`).expect(200);
    const archived = await select({
      kind: 'selectedRows',
      rowIds: [ROW_IDS.a],
    }).expect(409);
    expect(archived.body.code).toBe('WORKSHEET_ARCHIVED');
  });

  it('GraphQL hace el mismo recorrido, con la clave de idempotencia como campo', async () => {
    const { ok } = client();
    const scope = { organizationId, projectId, worksheetId };
    const { createWorksheetSelection } = await ok(
      `mutation($organizationId: ID!, $projectId: ID!, $worksheetId: ID!, $input: CreateWorksheetSelectionInput!) {
        createWorksheetSelection(organizationId: $organizationId, projectId: $projectId, worksheetId: $worksheetId, input: $input) {
          selectionId rowCount
        }
      }`,
      {
        ...scope,
        input: {
          revisionId: SECOND_REVISION_ID,
          columnIds: [col.price],
          rows: { kind: 'selectedRows', rowIds: [ROW_IDS.a, ROW_IDS.b] },
        },
      },
    );
    const { previewWorksheetTransform } = await ok(
      `mutation($organizationId: ID!, $projectId: ID!, $worksheetId: ID!, $input: PreviewWorksheetTransformInput!) {
        previewWorksheetTransform(organizationId: $organizationId, projectId: $projectId, worksheetId: $worksheetId, input: $input) {
          previewId affectedCells canCreateProposal sample { rowId after }
        }
      }`,
      {
        ...scope,
        input: {
          selectionId: createWorksheetSelection.selectionId,
          columnIds: [col.price],
          transform: FIVE_PERCENT,
        },
      },
    );
    expect(previewWorksheetTransform).toMatchObject({
      affectedCells: 2,
      canCreateProposal: true,
      sample: [
        { rowId: ROW_IDS.a, after: '11.03' },
        { rowId: ROW_IDS.b, after: '12.60' },
      ],
    });
    const { createWorksheetChangeProposal } = await ok(
      `mutation($organizationId: ID!, $projectId: ID!, $worksheetId: ID!, $input: CreateWorksheetChangeProposalInput!) {
        createWorksheetChangeProposal(organizationId: $organizationId, projectId: $projectId, worksheetId: $worksheetId, input: $input) {
          id status draftVersion
        }
      }`,
      {
        ...scope,
        input: {
          previewId: previewWorksheetTransform.previewId,
          explanation: 'Subir 5 %',
          idempotencyKey: 'gql-1',
        },
      },
    );
    expect(createWorksheetChangeProposal).toMatchObject({
      status: 'draft',
      draftVersion: 1,
    });
  });
});
