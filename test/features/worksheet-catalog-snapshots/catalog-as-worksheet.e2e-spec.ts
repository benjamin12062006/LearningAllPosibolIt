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
import { ArtifactStore } from '../../../src/artifacts/artifact.store.js';
import { ARTIFACT_STORE_OPTIONS } from '../../../src/artifacts/artifacts.types.js';
import type { AuthenticatedIdentity } from '../../../src/auth/authenticated-request.js';
import { DescopeService } from '../../../src/auth/descope.service.js';
import { CatalogImportModule } from '../../../src/catalog-import/catalog-import.module.js';
import { CatalogImportWorker } from '../../../src/catalog-import/catalog-import.worker.js';
import { CATALOG_IMPORT_OPTIONS } from '../../../src/catalog-import/import.types.js';
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
import { WORKSHEET_EXPORT_OPTIONS } from '../../../src/worksheet-exports/worksheet-exports.types.js';
import { WorksheetsModule } from '../../../src/worksheets/worksheets.module.js';
import {
  CATALOG_HEADERS,
  catalogValues,
  insertReadySnapshot,
} from '../evaluations/support/snapshot-fixtures.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';

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

type Column = { id: string; name: string; type: string; required: boolean };
type Sheet = {
  id: string;
  name: string;
  columns: Column[];
  headRevision: { id: string; sequence: number; rowCount: number };
  openedFromCatalog: { snapshotId: string } | null;
};

/** Tres productos; el segundo con la marca vacía, que en un CSV es «sin valor». */
const CATALOG = [
  catalogValues('SKU-1'),
  catalogValues('SKU-2', { Marca: '' }),
  catalogValues('SKU-3', { Precio: '1,50', Stock: 'out_of_stock' }),
];

