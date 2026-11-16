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
import { CatalogImportWorker } from '../../../src/catalog-import/catalog-import.worker.js';
import {
  clientsFor,
  seedTwoOrganizations,
  setRole,
  startGraphqlApp,
} from './support/graphql-test-app.js';

const PAGE = 'page { limit offset hasMore }';
const SCOPE = '$organizationId: ID!, $projectId: ID!';
const IN_SCOPE = 'organizationId: $organizationId, projectId: $projectId';
const WORKSHEET_FIELDS = `
  id workbookId name mode schemaVersion generation createdAt archivedAt workbookArchivedAt
  headRevision { id sequence rowCount createdAt }
  duplicatedFrom { worksheetId revisionId }
  openedFromCatalog { snapshotId }
  columns { id name type position required options formula }
  capabilities { write approve }`;
const CHANGESET_FIELDS = `
  id worksheetId authorId source title status draftVersion baseRevisionId
  baseSequence baseSchemaVersion contentHash appliedRevisionId createdAt updatedAt operations`;

const CREATE_WORKBOOK = `
  mutation($organizationId: ID!, $projectId: ID!, $name: String!) {
    createWorkbook(${IN_SCOPE}, input: { name: $name }) { id projectId name createdAt archivedAt }
  }`;
const CREATE_WORKSHEET = `
  mutation(${SCOPE}, $workbookId: ID!, $input: CreateWorksheetInput!) {
    createWorksheet(${IN_SCOPE}, workbookId: $workbookId, input: $input) { ${WORKSHEET_FIELDS} }
  }`;
const CREATE_CHANGESET = `
  mutation(${SCOPE}, $worksheetId: ID!, $title: String!) {
    createChangeset(${IN_SCOPE}, worksheetId: $worksheetId, input: { title: $title }) { ${CHANGESET_FIELDS} }
  }`;
const SAVE_OPERATIONS = `
  mutation(${SCOPE}, $id: ID!, $input: SaveOperationsInput!) {
    saveChangesetOperations(${IN_SCOPE}, id: $id, input: $input) {
      ${CHANGESET_FIELDS}
      diff { baseRevisionId headRevisionId contentHash entries counts resultingRowCount problems { rowId columnId code } columnConversions }
    }
  }`;
const SUBMIT = `
  mutation(${SCOPE}, $id: ID!, $draftVersion: Int!) {
    submitChangeset(${IN_SCOPE}, id: $id, input: { draftVersion: $draftVersion }) { ${CHANGESET_FIELDS} }
  }`;
const DECIDE = `
  mutation(${SCOPE}, $id: ID!, $input: DecisionInput!) {
    decideChangeset(${IN_SCOPE}, id: $id, input: $input) {
      decision { id actorId decision contentHash draftVersion headRevisionId policy reason createdAt }
      changeset { ${CHANGESET_FIELDS} }
    }
  }`;
const APPLY = `
  mutation(${SCOPE}, $id: ID!, $input: ApplyChangesetInput!) {
    applyChangeset(${IN_SCOPE}, id: $id, input: $input) { changesetId revisionId sequence }
  }`;
const ROWS = `
  query(${SCOPE}, $id: ID!, $filter: JSONObject, $sort: [SortTermInput!], $columns: [ID!], $viewId: ID, $limit: Int, $cursor: String) {
    worksheet(${IN_SCOPE}, id: $id) {
      rows(filter: $filter, sort: $sort, columns: $columns, viewId: $viewId, limit: $limit, cursor: $cursor) {
        items nextCursor revisionId schemaVersion
      }
    }
  }`;
const HISTORY = `
  query(${SCOPE}, $id: ID!) {
    worksheet(${IN_SCOPE}, id: $id) {
      revisions { items { id sequence schemaVersion source rowCount changesetId createdBy createdAt } ${PAGE} }
      changesets { items { id status title operationCount draftVersion } ${PAGE} }
      applied: changesets(status: "applied") { items { id } }
      exports { items { id rowCount format checksum } ${PAGE} }
      importMappings { items { id name mapping } ${PAGE} }
      savedViews { items { id name visibility query canEdit } ${PAGE} }
    }
  }`;

