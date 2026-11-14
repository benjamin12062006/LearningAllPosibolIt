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
import type { AuthenticatedIdentity } from '../../../src/auth/authenticated-request.js';
import { DescopeService } from '../../../src/auth/descope.service.js';
import { CatalogImportModule } from '../../../src/catalog-import/catalog-import.module.js';
import { CATALOG_IMPORT_OPTIONS } from '../../../src/catalog-import/import.types.js';
import { ChangesetsModule } from '../../../src/changesets/changesets.module.js';
import { publicError } from '../../../src/common/http/public-error.js';
import { configureHttp } from '../../../src/configure-http.js';
import { POSTGRESQL_CONNECTION } from '../../../src/database/postgresql.connection.js';
import type { OrganizationRole } from '../../../src/organizations/organization-roles.js';
import { OrganizationsRepository } from '../../../src/organizations/organizations.repository.js';
import { ProjectsModule } from '../../../src/projects/projects.module.js';
import { ProjectsRepository } from '../../../src/projects/projects.repository.js';
import { UsersService } from '../../../src/users/users.service.js';
import { WorksheetCatalogSnapshotsModule } from '../../../src/worksheet-catalog-snapshots/worksheet-catalog-snapshots.module.js';
import { WorksheetExportsModule } from '../../../src/worksheet-exports/worksheet-exports.module.js';
import { WorksheetImportsModule } from '../../../src/worksheet-imports/worksheet-imports.module.js';
import { WorksheetsModule } from '../../../src/worksheets/worksheets.module.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';
import {
  FIXTURE_COLUMNS,
  SECOND_REVISION_ID,
  seedTwoRevisions,
} from './support/row-fixtures.js';

const carol: AuthenticatedIdentity = {
  ...alice,
  subject: 'carol',
  email: 'carol@example.test',
};
const SESSIONS: Record<string, AuthenticatedIdentity> = {
  'alice-session': alice,
  'bob-session': bob,
  'carol-session': carol,
};
type Session = 'alice-session' | 'bob-session' | 'carol-session';
type Method = 'get' | 'post' | 'patch' | 'put';

const HASH = 'a'.repeat(64);

/**
 * H1 (plan 02 de cierre, P7): renombrar, archivar y restaurar libros y hojas.
 * Alice es la dueña; Bob entra en su organización con el rol de cada prueba;
 * Carol es de otra organización.
 */