/** Una línea de CSV: entre comillas solo los campos con coma, comillas o saltos. */
function csvLine(fields: readonly string[]) {
  const quote = (field: string) =>
    /[",\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
  return fields.map(quote).join(',');
}

/**
 * H5 (plan 02 de cierre, P11): abrir un catálogo terminado como una hoja
 * nueva, el camino contrario al puente de E5.4.
 */
describe('Abrir un catálogo como hoja por HTTP', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let root: string;
  let base: string;
  let projectId: string;
  let bobProjectId: string;
  let organizationId: string;
  let bobId: string;
  let workbookId: string;
  let snapshotId: string;
  const validateSession = jest.fn<DescopeService['validateSession']>();

  const pool = () => database.connection.pool;

  function send(
    method: 'get' | 'post',
    path: string,
    session: Session = 'alice-session',
  ) {
    return request(app.getHttpServer())
      [method](`${base}${path}`)
      .auth(session, { type: 'bearer' });
  }

  function open(
    body: Record<string, unknown>,
    session: Session = 'alice-session',
    inWorkbook = workbookId,
  ) {
    return send(
      'post',
      `/workbooks/${inWorkbook}/worksheets/from-catalog`,
      session,
    ).send(body);
  }

  async function openedSheet(name = 'Del catálogo'): Promise<Sheet> {
    const { body } = await open({ name, snapshotId }).expect(201);
    return body.worksheet;
  }

  /** Las filas de la hoja con las celdas por nombre de columna, en su orden. */
  async function rowsByName(sheet: Sheet) {
    const { body } = await send('post', `/worksheets/${sheet.id}/rows/query`)
      .send({ limit: 100 })
      .expect(200);
    const nameOf = new Map(sheet.columns.map(({ id, name }) => [id, name]));
    return (body.items as { values: Record<string, unknown> }[]).map((row) =>
      Object.fromEntries(
        Object.entries(row.values).map(([id, value]) => [
          nameOf.get(id),
          value,
        ]),
      ),
    );
  }

  async function catalogRows(id: string) {
    const { rows } = await pool().query<{ values: Record<string, string> }>(
      `SELECT original_values AS values FROM estadistica_forms.catalog_rows
       WHERE snapshot_id = $1 ORDER BY source_row`,
      [id],
    );
    return rows.map((row) => row.values);
  }

  async function setBobRole(role: OrganizationRole) {
    await pool().query(
      `INSERT INTO estadistica_forms.organization_members
         (organization_id, user_id, role, created_at)
       VALUES ($1, $2, $3, '2026-11-14T09:00:00.000Z')
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = $3`,
      [organizationId, bobId, role],
    );
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    root = await mkdtemp(join(tmpdir(), 'catalog-as-worksheet-'));
    const idle = { autoStart: false, pollMs: 1000, shutdownMs: 1000 };
    const module = await Test.createTestingModule({
      imports: [
        ProjectsModule,
        WorksheetsModule,
        CatalogImportModule,
        WorksheetCatalogSnapshotsModule,
        WorksheetExportsModule,
      ],
    })
      .overrideProvider(POSTGRESQL_CONNECTION)
      .useValue(database.connection)
      .overrideProvider(DescopeService)
      .useValue({ validateSession })
      .overrideProvider(ARTIFACT_STORE_OPTIONS)
      .useValue({ root })
      .overrideProvider(CATALOG_IMPORT_OPTIONS)
      .useValue(idle)
      .overrideProvider(WORKSHEET_EXPORT_OPTIONS)
      .useValue({ autoStart: false })
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
    await rm(root, { recursive: true, force: true });
    await app.get(ArtifactStore).onModuleInit();
    const users = app.get(UsersService);
    const owner = await users.provision(alice);
    const bobUser = await users.provision(bob);
    bobId = bobUser.id;
    await users.provision(carol);
    const project = await app
      .get(ProjectsRepository)
      .create(owner.id, 'Tienda', projectInput);
    projectId = project.id;
    bobProjectId = (
      await app.get(ProjectsRepository).create(bobUser.id, 'Otra', projectInput)
    ).id;
    const [organization] = await app
      .get(OrganizationsRepository)
      .findMemberships(owner.id, { limit: 1, offset: 0 });
    organizationId = organization.id;
    base = `/api/v1/organizations/${organizationId}/projects/${projectId}`;

    const { body } = await send('post', '/workbooks')
      .send({ name: 'Libro' })
      .expect(201);
    workbookId = body.workbook.id;
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

  describe('la hoja nueva', () => {
    it('una columna de texto por cabecera, la del id obligatoria, y su procedencia', async () => {
      const { body } = await open({
        name: ' Del catálogo ',
        snapshotId,
      }).expect(201);
      const sheet: Sheet = body.worksheet;

      expect(sheet).toMatchObject({
        name: 'Del catálogo',
        headRevision: { sequence: 1, rowCount: 3 },
        openedFromCatalog: { snapshotId },
        duplicatedFrom: null,
        archivedAt: null,
      });
      expect(body.capabilities).toEqual({ write: true, approve: true });
      expect(
        sheet.columns.map(({ name, type, required }) => [name, type, required]),
      ).toEqual(
        CATALOG_HEADERS.map((header) => [header, 'text', header === 'SKU']),
      );
      const { rows } = await pool().query(
        `SELECT action, details FROM estadistica_forms.audit_events
         WHERE resource_id = $1`,
        [sheet.id],
      );
      expect(rows).toEqual([
        {
          action: 'worksheet.opened_from_catalog',
          details: { catalogSnapshotId: snapshotId },
        },
      ]);
      const { rows: revisions } = await pool().query(
        `SELECT source FROM estadistica_forms.worksheet_revisions
         WHERE worksheet_id = $1`,
        [sheet.id],
      );
      expect(revisions).toEqual([{ source: 'catalog' }]);
    });

    it('las filas son las del catálogo, en su orden; vacío es sin valor', async () => {
      const sheet = await openedSheet();

      const rows = await rowsByName(sheet);
      const expected = CATALOG.map((values) =>
        Object.fromEntries(
          CATALOG_HEADERS.map((header) => [
            header,
            values[header] === '' ? null : values[header],
          ]),
        ),
      );
      expect(rows).toEqual(expected);
      expect(rows[1].Marca).toBeNull();
    });

    it('exportada a CSV dice lo mismo que el catálogo de origen', async () => {
      const sheet = await openedSheet();

      const { body } = await send('post', `/worksheets/${sheet.id}/exports`)
        .send({ format: 'csv' })
        .expect(201);
      const { body: file } = await send(
        'get',
        `/worksheet-exports/${body.export.id}/file`,
      )
        .responseType('blob')
        .expect(200);
      const [header, ...lines] = (file as Buffer)
        .toString('utf8')
        .replace(/^﻿/, '')
        .trimEnd()
        .split(/\r?\n/);

      expect([header, ...lines]).toEqual(
        [
          CATALOG_HEADERS,
          ...CATALOG.map((values) =>
            CATALOG_HEADERS.map((name) => values[name]),
          ),
        ].map(csvLine),
      );
    });

    it('ida y vuelta: la hoja llevada otra vez al catálogo da las mismas filas', async () => {
      const sheet = await openedSheet();
      const idColumnId = sheet.columns.find(({ name }) => name === 'SKU')!.id;

      const { body } = await send(
        'post',
        `/worksheets/${sheet.id}/catalog-snapshots`,
      )
        .send({ idColumnId })
        .expect(202);
      await app.get(CatalogImportWorker).runUntilIdle();

      expect(await catalogRows(body.snapshotId)).toEqual(
        await catalogRows(snapshotId),
      );
    });

    it('no toca el catálogo y se puede abrir más de una vez', async () => {
      const before = await catalogRows(snapshotId);

      await openedSheet('Primera');
      await openedSheet('Segunda');

      expect(await catalogRows(snapshotId)).toEqual(before);
    });
  });

  describe('qué catálogo se puede abrir', () => {
    it('uno que no terminó o falló responde 409', async () => {
      // La tabla exige que cada estado lleve sus campos: como lo deja la importación.
      const states = {
        pending: 'row_count = NULL, finished_at = NULL, error = NULL',
        importing: 'row_count = NULL, finished_at = NULL, error = NULL',
        failed: `row_count = NULL, finished_at = '2026-11-14T00:00:00.000Z', error = '{}'::jsonb`,
      };
      for (const [status, fields] of Object.entries(states)) {
        await pool().query(
          `UPDATE estadistica_forms.catalog_snapshots
           SET status = $2, ${fields}
           WHERE id = $1`,
          [snapshotId, status],
        );
        await open({ name: `Hoja ${status}`, snapshotId })
          .expect(409)
          .expect(({ body }) =>
            expect(body).toMatchObject(
              publicError('CATALOG_SNAPSHOT_NOT_READY'),
            ),
          );
      }
    });

    it('uno de otro proyecto o que no existe responde 404', async () => {
      const foreign = await insertReadySnapshot(pool(), bobProjectId, CATALOG);

      for (const id of [foreign, randomUUID()]) {
        await open({ name: 'Ajena', snapshotId: id })
          .expect(404)
          .expect(({ body }) =>
            expect(body).toMatchObject(publicError('IMPORT_NOT_FOUND')),
          );
      }
    });

    it('uno de otro proyecto de la misma organización también responde 404', async () => {
      const { rows } = await pool().query<{ owner: string }>(
        `SELECT owner_id AS owner FROM estadistica_forms.projects WHERE id = $1`,
        [projectId],
      );
      const sibling = await app
        .get(ProjectsRepository)
        .create(rows[0].owner, 'Hermano', projectInput);
      const siblingSnapshot = await insertReadySnapshot(
        pool(),
        sibling.id,
        CATALOG,
      );

      await open({ name: 'Del hermano', snapshotId: siblingSnapshot })
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('IMPORT_NOT_FOUND')),
        );
    });

    it('cabeceras que no pueden ser columnas: el error dice cuáles', async () => {
      const clashing = await insertReadySnapshot(
        pool(),
        projectId,
        [{ SKU: 'SKU-1', sku: 'otro' }],
        { headers: ['SKU', 'sku'] },
      );

      const { body } = await open({
        name: 'Choque',
        snapshotId: clashing,
      }).expect(400);

      expect(body.code).toBe('VALIDATION_FAILED');
      expect(body.issues.map(({ field }: { field: string }) => field)).toEqual([
        'columns.1.name',
      ]);
    });

    it('un texto más largo que una celda de hoja no se recorta: se rechaza con su fila', async () => {
      const long = await insertReadySnapshot(pool(), projectId, [
        catalogValues('SKU-1'),
        catalogValues('SKU-2', { Descripción: 'x'.repeat(8193) }),
      ]);

      const { body } = await open({ name: 'Larga', snapshotId: long }).expect(
        422,
      );

      expect(body).toMatchObject(publicError('IMPORT_ROWS_INVALID'));
      expect(body.issues).toEqual([
        expect.objectContaining({
          field: 'rows.2.Descripción',
          code: 'CELL_VALUE_INVALID',
        }),
      ]);
      const { rows } = await pool().query(
        `SELECT count(*)::int AS n FROM estadistica_forms.worksheets
         WHERE name = 'Larga'`,
      );
      expect(rows[0].n).toBe(0);
    });
  });

  describe('dónde y quién', () => {
    it('el nombre no puede repetirse en el libro y el libro tiene que estar activo', async () => {
      await openedSheet('Del catálogo');

      await open({ name: 'DEL CATÁLOGO', snapshotId })
        .expect(409)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('WORKSHEET_NAME_TAKEN')),
        );
      await send('post', `/workbooks/${workbookId}/archive`).expect(200);
      await open({ name: 'Otra', snapshotId })
        .expect(409)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('WORKBOOK_ARCHIVED')),
        );
      await open({ name: 'Otra', snapshotId }, 'alice-session', randomUUID())
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('WORKBOOK_NOT_FOUND')),
        );
    });

    it('valida el cuerpo', async () => {
      for (const body of [
        {},
        { name: 'Sin snapshot' },
        { name: '', snapshotId },
        { name: 'X', snapshotId: 'no-es-uuid' },
        { name: 'X', snapshotId, otro: 1 },
      ]) {
        await open(body).expect(400);
      }
    });

    it('un Viewer no puede; un Editor sí; otra organización 404 y sin sesión 401', async () => {
      await setBobRole('viewer');
      await open({ name: 'De Bob', snapshotId }, 'bob-session')
        .expect(403)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('FORBIDDEN')),
        );
      await setBobRole('editor');
      await open({ name: 'De Bob', snapshotId }, 'bob-session').expect(201);

      await open({ name: 'De Carol', snapshotId }, 'carol-session').expect(404);
      await request(app.getHttpServer())
        .post(`${base}/workbooks/${workbookId}/worksheets/from-catalog`)
        .send({ name: 'Sin sesión', snapshotId })
        .expect(401);
    });
  });
});