/** Las operaciones de la prueba: tres filas con su SKU y su precio. */
function insertRows(sku: string, price: string) {
  return [
    ['A-1', '10.00'],
    ['B-2', '30.00'],
    ['C-3', '20.00'],
  ].map(([code, amount], index) => ({
    type: 'insert_row',
    rowId: randomUUID(),
    sortKey: String.fromCharCode(97 + index),
    values: { [sku]: code, [price]: amount },
  }));
}

/**
 * C7.4: hojas por GraphQL. El recorrido entero (libro, hoja, borrador,
 * aplicar, vista y catálogo) por GraphQL tiene que dejar lo mismo que REST.
 */
describe('GraphQL C7.4: hojas, borradores, vistas y catálogo', () => {
  let app: INestApplication;
  let pool: Pool;
  let close: () => Promise<void>;
  let projectId: string;
  let organizationId: string;
  let bobId: string;

  const client = () => clientsFor(app);
  const scope = () => ({ organizationId, projectId });
  const base = () =>
    `/api/v1/organizations/${organizationId}/projects/${projectId}`;

  /** Un libro y una hoja con SKU (obligatorio) y precio, por GraphQL. */
  async function newWorksheet() {
    const { ok } = client();
    const { createWorkbook } = await ok(CREATE_WORKBOOK, {
      ...scope(),
      name: 'Proveedores',
    });
    const { createWorksheet } = await ok(CREATE_WORKSHEET, {
      ...scope(),
      workbookId: createWorkbook.id,
      input: {
        name: 'Inventario',
        columns: [
          { name: 'SKU', type: 'text', required: true },
          { name: 'Precio', type: 'decimal' },
        ],
      },
    });
    const [sku, price] = createWorksheet.columns.map(
      (column: { id: string }) => column.id,
    );
    return { workbook: createWorkbook, worksheet: createWorksheet, sku, price };
  }

  /** Borrador con tres filas → enviado → aceptado → aplicado, todo por GraphQL. */
  async function applyThreeRows(
    worksheetId: string,
    sku: string,
    price: string,
  ) {
    const { ok } = client();
    const { createChangeset } = await ok(CREATE_CHANGESET, {
      ...scope(),
      worksheetId,
      title: 'Filas iniciales',
    });
    const { saveChangesetOperations: saved } = await ok(SAVE_OPERATIONS, {
      ...scope(),
      id: createChangeset.id,
      input: {
        draftVersion: createChangeset.draftVersion,
        operations: insertRows(sku, price),
      },
    });
    const { submitChangeset: submitted } = await ok(SUBMIT, {
      ...scope(),
      id: saved.id,
      draftVersion: saved.draftVersion,
    });
    const { decideChangeset } = await ok(DECIDE, {
      ...scope(),
      id: submitted.id,
      input: {
        decision: 'accept',
        contentHash: submitted.contentHash,
        draftVersion: submitted.draftVersion,
        expectedHeadRevisionId: submitted.baseRevisionId,
      },
    });
    const input = {
      contentHash: submitted.contentHash,
      expectedHeadRevisionId: submitted.baseRevisionId,
      idempotencyKey: `aplicar-${submitted.id}`,
    };
    const { applyChangeset } = await ok(APPLY, {
      ...scope(),
      id: submitted.id,
      input,
    });
    return { saved, submitted, decideChangeset, applyChangeset, input };
  }

  beforeAll(async () => {
    ({ app, pool, close } = await startGraphqlApp());
  });
  beforeEach(async () => {
    ({ projectId, organizationId, bobId } = await seedTwoOrganizations(
      app,
      pool,
    ));
  });
  afterAll(async () => {
    await close?.();
  });

  it('crear hoja → borrador → aplicar por GraphQL deja lo mismo que REST', async () => {
    const { rest, ok } = client();
    const { workbook, worksheet, sku, price } = await newWorksheet();
    expect(worksheet.capabilities).toEqual({ write: true, approve: true });

    const { body: restSheet } = await rest()
      .get(`${base()}/worksheets/${worksheet.id}`)
      .expect(200);
    expect(worksheet).toEqual({
      ...restSheet.worksheet,
      headRevision: {
        id: restSheet.worksheet.headRevision.id,
        sequence: restSheet.worksheet.headRevision.sequence,
        rowCount: restSheet.worksheet.headRevision.rowCount,
        createdAt: restSheet.worksheet.headRevision.createdAt,
      },
      columns: restSheet.worksheet.columns.map(
        (column: Record<string, unknown>) => ({
          options: null,
          formula: null,
          ...column,
        }),
      ),
      capabilities: restSheet.capabilities,
    });

    const { saved, submitted, decideChangeset, applyChangeset, input } =
      await applyThreeRows(worksheet.id, sku, price);

    // El borrador guardado y su diff, como por REST.
    const { body: restDiff } = await rest()
      .get(`${base()}/changesets/${saved.id}/diff`)
      .expect(200);
    expect(saved.operations).toHaveLength(3);
    expect(saved.diff.resultingRowCount).toBe(3);
    expect(decideChangeset.decision).toMatchObject({
      decision: 'accept',
      policy: 'single_member',
    });
    expect(decideChangeset.changeset.status).toBe('approved');
    expect(applyChangeset).toMatchObject({
      changesetId: saved.id,
      sequence: 2,
    });
    const { body: restChangeset } = await rest()
      .get(`${base()}/changesets/${saved.id}`)
      .expect(200);
    expect(restChangeset.changeset).toMatchObject({
      status: 'applied',
      appliedRevisionId: applyChangeset.revisionId,
      contentHash: submitted.contentHash,
    });
    // El diff de lo enviado no cambia al aplicarlo: el contenido es el mismo.
    expect(restDiff.review.contentHash).toBe(submitted.contentHash);

    // Aplicar otra vez con la misma clave no aplica nada nuevo.
    const again = await ok(APPLY, { ...scope(), id: saved.id, input });
    expect(again.applyChangeset).toEqual(applyChangeset);

    // Filas con orden y columnas, como `rows/query`.
    const query = {
      sort: [{ columnId: price, direction: 'desc' }],
      columns: [sku],
      limit: 2,
    };
    const { worksheet: sorted } = await ok(ROWS, {
      ...scope(),
      id: worksheet.id,
      ...query,
    });
    const { body: restRows } = await rest()
      .post(`${base()}/worksheets/${worksheet.id}/rows/query`)
      .send(query)
      .expect(200);
    expect(sorted.rows).toEqual(restRows);
    expect(
      sorted.rows.items.map(
        (row: { values: Record<string, string> }) => row.values[sku],
      ),
    ).toEqual(['B-2', 'C-3']);

    // Con filtro (un árbol del dominio en `JSONObject`).
    const filter = { column: sku, op: 'equals', value: 'A-1' };
    const { worksheet: filtered } = await ok(ROWS, {
      ...scope(),
      id: worksheet.id,
      filter,
    });
    const { body: restFiltered } = await rest()
      .post(`${base()}/worksheets/${worksheet.id}/rows/query`)
      .send({ filter })
      .expect(200);
    expect(filtered.rows).toEqual(restFiltered);
    expect(filtered.rows.items).toHaveLength(1);

    // El libro con sus hojas y el proyecto con sus libros.
    const { project } = await ok(
      `query($id: ID!) { project(id: $id) { workbooks(limit: 5) { items { id name worksheets { items { id name headRevision { sequence rowCount } } ${PAGE} } archivedSheets: worksheets(archived: true) { items { id } } } } } }`,
      { id: projectId },
    );
    const { body: restWorksheets } = await rest()
      .get(`${base()}/workbooks/${workbook.id}/worksheets`)
      .expect(200);
    expect(project.workbooks.items).toEqual([
      {
        id: workbook.id,
        name: 'Proveedores',
        worksheets: {
          items: restWorksheets.worksheets.map(
            (sheet: Record<string, any>) => ({
              id: sheet.id,
              name: sheet.name,
              headRevision: {
                sequence: sheet.headRevision.sequence,
                rowCount: sheet.headRevision.rowCount,
              },
            }),
          ),
          page: restWorksheets.page,
        },
        archivedSheets: { items: [] },
      },
    ]);
    expect(
      project.workbooks.items[0].worksheets.items[0].headRevision.rowCount,
    ).toBe(3);
  });

  it('vista guardada, exportación, plantilla e historial, como REST', async () => {
    const { rest, ok } = client();
    const { worksheet, sku, price } = await newWorksheet();
    await applyThreeRows(worksheet.id, sku, price);
    const sheetScope = { ...scope(), worksheetId: worksheet.id };

    const { saveView } = await ok(
      `mutation(${SCOPE}, $worksheetId: ID!, $input: SaveViewInput!) {
        saveView(${IN_SCOPE}, worksheetId: $worksheetId, input: $input) { id name visibility query canEdit }
      }`,
      {
        ...sheetScope,
        input: {
          name: 'Más caros',
          visibility: 'team',
          query: {
            sort: [{ columnId: price, direction: 'desc' }],
            columns: [sku],
          },
        },
      },
    );
    expect(saveView).toMatchObject({ visibility: 'team', canEdit: true });
    const withView = await ok(ROWS, {
      ...scope(),
      id: worksheet.id,
      viewId: saveView.id,
    });
    const withQuery = await ok(ROWS, {
      ...scope(),
      id: worksheet.id,
      sort: [{ columnId: price, direction: 'desc' }],
      columns: [sku],
    });
    expect(withView.worksheet.rows).toEqual(withQuery.worksheet.rows);

    const { exportWorksheet } = await ok(
      `mutation(${SCOPE}, $worksheetId: ID!, $input: ExportWorksheetInput!) {
        exportWorksheet(${IN_SCOPE}, worksheetId: $worksheetId, input: $input) {
          downloadUrl export { id rowCount columnCount format checksum query options }
        }
      }`,
      {
        ...sheetScope,
        input: {
          format: 'csv',
          filter: { column: sku, op: 'equals', value: 'B-2' },
        },
      },
    );
    expect(exportWorksheet.export).toMatchObject({
      rowCount: 1,
      format: 'csv',
    });
    const { body: restExport } = await rest()
      .get(`${base()}/worksheet-exports/${exportWorksheet.export.id}`)
      .expect(200);
    expect(exportWorksheet.export.checksum).toBe(restExport.export.checksum);
    await rest().get(exportWorksheet.downloadUrl).expect(200);

    const mapping = {
      mode: 'append',
      columns: [{ header: 'Código', columnId: sku }],
    };
    const { createImportMapping } = await ok(
      `mutation(${SCOPE}, $worksheetId: ID!, $input: CreateImportMappingInput!) {
        createImportMapping(${IN_SCOPE}, worksheetId: $worksheetId, input: $input) { id name mapping }
      }`,
      { ...sheetScope, input: { name: 'Proveedor', mapping } },
    );
    const { body: restMapping } = await rest()
      .get(`${base()}/import-mappings/${createImportMapping.id}`)
      .expect(200);
    expect(createImportMapping.mapping).toEqual(
      restMapping.importMapping.mapping,
    );

    // Un borrador abierto además del aplicado, para que el filtro por estado cuente.
    await ok(CREATE_CHANGESET, {
      ...scope(),
      worksheetId: worksheet.id,
      title: 'Abierto',
    });
    const { worksheet: history } = await ok(HISTORY, {
      ...scope(),
      id: worksheet.id,
    });
    const get = async (path: string) =>
      (
        await rest()
          .get(`${base()}/worksheets/${worksheet.id}/${path}`)
          .expect(200)
      ).body;
    const revisions = await get('revisions');
    expect(history.revisions).toEqual({
      items: revisions.revisions,
      page: revisions.page,
    });
    const changesets = await get('changesets');
    expect(history.changesets.items).toEqual(
      changesets.changesets.map((item: Record<string, unknown>) => ({
        id: item.id,
        status: item.status,
        title: item.title,
        operationCount: item.operationCount,
        draftVersion: item.draftVersion,
      })),
    );
    const applied = await get('changesets?status=applied');
    expect(history.changesets.items).toHaveLength(2);
    expect(history.applied.items).toEqual(
      applied.changesets.map((item: { id: string }) => ({ id: item.id })),
    );
    expect(history.applied.items).toHaveLength(1);
    const exports = await get('exports');
    expect(
      history.exports.items.map((item: { id: string }) => item.id),
    ).toEqual(exports.exports.map((item: { id: string }) => item.id));
    const mappings = await get('import-mappings');
    expect(history.importMappings.items).toEqual(
      mappings.importMappings.map((item: Record<string, unknown>) => ({
        id: item.id,
        name: item.name,
        mapping: item.mapping,
      })),
    );
    const views = await get('saved-views');
    expect(history.savedViews.items).toEqual(
      views.savedViews.map((view: Record<string, unknown>) => ({
        id: view.id,
        name: view.name,
        visibility: view.visibility,
        query: view.query,
        canEdit: view.canEdit,
      })),
    );

    // Borrar plantilla y vista, como `DELETE`.
    const removed = await ok(
      `mutation(${SCOPE}, $mapping: ID!, $view: ID!) {
        deleteImportMapping(${IN_SCOPE}, id: $mapping)
        deleteSavedView(${IN_SCOPE}, id: $view)
      }`,
      { ...scope(), mapping: createImportMapping.id, view: saveView.id },
    );
    expect(removed).toEqual({
      deleteImportMapping: true,
      deleteSavedView: true,
    });
    await rest()
      .get(`${base()}/import-mappings/${createImportMapping.id}`)
      .expect(404);
    await rest().get(`${base()}/saved-views/${saveView.id}`).expect(404);
  });

  it('llevar la hoja al catálogo y abrir el catálogo como hoja nueva', async () => {
    const { rest, ok } = client();
    const { workbook, worksheet, sku, price } = await newWorksheet();
    await applyThreeRows(worksheet.id, sku, price);

    const { sendWorksheetToCatalog } = await ok(
      `mutation(${SCOPE}, $worksheetId: ID!, $input: SendWorksheetToCatalogInput!) {
        sendWorksheetToCatalog(${IN_SCOPE}, worksheetId: $worksheetId, input: $input) {
          snapshotId jobId status statusUrl
          catalogSnapshot { snapshotId worksheetId revisionSequence idColumnId rowCount columns query }
        }
      }`,
      { ...scope(), worksheetId: worksheet.id, input: { idColumnId: sku } },
    );
    expect(sendWorksheetToCatalog).toMatchObject({
      status: 'queued',
      catalogSnapshot: { rowCount: 3, revisionSequence: 2, idColumnId: sku },
    });
    const snapshotId = sendWorksheetToCatalog.snapshotId as string;
    const { body: restSnapshot } = await rest()
      .get(`${base()}/worksheet-catalog-snapshots/${snapshotId}`)
      .expect(200);
    const { worksheetCatalogSnapshot } = await ok(
      `query(${SCOPE}, $id: ID!) {
        worksheetCatalogSnapshot(${IN_SCOPE}, id: $id) {
          snapshotId worksheetId revisionId revisionSequence createdBy idColumnId columns query serializerVersion rowCount sourceHash createdAt
        }
      }`,
      { ...scope(), id: snapshotId },
    );
    expect(worksheetCatalogSnapshot).toEqual(restSnapshot.catalogSnapshot);
    await app.get(CatalogImportWorker).runUntilIdle();

    const { openCatalogAsWorksheet } = await ok(
      `mutation(${SCOPE}, $workbookId: ID!, $input: OpenCatalogAsWorksheetInput!) {
        openCatalogAsWorksheet(${IN_SCOPE}, workbookId: $workbookId, input: $input) {
          id name openedFromCatalog { snapshotId } headRevision { sequence rowCount }
          columns { name required }
        }
      }`,
      {
        ...scope(),
        workbookId: workbook.id,
        input: { name: 'Desde el catálogo', snapshotId },
      },
    );
    expect(openCatalogAsWorksheet).toMatchObject({
      openedFromCatalog: { snapshotId },
      headRevision: { sequence: 1, rowCount: 3 },
    });
  });

  it('renombrar, duplicar, archivar y restaurar, y revertir una revisión', async () => {
    const { rest, ok, failure } = client();
    const { workbook, worksheet, sku, price } = await newWorksheet();
    const { applyChangeset } = await applyThreeRows(worksheet.id, sku, price);
    const id = { ...scope(), id: worksheet.id };

    const renamed = await ok(
      `mutation(${SCOPE}, $id: ID!) { renameWorksheet(${IN_SCOPE}, id: $id, input: { name: "  Precios  " }) { name } }`,
      id,
    );
    expect(renamed.renameWorksheet.name).toBe('Precios');

    const { duplicateWorksheet } = await ok(
      `mutation(${SCOPE}, $id: ID!) {
        duplicateWorksheet(${IN_SCOPE}, id: $id, input: { name: "Copia" }) {
          id duplicatedFrom { worksheetId revisionId } headRevision { rowCount }
        }
      }`,
      id,
    );
    expect(duplicateWorksheet).toMatchObject({
      duplicatedFrom: {
        worksheetId: worksheet.id,
        revisionId: applyChangeset.revisionId,
      },
      headRevision: { rowCount: 3 },
    });

    const archived = await ok(
      `mutation(${SCOPE}, $id: ID!) { archiveWorksheet(${IN_SCOPE}, id: $id) { archivedAt capabilities { write } } }`,
      id,
    );
    expect(archived.archiveWorksheet.archivedAt).not.toBeNull();
    const blocked = await failure(CREATE_CHANGESET, {
      ...scope(),
      worksheetId: worksheet.id,
      title: 'No',
    });
    const { body: restBlocked } = await rest()
      .post(`${base()}/worksheets/${worksheet.id}/changesets`)
      .send({ title: 'No' })
      .expect(409);
    expect(blocked.extensions.code).toBe(restBlocked.code);
    const restored = await ok(
      `mutation(${SCOPE}, $id: ID!) { restoreWorksheet(${IN_SCOPE}, id: $id) { archivedAt } }`,
      id,
    );
    expect(restored.restoreWorksheet.archivedAt).toBeNull();

    const book = await ok(
      `mutation(${SCOPE}, $id: ID!) {
        renamed: renameWorkbook(${IN_SCOPE}, id: $id, input: { name: "Otro" }) { name }
        archived: archiveWorkbook(${IN_SCOPE}, id: $id) { archivedAt }
        restored: restoreWorkbook(${IN_SCOPE}, id: $id) { archivedAt }
      }`,
      { ...scope(), id: workbook.id },
    );
    expect(book.renamed.name).toBe('Otro');
    expect(book.archived.archivedAt).not.toBeNull();
    expect(book.restored.archivedAt).toBeNull();

    const { proposeRevert } = await ok(
      `mutation(${SCOPE}, $revisionId: ID!) { proposeRevert(${IN_SCOPE}, revisionId: $revisionId) { id source status operations } }`,
      { ...scope(), revisionId: applyChangeset.revisionId },
    );
    expect(proposeRevert).toMatchObject({ source: 'revert', status: 'draft' });
    expect(proposeRevert.operations).toHaveLength(3);
  });

  it('un borrador que se queda atrás se pone al día con rebaseChangeset', async () => {
    const { ok } = client();
    const { worksheet, sku, price } = await newWorksheet();
    const { createChangeset: late } = await ok(CREATE_CHANGESET, {
      ...scope(),
      worksheetId: worksheet.id,
      title: 'Tarde',
    });
    const { applyChangeset } = await applyThreeRows(worksheet.id, sku, price);

    const { rebaseChangeset } = await ok(
      `mutation(${SCOPE}, $id: ID!, $input: RebaseInput!) {
        rebaseChangeset(${IN_SCOPE}, id: $id, input: $input) { id status baseRevisionId draftVersion }
      }`,
      { ...scope(), id: late.id, input: { draftVersion: late.draftVersion } },
    );
    expect(rebaseChangeset.baseRevisionId).toBe(applyChangeset.revisionId);
    expect(rebaseChangeset.draftVersion).toBeGreaterThan(late.draftVersion);
  });

  it('la profundidad máxima (8) deja pasar las lecturas compuestas y corta lo más hondo', async () => {
    const { ok, gql } = client();
    await newWorksheet();

    // 7 niveles: el proyecto con sus libros y las hojas de cada libro.
    await ok(
      `query($id: ID!) { project(id: $id) { workbooks { items { worksheets { items { headRevision { sequence } } } } } } }`,
      { id: projectId },
    );
    // 7 niveles: cada evaluación con los textos de su «Requiere atención».
    await ok(
      `query($id: ID!) { project(id: $id) { evaluations { items { attention { problemGroups { problem { es } } } } } } }`,
      { id: projectId },
    );

    // 9 niveles: se rechaza antes de ejecutar nada.
    const { status, body } = await gql(
      `query($p: ID!, $e: ID!) {
        export(projectId: $p, id: $e) { product(id: "x") { source { export {
          product(id: "y") { source { export { product(id: "z") { columns } } } }
        } } } }
      }`,
      { p: projectId, e: randomUUID() },
    );
    expect(status).toBe(400);
    expect(body.data).toBeUndefined();
    expect(body.errors[0].extensions.code).toBe('BAD_REQUEST');
  });

  describe('errores como en REST', () => {
    it('columnas, versión del borrador, clave de idempotencia, filtro y vista', async () => {
      const { rest, ok, failure } = client();
      const { workbook, worksheet, sku, price } = await newWorksheet();

      const columns = [{ name: '', type: 'color' }];
      const badSheet = await failure(CREATE_WORKSHEET, {
        ...scope(),
        workbookId: workbook.id,
        input: { name: 'Mal', columns },
      });
      const { body: restBadSheet } = await rest()
        .post(`${base()}/workbooks/${workbook.id}/worksheets`)
        .send({ name: 'Mal', columns })
        .expect(400);
      expect(badSheet.extensions.issues).toEqual(restBadSheet.issues);

      const { createChangeset } = await ok(CREATE_CHANGESET, {
        ...scope(),
        worksheetId: worksheet.id,
        title: 'Borrador',
      });
      const stale = await failure(SAVE_OPERATIONS, {
        ...scope(),
        id: createChangeset.id,
        input: {
          draftVersion: createChangeset.draftVersion + 5,
          operations: [],
        },
      });
      const { body: restStale } = await rest()
        .put(`${base()}/changesets/${createChangeset.id}/operations`)
        .set('If-Match', `"${createChangeset.draftVersion + 5}"`)
        .send({ operations: [] });
      expect(stale.extensions.code).toBe(restStale.code);

      const badOperation = await failure(SAVE_OPERATIONS, {
        ...scope(),
        id: createChangeset.id,
        input: {
          draftVersion: createChangeset.draftVersion,
          operations: [
            { type: 'set_cell', rowId: 'no', columnId: sku, value: 1 },
          ],
        },
      });
      const { body: restBadOperation } = await rest()
        .put(`${base()}/changesets/${createChangeset.id}/operations`)
        .set('If-Match', `"${createChangeset.draftVersion}"`)
        .send({
          operations: [
            { type: 'set_cell', rowId: 'no', columnId: sku, value: 1 },
          ],
        });
      expect(badOperation.extensions.code).toBe(restBadOperation.code);
      expect(badOperation.extensions.issues).toEqual(restBadOperation.issues);

      const { submitted } = await applyThreeRows(worksheet.id, sku, price).then(
        (result) => result,
      );
      const noKey = await failure(APPLY, {
        ...scope(),
        id: submitted.id,
        input: {
          contentHash: submitted.contentHash,
          expectedHeadRevisionId: submitted.baseRevisionId,
          idempotencyKey: '   ',
        },
      });
      expect(noKey.extensions.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

      const filter = { column: sku, op: 'between', value: 3 };
      const badFilter = await failure(ROWS, {
        ...scope(),
        id: worksheet.id,
        filter,
      });
      const { body: restBadFilter } = await rest()
        .post(`${base()}/worksheets/${worksheet.id}/rows/query`)
        .send({ filter })
        .expect(400);
      expect(badFilter.extensions.code).toBe(restBadFilter.code);
      expect(badFilter.extensions.issues).toEqual(restBadFilter.issues);

      const query = { sort: [{ columnId: 'no-es-uuid', direction: 'up' }] };
      const badView = await failure(
        `mutation(${SCOPE}, $worksheetId: ID!, $input: SaveViewInput!) {
          saveView(${IN_SCOPE}, worksheetId: $worksheetId, input: $input) { id }
        }`,
        {
          ...scope(),
          worksheetId: worksheet.id,
          input: { name: 'Mal', visibility: 'personal', query },
        },
      );
      const { body: restBadView } = await rest()
        .post(`${base()}/worksheets/${worksheet.id}/saved-views`)
        .send({ name: 'Mal', visibility: 'personal', query })
        .expect(400);
      expect(badView.extensions.issues).toEqual(restBadView.issues);
      expect(
        badView.extensions.issues.map(
          (issue: { field: string }) => issue.field,
        ),
      ).toEqual(
        expect.arrayContaining([
          'query.sort.0.columnId',
          'query.sort.0.direction',
        ]),
      );

      const missing = await failure(
        `query(${SCOPE}, $id: ID!) { changeset(${IN_SCOPE}, id: $id) { id } }`,
        { ...scope(), id: randomUUID() },
      );
      expect(missing.extensions.code).toBe('CHANGESET_NOT_FOUND');
    });
  });

  describe('permisos como en REST', () => {
    it('un Viewer lee la hoja pero no la cambia; un Editor no archiva; otra organización ve 404', async () => {
      const { ok, failure } = client();
      const { workbook, worksheet } = await newWorksheet();

      const foreign = await failure(
        `query(${SCOPE}, $id: ID!) { worksheet(${IN_SCOPE}, id: $id) { id } }`,
        { ...scope(), id: worksheet.id },
        'bob-session',
      );
      expect(foreign.extensions.code).toBe('PROJECT_NOT_FOUND');

      await setRole(pool, organizationId, bobId, 'viewer');
      const read = await ok(
        `query(${SCOPE}, $id: ID!) { worksheet(${IN_SCOPE}, id: $id) { id capabilities { write approve } } }`,
        { ...scope(), id: worksheet.id },
        'bob-session',
      );
      expect(read.worksheet.capabilities).toEqual({
        write: false,
        approve: false,
      });
      const viewerWrites = await failure(
        CREATE_CHANGESET,
        { ...scope(), worksheetId: worksheet.id, title: 'No' },
        'bob-session',
      );
      expect(viewerWrites.extensions.code).toBe('FORBIDDEN');

      await setRole(pool, organizationId, bobId, 'editor');
      await ok(
        CREATE_CHANGESET,
        { ...scope(), worksheetId: worksheet.id, title: 'Sí' },
        'bob-session',
      );
      const editorArchives = await failure(
        `mutation(${SCOPE}, $id: ID!) { archiveWorkbook(${IN_SCOPE}, id: $id) { id } }`,
        { ...scope(), id: workbook.id },
        'bob-session',
      );
      expect(editorArchives.extensions.code).toBe('FORBIDDEN');

      const anonymous = await failure(
        `query(${SCOPE}, $id: ID!) { worksheet(${IN_SCOPE}, id: $id) { id } }`,
        { ...scope(), id: worksheet.id },
        '',
      );
      expect(anonymous.extensions.code).toBe('AUTH_SESSION_REQUIRED');
    });
  });
});