describe('Libros y hojas por HTTP: renombrar, archivar y restaurar', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let root: string;
  let base: string;
  let organizationId: string;
  let aliceId: string;
  let bobId: string;
  let workbookId: string;
  let worksheetId: string;
  let skuColumnId: string;
  const validateSession = jest.fn<DescopeService['validateSession']>();

  const pool = () => database.connection.pool;

  function send(
    method: Method,
    path: string,
    session: Session = 'alice-session',
  ) {
    return request(app.getHttpServer())
      [method](`${base}${path}`)
      .auth(session, { type: 'bearer' });
  }

  const archived = ({ body }: { body: unknown }) =>
    expect(body).toMatchObject(publicError('WORKSHEET_ARCHIVED'));

  async function setBobRole(role: OrganizationRole) {
    await pool().query(
      `INSERT INTO estadistica_forms.organization_members
         (organization_id, user_id, role, created_at)
       VALUES ($1, $2, $3, '2026-11-13T09:00:00.000Z')
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = $3`,
      [organizationId, bobId, role],
    );
  }

  async function createWorkbook(name: string) {
    const { body } = await send('post', '/workbooks')
      .send({ name })
      .expect(201);
    return body.workbook.id as string;
  }

  async function createWorksheet(name: string, inWorkbook = workbookId) {
    const { body } = await send('post', `/workbooks/${inWorkbook}/worksheets`)
      .send({
        name,
        columns: [
          { name: 'SKU', type: 'text' },
          { name: 'Precio', type: 'decimal' },
        ],
      })
      .expect(201);
    return body.worksheet as { id: string; columns: { id: string }[] };
  }

  async function createDraft(title = 'Cambios') {
    const { body } = await send('post', `/worksheets/${worksheetId}/changesets`)
      .send({ title })
      .expect(201);
    return body.changeset.id as string;
  }

  const readWorksheet = async (session: Session = 'alice-session') =>
    (await send('get', `/worksheets/${worksheetId}`, session).expect(200)).body;

  async function auditActions(resourceId: string) {
    const { rows } = await pool().query<{ action: string }>(
      `SELECT action FROM estadistica_forms.audit_events
       WHERE resource_id = $1 ORDER BY created_at, action`,
      [resourceId],
    );
    return rows.map((row) => row.action);
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    root = await mkdtemp(join(tmpdir(), 'archive-rename-'));
    const module = await Test.createTestingModule({
      imports: [
        ProjectsModule,
        WorksheetsModule,
        ChangesetsModule,
        WorksheetImportsModule,
        WorksheetExportsModule,
        CatalogImportModule,
        WorksheetCatalogSnapshotsModule,
      ],
    })
      .overrideProvider(POSTGRESQL_CONNECTION)
      .useValue(database.connection)
      .overrideProvider(DescopeService)
      .useValue({ validateSession })
      .overrideProvider(ARTIFACT_STORE_OPTIONS)
      .useValue({ root })
      .overrideProvider(CATALOG_IMPORT_OPTIONS)
      .useValue({ autoStart: false, pollMs: 1000, shutdownMs: 1000 })
      .compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
  });
  beforeEach(async () => {
    validateSession.mockReset().mockImplementation(async (token) => {
      const identity = SESSIONS[token];
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
    const owner = await users.provision(alice);
    aliceId = owner.id;
    bobId = (await users.provision(bob)).id;
    await users.provision(carol);
    const project = await app
      .get(ProjectsRepository)
      .create(owner.id, 'Tienda', projectInput);
    const [organization] = await app
      .get(OrganizationsRepository)
      .findMemberships(owner.id, { limit: 1, offset: 0 });
    organizationId = organization.id;
    base = `/api/v1/organizations/${organizationId}/projects/${project.id}`;

    workbookId = await createWorkbook('Libro');
    const worksheet = await createWorksheet('Inventario');
    worksheetId = worksheet.id;
    skuColumnId = worksheet.columns[0].id;
  });
  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await database?.close();
      if (root) await rm(root, { recursive: true, force: true });
    }
  });

  describe('renombrar', () => {
    it('cambia el nombre del libro, recortado, y lo deja en la auditoría', async () => {
      const { body } = await send('patch', `/workbooks/${workbookId}`)
        .send({ name: '  Catálogo 2027  ' })
        .expect(200);

      expect(body.workbook).toMatchObject({
        id: workbookId,
        name: 'Catálogo 2027',
        archivedAt: null,
      });
      const { body: list } = await send('get', '/workbooks').expect(200);
      expect(list.workbooks.map((item: { name: string }) => item.name)).toEqual(
        ['Catálogo 2027'],
      );
      const { rows } = await pool().query(
        `SELECT action, resource_type AS "resourceType", details
         FROM estadistica_forms.audit_events WHERE resource_id = $1`,
        [workbookId],
      );
      expect(rows).toEqual([
        {
          action: 'workbook.renamed',
          resourceType: 'workbook',
          details: { from: 'Libro', to: 'Catálogo 2027' },
        },
      ]);
    });

    it('no deja dos libros con el mismo nombre, pero sí cambiar las mayúsculas del propio', async () => {
      await createWorkbook('Otro');

      await send('patch', `/workbooks/${workbookId}`)
        .send({ name: 'OTRO' })
        .expect(409)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('WORKBOOK_NAME_TAKEN')),
        );
      const { body } = await send('patch', `/workbooks/${workbookId}`)
        .send({ name: 'LIBRO' })
        .expect(200);
      expect(body.workbook.name).toBe('LIBRO');
    });

    it('cambia el nombre de la hoja sin tocar su contenido', async () => {
      const before = await readWorksheet();

      const { body } = await send('patch', `/worksheets/${worksheetId}`)
        .send({ name: ' Existencias ' })
        .expect(200);

      expect(body.worksheet).toEqual({
        ...before.worksheet,
        name: 'Existencias',
      });
      expect(body.capabilities).toEqual({ write: true, approve: true });
      expect(await auditActions(worksheetId)).toEqual(['worksheet.renamed']);
    });

    it('el nombre de una hoja es único dentro de su libro, no entre libros', async () => {
      await createWorksheet('Precios');
      const otherWorkbook = await createWorkbook('Otro');
      await createWorksheet('Ventas', otherWorkbook);

      await send('patch', `/worksheets/${worksheetId}`)
        .send({ name: 'precios' })
        .expect(409)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('WORKSHEET_NAME_TAKEN')),
        );
      await send('patch', `/worksheets/${worksheetId}`)
        .send({ name: 'Ventas' })
        .expect(200);
      await send('patch', `/worksheets/${worksheetId}`)
        .send({ name: 'VENTAS' })
        .expect(200);
    });

    it('valida el nombre', async () => {
      for (const body of [
        {},
        { name: '' },
        { name: '   ' },
        { name: 'x'.repeat(121) },
        { name: 'Bien', otro: 1 },
      ]) {
        await send('patch', `/workbooks/${workbookId}`).send(body).expect(400);
        await send('patch', `/worksheets/${worksheetId}`)
          .send(body)
          .expect(400);
      }
    });
  });

  describe('archivar y restaurar una hoja', () => {
    it('archivada se sigue leyendo, pero nadie puede escribir en ella', async () => {
      const { body } = await send(
        'post',
        `/worksheets/${worksheetId}/archive`,
      ).expect(200);

      expect(body.worksheet).toMatchObject({
        id: worksheetId,
        archivedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        workbookArchivedAt: null,
      });
      expect(body.capabilities).toEqual({ write: false, approve: false });
      expect((await readWorksheet()).worksheet.archivedAt).toBe(
        body.worksheet.archivedAt,
      );
      await send('post', `/worksheets/${worksheetId}/rows/query`)
        .send({})
        .expect(200);
    });

    it('repetir no cambia la fecha ni duplica la auditoría; restaurar la deja como estaba', async () => {
      const first = await send(
        'post',
        `/worksheets/${worksheetId}/archive`,
      ).expect(200);
      const second = await send(
        'post',
        `/worksheets/${worksheetId}/archive`,
      ).expect(200);
      expect(second.body.worksheet.archivedAt).toBe(
        first.body.worksheet.archivedAt,
      );

      const restored = await send(
        'post',
        `/worksheets/${worksheetId}/restore`,
      ).expect(200);
      await send('post', `/worksheets/${worksheetId}/restore`).expect(200);

      expect(restored.body.worksheet.archivedAt).toBeNull();
      expect(restored.body.capabilities).toEqual({
        write: true,
        approve: true,
      });
      expect(await auditActions(worksheetId)).toEqual([
        'worksheet.archived',
        'worksheet.restored',
      ]);
    });

    it('no admite borradores, renombrar, importar ni llevarla al catálogo; sí exportarla', async () => {
      await send('post', `/worksheets/${worksheetId}/archive`).expect(200);

      await send('post', `/worksheets/${worksheetId}/changesets`)
        .send({ title: 'Cambios' })
        .expect(409)
        .expect(archived);
      await send('patch', `/worksheets/${worksheetId}`)
        .send({ name: 'Otro nombre' })
        .expect(409)
        .expect(archived);
      await send('post', `/worksheets/${worksheetId}/imports`)
        .attach('file', Buffer.from('sku\nA-1\n', 'utf8'), 'productos.csv')
        .field(
          'options',
          JSON.stringify({
            mode: 'append',
            columns: [{ header: 'sku', columnId: skuColumnId }],
          }),
        )
        .expect(409)
        .expect(archived);
      await send('post', `/worksheets/${worksheetId}/catalog-snapshots`)
        .send({ idColumnId: skuColumnId })
        .expect(409)
        .expect(archived);

      await send('post', `/worksheets/${worksheetId}/exports`)
        .send({ format: 'csv' })
        .expect(({ status }) => expect(status).toBeLessThan(300));
    });

    it('al restaurarla vuelve a admitir borradores', async () => {
      await send('post', `/worksheets/${worksheetId}/archive`).expect(200);
      await send('post', `/worksheets/${worksheetId}/restore`).expect(200);

      await createDraft();
    });

    it('un borrador que ya existía no se puede seguir, solo cancelar', async () => {
      const changesetId = await createDraft();
      const { worksheet } = await readWorksheet();
      await send('post', `/worksheets/${worksheetId}/archive`).expect(200);
      const path = `/changesets/${changesetId}`;
      const approval = {
        contentHash: HASH,
        expectedHeadRevisionId: worksheet.headRevision.id,
      };

      await send('put', `${path}/operations`)
        .set('If-Match', '"1"')
        .send({ operations: [] })
        .expect(409)
        .expect(archived);
      for (const [action, body] of [
        ['submit', { draftVersion: 1 }],
        ['reopen', { draftVersion: 1 }],
        ['rebase', { draftVersion: 1 }],
        ['decisions', { ...approval, draftVersion: 1, decision: 'accept' }],
        ['apply', approval],
      ] as const) {
        const response = await send('post', `${path}/${action}`)
          // Solo `apply` la exige; a las demás no les estorba.
          .set('Idempotency-Key', randomUUID())
          .send(body);
        // El nombre de la acción en el fallo dice cuál de las cinco se escapó.
        expect([action, response.status, response.body.code]).toEqual([
          action,
          409,
          'WORKSHEET_ARCHIVED',
        ]);
      }

      // Leerlo y cancelarlo sí: es recoger, no cambiar la hoja.
      await send('get', path).expect(200);
      await send('post', `${path}/cancel`)
        .send({ draftVersion: 1 })
        .expect(({ status }) => expect(status).toBeLessThan(300));
    });
  });

  describe('archivar y restaurar un libro', () => {
    it('sus hojas quedan sin escritura y no admite hojas nuevas', async () => {
      const { body } = await send(
        'post',
        `/workbooks/${workbookId}/archive`,
      ).expect(200);
      expect(body.workbook.archivedAt).toEqual(expect.any(String));

      const read = await readWorksheet();
      expect(read.worksheet).toMatchObject({
        archivedAt: null,
        workbookArchivedAt: body.workbook.archivedAt,
      });
      expect(read.capabilities).toEqual({ write: false, approve: false });

      await send('post', `/workbooks/${workbookId}/worksheets`)
        .send({ name: 'Nueva', columns: [] })
        .expect(409)
        .expect(({ body: error }) =>
          expect(error).toMatchObject(publicError('WORKBOOK_ARCHIVED')),
        );
      await send('patch', `/workbooks/${workbookId}`)
        .send({ name: 'Otro nombre' })
        .expect(409)
        .expect(({ body: error }) =>
          expect(error).toMatchObject(publicError('WORKBOOK_ARCHIVED')),
        );
      await send('post', `/worksheets/${worksheetId}/changesets`)
        .send({ title: 'Cambios' })
        .expect(409)
        .expect(archived);
      // Las hojas de un libro archivado se siguen listando y leyendo.
      await send('get', `/workbooks/${workbookId}/worksheets`).expect(200);
    });

    it('restaurarlo devuelve la escritura a sus hojas; repetir no hace nada', async () => {
      await send('post', `/workbooks/${workbookId}/archive`).expect(200);
      await send('post', `/workbooks/${workbookId}/archive`).expect(200);

      const { body } = await send(
        'post',
        `/workbooks/${workbookId}/restore`,
      ).expect(200);
      await send('post', `/workbooks/${workbookId}/restore`).expect(200);

      expect(body.workbook.archivedAt).toBeNull();
      expect((await readWorksheet()).capabilities.write).toBe(true);
      await createDraft();
      expect(await auditActions(workbookId)).toEqual([
        'workbook.archived',
        'workbook.restored',
      ]);
    });

    it('una hoja archivada sigue archivada aunque se restaure su libro', async () => {
      await send('post', `/worksheets/${worksheetId}/archive`).expect(200);
      await send('post', `/workbooks/${workbookId}/archive`).expect(200);
      await send('post', `/workbooks/${workbookId}/restore`).expect(200);

      const read = await readWorksheet();
      expect(read.worksheet.archivedAt).not.toBeNull();
      expect(read.worksheet.workbookArchivedAt).toBeNull();
      expect(read.capabilities.write).toBe(false);
    });

    it('el nombre de lo archivado sigue reservado', async () => {
      await send('post', `/workbooks/${workbookId}/archive`).expect(200);
      await send('post', '/workbooks')
        .send({ name: 'libro' })
        .expect(409)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('WORKBOOK_NAME_TAKEN')),
        );
    });
  });

  describe('duplicar una hoja', () => {
    type Sheet = {
      id: string;
      workbookId: string;
      name: string;
      generation: number;
      headRevision: { id: string; sequence: number; rowCount: number };
      columns: { id: string; name: string; type: string; position: number }[];
      duplicatedFrom: { worksheetId: string; revisionId: string } | null;
    };

    /** Una hoja con dos revisiones: en la actual hay cuatro filas (A, B, D y E). */
    async function seededSheet() {
      const { body } = await send('post', `/workbooks/${workbookId}/worksheets`)
        .send({ name: 'Con filas', columns: FIXTURE_COLUMNS })
        .expect(201);
      await seedTwoRevisions(pool(), body.worksheet, organizationId, aliceId);
      return (await send('get', `/worksheets/${body.worksheet.id}`).expect(200))
        .body.worksheet as Sheet;
    }

    const duplicate = (
      sourceId: string,
      body: Record<string, unknown>,
      session: Session = 'alice-session',
    ) => send('post', `/worksheets/${sourceId}/duplicate`, session).send(body);

    /** Las filas de una hoja con las celdas por nombre de columna, en su orden. */
    async function rowsByName(sheet: Sheet, revisionId?: string) {
      const { body } = await send('post', `/worksheets/${sheet.id}/rows/query`)
        .send(revisionId ? { revisionId } : {})
        .expect(200);
      const nameOf = new Map(sheet.columns.map(({ id, name }) => [id, name]));
      return (
        body.items as { rowId: string; values: Record<string, unknown> }[]
      ).map((row) => ({
        rowId: row.rowId,
        values: Object.fromEntries(
          Object.entries(row.values).map(([id, value]) => [
            nameOf.get(id),
            value,
          ]),
        ),
      }));
    }

    it('la copia tiene las mismas columnas y filas, con IDs nuevos y su procedencia', async () => {
      const source = await seededSheet();

      const { body } = await duplicate(source.id, { name: ' Copia ' }).expect(
        201,
      );
      const copy = body.worksheet as Sheet;

      expect(copy).toMatchObject({
        name: 'Copia',
        workbookId: source.workbookId,
        generation: 1,
        headRevision: { sequence: 1, rowCount: 4 },
        duplicatedFrom: {
          worksheetId: source.id,
          revisionId: SECOND_REVISION_ID,
        },
        archivedAt: null,
      });
      expect(body.capabilities).toEqual({ write: true, approve: true });
      expect(copy.id).not.toBe(source.id);
      expect(copy.headRevision.id).not.toBe(source.headRevision.id);
      expect(
        copy.columns.map(({ name, type, position }) => [name, type, position]),
      ).toEqual(
        source.columns.map(({ name, type, position }) => [
          name,
          type,
          position,
        ]),
      );
      const sourceColumnIds = new Set(source.columns.map(({ id }) => id));
      for (const column of copy.columns) {
        expect(sourceColumnIds.has(column.id)).toBe(false);
      }

      const sourceRows = await rowsByName(source);
      const copyRows = await rowsByName(copy);
      expect(copyRows.map((row) => row.values)).toEqual(
        sourceRows.map((row) => row.values),
      );
      expect(copyRows).toHaveLength(4);
      const sourceRowIds = new Set(sourceRows.map((row) => row.rowId));
      for (const row of copyRows) {
        expect(sourceRowIds.has(row.rowId)).toBe(false);
      }
      expect(await auditActions(copy.id)).toEqual(['worksheet.duplicated']);
    });

    it('con revisionId copia la hoja como estaba entonces', async () => {
      const source = await seededSheet();
      const { rows } = await pool().query<{ id: string }>(
        `SELECT id FROM estadistica_forms.worksheet_revisions
         WHERE worksheet_id = $1 AND sequence = 1`,
        [source.id],
      );
      const firstRevisionId = rows[0].id;

      const { body } = await duplicate(source.id, {
        name: 'Como al principio',
        revisionId: firstRevisionId,
      }).expect(201);

      expect(body.worksheet.duplicatedFrom.revisionId).toBe(firstRevisionId);
      expect(body.worksheet.headRevision.rowCount).toBe(4);
      const copied = await rowsByName(body.worksheet);
      const then = await rowsByName(source, firstRevisionId);
      expect(copied.map((row) => row.values)).toEqual(
        then.map((row) => row.values),
      );
      // En la revisión 1 el precio de B era 9.99; en la actual es 12.00.
      expect(copied.map((row) => row.values.Precio)).toContain('9.99');
      expect(copied.map((row) => row.values.Precio)).not.toContain('12.00');
    });

    it('las fórmulas de la copia apuntan a las columnas de la copia', async () => {
      const { body: created } = await send(
        'post',
        `/workbooks/${workbookId}/worksheets`,
      )
        .send({
          name: 'Con fórmula',
          columns: [
            { name: 'Precio', type: 'decimal' },
            { name: 'Costo', type: 'decimal' },
            {
              name: 'Estado',
              type: 'selection',
              options: [{ label: 'Nuevo' }, { label: 'Usado' }],
            },
            {
              name: 'Margen',
              type: 'calculated',
              formula: {
                expression: {
                  op: 'sub',
                  args: [{ column: 'Precio' }, { column: 'Costo' }],
                },
                scale: 2,
                rounding: 'half_up',
              },
            },
          ],
        })
        .expect(201);
      const source = created.worksheet;
      const [price, cost, state] = source.columns;
      await pool().query(
        `INSERT INTO estadistica_forms.worksheet_row_versions
           (organization_id, worksheet_id, row_id, from_sequence, to_sequence,
            sort_key, cell_values, is_deleted)
         VALUES ($1, $2, $3, 1, NULL, 'a', $4, false)`,
        [
          organizationId,
          source.id,
          randomUUID(),
          JSON.stringify({
            [price.id]: '10.00',
            [cost.id]: '4.00',
            [state.id]: state.options[1].id,
          }),
        ],
      );
      await pool().query(
        `UPDATE estadistica_forms.worksheet_revisions SET row_count = 1
         WHERE worksheet_id = $1`,
        [source.id],
      );

      const { body } = await duplicate(source.id, { name: 'Copia' }).expect(
        201,
      );
      const copy = body.worksheet;

      const [copyPrice, copyCost, copyState, copyMargin] = copy.columns;
      expect(copyMargin.formula.expression).toEqual({
        op: 'sub',
        args: [{ column: copyPrice.id }, { column: copyCost.id }],
      });
      expect(copyMargin.formula).toMatchObject({
        scale: 2,
        rounding: 'half_up',
      });
      // Las opciones conservan su ID: las celdas las guardan por él.
      expect(copyState.options).toEqual(state.options);
      const [row] = await rowsByName(copy);
      expect(row.values).toEqual({
        Precio: '10.00',
        Costo: '4.00',
        Estado: state.options[1].id,
        Margen: '6.00',
      });
      expect((await rowsByName(source))[0].values).toEqual(row.values);
    });

    it('va a otro libro si se pide; el nombre es único en el libro de destino', async () => {
      const otherWorkbook = await createWorkbook('Otro');

      const { body } = await duplicate(worksheetId, {
        name: 'Inventario',
        workbookId: otherWorkbook,
      }).expect(201);
      expect(body.worksheet.workbookId).toBe(otherWorkbook);

      await duplicate(worksheetId, { name: 'inventario' })
        .expect(409)
        .expect(({ body: error }) =>
          expect(error).toMatchObject(publicError('WORKSHEET_NAME_TAKEN')),
        );
      await duplicate(worksheetId, {
        name: 'INVENTARIO',
        workbookId: otherWorkbook,
      }).expect(409);
    });

    it('la copia es independiente: no hereda el archivado ni los borradores', async () => {
      await createDraft();
      await send('post', `/worksheets/${worksheetId}/archive`).expect(200);

      // Copiar es leer: una hoja archivada se puede duplicar.
      const { body } = await duplicate(worksheetId, { name: 'Viva' }).expect(
        201,
      );

      expect(body.worksheet).toMatchObject({
        archivedAt: null,
        headRevision: { rowCount: 0 },
      });
      const { rows } = await pool().query(
        `SELECT 1 FROM estadistica_forms.worksheet_changesets
         WHERE worksheet_id = $1`,
        [body.worksheet.id],
      );
      expect(rows).toEqual([]);
      await send('post', `/worksheets/${body.worksheet.id}/changesets`)
        .send({ title: 'En la copia' })
        .expect(201);
      // El origen sigue como estaba.
      expect((await readWorksheet()).worksheet.archivedAt).not.toBeNull();
    });

    it('no se puede copiar a un libro archivado', async () => {
      const otherWorkbook = await createWorkbook('Otro');
      await send('post', `/workbooks/${otherWorkbook}/archive`).expect(200);

      await duplicate(worksheetId, { name: 'Copia', workbookId: otherWorkbook })
        .expect(409)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('WORKBOOK_ARCHIVED')),
        );
    });

    it('una revisión de otra hoja, un libro o una hoja que no existen responden 404', async () => {
      const other = await seededSheet();

      await duplicate(worksheetId, {
        name: 'Copia',
        revisionId: other.headRevision.id,
      })
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(
            publicError('WORKSHEET_REVISION_NOT_FOUND'),
          ),
        );
      await duplicate(worksheetId, { name: 'Copia', workbookId: randomUUID() })
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('WORKBOOK_NOT_FOUND')),
        );
      await duplicate(randomUUID(), { name: 'Copia' })
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('WORKSHEET_NOT_FOUND')),
        );
    });

    it('valida el cuerpo y los permisos', async () => {
      for (const body of [
        {},
        { name: '' },
        { name: 'Copia', workbookId: 'no-es-uuid' },
        { name: 'Copia', revisionId: 'no-es-uuid' },
        { name: 'Copia', otro: 1 },
      ]) {
        await duplicate(worksheetId, body).expect(400);
      }

      await setBobRole('viewer');
      await duplicate(worksheetId, { name: 'De Bob' }, 'bob-session')
        .expect(403)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('FORBIDDEN')),
        );
      await setBobRole('editor');
      await duplicate(worksheetId, { name: 'De Bob' }, 'bob-session').expect(
        201,
      );
      await duplicate(worksheetId, { name: 'De Carol' }, 'carol-session')
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('PROJECT_NOT_FOUND')),
        );
      await request(app.getHttpServer())
        .post(`${base}/worksheets/${worksheetId}/duplicate`)
        .send({ name: 'Sin sesión' })
        .expect(401);
    });
  });

  describe('listados', () => {
    it('sin filtro salen todos; con archived, solo activos o solo archivados', async () => {
      const archivedBook = await createWorkbook('Viejo');
      await send('post', `/workbooks/${archivedBook}/archive`).expect(200);
      const oldSheet = await createWorksheet('Antigua');
      await send('post', `/worksheets/${oldSheet.id}/archive`).expect(200);

      const names = async (path: string, key: 'workbooks' | 'worksheets') =>
        (await send('get', path).expect(200)).body[key]
          .map((item: { name: string }) => item.name)
          .sort();

      expect(await names('/workbooks', 'workbooks')).toEqual([
        'Libro',
        'Viejo',
      ]);
      expect(await names('/workbooks?archived=false', 'workbooks')).toEqual([
        'Libro',
      ]);
      expect(await names('/workbooks?archived=true', 'workbooks')).toEqual([
        'Viejo',
      ]);
      const sheets = `/workbooks/${workbookId}/worksheets`;
      expect(await names(sheets, 'worksheets')).toEqual([
        'Antigua',
        'Inventario',
      ]);
      expect(await names(`${sheets}?archived=false`, 'worksheets')).toEqual([
        'Inventario',
      ]);
      expect(
        await names(`${sheets}?archived=true&limit=5`, 'worksheets'),
      ).toEqual(['Antigua']);
      await send('get', '/workbooks?archived=quizá').expect(400);
      await send('get', `${sheets}?archived=1`).expect(400);
    });
  });

  describe('quién puede', () => {
    it('renombrar pide Editor; archivar y restaurar piden Manager', async () => {
      const forbidden = ({ body }: { body: unknown }) =>
        expect(body).toMatchObject(publicError('FORBIDDEN'));
      const rename = (session: Session) =>
        send('patch', `/worksheets/${worksheetId}`, session).send({
          name: randomUUID(),
        });
      const renameBook = (session: Session) =>
        send('patch', `/workbooks/${workbookId}`, session).send({
          name: randomUUID(),
        });
      const toggles = [
        `/worksheets/${worksheetId}/archive`,
        `/worksheets/${worksheetId}/restore`,
        `/workbooks/${workbookId}/archive`,
        `/workbooks/${workbookId}/restore`,
      ];

      await setBobRole('viewer');
      await rename('bob-session').expect(403).expect(forbidden);
      await renameBook('bob-session').expect(403).expect(forbidden);

      await setBobRole('editor');
      await rename('bob-session').expect(200);
      await renameBook('bob-session').expect(200);
      for (const path of toggles) {
        await send('post', path, 'bob-session').expect(403).expect(forbidden);
      }

      await setBobRole('manager');
      for (const path of toggles) {
        await send('post', path, 'bob-session').expect(200);
      }
    });

    it('otra organización recibe 404, sin sesión 401 y lo que no existe 404', async () => {
      const paths: [Method, string][] = [
        ['patch', `/workbooks/${workbookId}`],
        ['post', `/workbooks/${workbookId}/archive`],
        ['post', `/workbooks/${workbookId}/restore`],
        ['patch', `/worksheets/${worksheetId}`],
        ['post', `/worksheets/${worksheetId}/archive`],
        ['post', `/worksheets/${worksheetId}/restore`],
      ];
      for (const [method, path] of paths) {
        await send(method, path, 'carol-session')
          .send({ name: 'Mío' })
          .expect(404)
          .expect(({ body }) =>
            expect(body).toMatchObject(publicError('PROJECT_NOT_FOUND')),
          );
        await request(app.getHttpServer())
          [method](`${base}${path}`)
          .send({ name: 'Mío' })
          .expect(401);
      }

      const missing = randomUUID();
      await send('patch', `/workbooks/${missing}`)
        .send({ name: 'Nada' })
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('WORKBOOK_NOT_FOUND')),
        );
      await send('post', `/workbooks/${missing}/archive`).expect(404);
      await send('patch', `/worksheets/${missing}`)
        .send({ name: 'Nada' })
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('WORKSHEET_NOT_FOUND')),
        );
      await send('post', `/worksheets/${missing}/archive`).expect(404);
      await send('post', '/worksheets/no-es-uuid/archive').expect(400);
    });

    it('con la organización archivada no se archiva ni se renombra nada', async () => {
      await pool().query(
        // Una organización personal no se puede archivar: aquí deja de serlo.
        `UPDATE estadistica_forms.organizations
         SET personal_owner_id = NULL, archived_at = '2026-11-13T10:00:00.000Z'
         WHERE id = $1`,
        [organizationId],
      );

      for (const [method, path] of [
        ['patch', `/worksheets/${worksheetId}`],
        ['post', `/worksheets/${worksheetId}/archive`],
        ['post', `/workbooks/${workbookId}/archive`],
      ] as const) {
        await send(method, path)
          .send({ name: 'Otro' })
          .expect(409)
          .expect(({ body }) =>
            expect(body).toMatchObject(publicError('ORGANIZATION_ARCHIVED')),
          );
      }
    });
  });
});
