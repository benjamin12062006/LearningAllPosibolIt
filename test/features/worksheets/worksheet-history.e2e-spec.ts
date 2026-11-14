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
import { ChangesetsModule } from '../../../src/changesets/changesets.module.js';
import { publicError } from '../../../src/common/http/public-error.js';
import { configureHttp } from '../../../src/configure-http.js';
import { POSTGRESQL_CONNECTION } from '../../../src/database/postgresql.connection.js';
import { OrganizationsRepository } from '../../../src/organizations/organizations.repository.js';
import { ProjectsModule } from '../../../src/projects/projects.module.js';
import { ProjectsRepository } from '../../../src/projects/projects.repository.js';
import { UsersService } from '../../../src/users/users.service.js';
import { WorksheetExportsModule } from '../../../src/worksheet-exports/worksheet-exports.module.js';
import { WORKSHEET_EXPORT_OPTIONS } from '../../../src/worksheet-exports/worksheet-exports.types.js';
import { WorksheetImportsModule } from '../../../src/worksheet-imports/worksheet-imports.module.js';
import { WorksheetsModule } from '../../../src/worksheets/worksheets.module.js';
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

const PRODUCTS_CSV = 'sku,precio\nA-1,10.50\nB-2,3.00\nC-3,\n';

/**
 * H2 (plan 02 de cierre, P9): el historial de una hoja. Cada módulo lista lo
 * suyo bajo la misma hoja: revisiones, borradores, importaciones y
 * exportaciones. La hoja de Alice recibe una importación aplicada (revisión 2),
 * un borrador manual abierto y una exportación.
 */
describe('Historial de una hoja por HTTP', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let root: string;
  let base: string;
  let organizationId: string;
  let bobId: string;
  let worksheetId: string;
  let importedChangesetId: string;
  let manualChangesetId: string;
  let importId: string;
  let exportId: string;
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

  const history = async (
    what: 'revisions' | 'changesets' | 'imports' | 'exports',
    query = '',
    session: Session = 'alice-session',
  ) =>
    (
      await send(
        'get',
        `/worksheets/${worksheetId}/${what}${query}`,
        session,
      ).expect(200)
    ).body;

  /** Importa el CSV, lo envía, lo aprueba y lo aplica: la hoja pasa a la revisión 2. */
  async function importAndApply() {
    const { body: worksheet } = await send(
      'get',
      `/worksheets/${worksheetId}`,
    ).expect(200);
    const [sku, price] = worksheet.worksheet.columns.map(
      ({ id }: { id: string }) => id,
    );
    const { body: imported } = await send(
      'post',
      `/worksheets/${worksheetId}/imports`,
    )
      .attach('file', Buffer.from(PRODUCTS_CSV, 'utf8'), 'productos.csv')
      .field(
        'options',
        JSON.stringify({
          mode: 'append',
          columns: [
            { header: 'sku', columnId: sku },
            { header: 'precio', columnId: price },
          ],
        }),
      )
      .expect(201);
    importId = imported.import.id;
    importedChangesetId = imported.changeset.id;

    const { body: sent } = await send(
      'post',
      `/changesets/${importedChangesetId}/submit`,
    )
      .send({ draftVersion: imported.changeset.draftVersion })
      .expect(200);
    const pending = sent.changeset;
    await send('post', `/changesets/${pending.id}/decisions`)
      .send({
        decision: 'accept',
        contentHash: pending.contentHash,
        draftVersion: pending.draftVersion,
        expectedHeadRevisionId: pending.baseRevisionId,
      })
      .expect(201);
    await send('post', `/changesets/${pending.id}/apply`)
      .set('Idempotency-Key', `historial-${pending.id}`)
      .send({
        contentHash: pending.contentHash,
        expectedHeadRevisionId: pending.baseRevisionId,
      })
      .expect(200);
  }

  async function setBobAsViewer() {
    await pool().query(
      `INSERT INTO estadistica_forms.organization_members
         (organization_id, user_id, role, created_at)
       VALUES ($1, $2, 'viewer', '2026-11-14T09:00:00.000Z')`,
      [organizationId, bobId],
    );
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    root = await mkdtemp(join(tmpdir(), 'worksheet-history-'));
    const module = await Test.createTestingModule({
      imports: [
        ProjectsModule,
        WorksheetsModule,
        ChangesetsModule,
        WorksheetImportsModule,
        WorksheetExportsModule,
      ],
    })
      .overrideProvider(POSTGRESQL_CONNECTION)
      .useValue(database.connection)
      .overrideProvider(DescopeService)
      .useValue({ validateSession })
      .overrideProvider(ARTIFACT_STORE_OPTIONS)
      .useValue({ root })
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
    const users = app.get(UsersService);
    const owner = await users.provision(alice);
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

    const { body: workbook } = await send('post', '/workbooks')
      .send({ name: 'Libro' })
      .expect(201);
    const { body: worksheet } = await send(
      'post',
      `/workbooks/${workbook.workbook.id}/worksheets`,
    )
      .send({
        name: 'Inventario',
        columns: [
          { name: 'SKU', type: 'text', required: true },
          { name: 'Precio', type: 'decimal' },
        ],
      })
      .expect(201);
    worksheetId = worksheet.worksheet.id;

    // Aplicar con un solo miembro: Alice puede aprobar su propio borrador.
    await importAndApply();
    const { body: draft } = await send(
      'post',
      `/worksheets/${worksheetId}/changesets`,
    )
      .send({ title: 'Ajustes a mano' })
      .expect(201);
    manualChangesetId = draft.changeset.id;
    const { body: exported } = await send(
      'post',
      `/worksheets/${worksheetId}/exports`,
    )
      .send({ format: 'csv' })
      .expect(201);
    exportId = exported.export.id;
  });
  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await database?.close();
      if (root) await rm(root, { recursive: true, force: true });
    }
  });

  describe('revisiones', () => {
    it('de la más nueva a la más antigua, con su origen y su borrador', async () => {
      const { revisions, page } = await history('revisions');

      expect(revisions).toEqual([
        {
          id: expect.any(String),
          sequence: 2,
          schemaVersion: 1,
          source: 'changeset',
          rowCount: 3,
          changesetId: importedChangesetId,
          createdBy: expect.any(String),
          createdAt: expect.any(String),
        },
        {
          id: expect.any(String),
          sequence: 1,
          schemaVersion: 1,
          source: 'initialize',
          rowCount: 0,
          changesetId: null,
          createdBy: expect.any(String),
          createdAt: expect.any(String),
        },
      ]);
      expect(page).toEqual({ limit: 20, offset: 0, hasMore: false });
      const { body } = await send('get', `/worksheets/${worksheetId}`).expect(
        200,
      );
      expect(revisions[0].id).toBe(body.worksheet.headRevision.id);
    });

    it('pagina', async () => {
      const first = await history('revisions', '?limit=1');
      const second = await history('revisions', '?limit=1&offset=1');

      expect(
        first.revisions.map((r: { sequence: number }) => r.sequence),
      ).toEqual([2]);
      expect(first.page).toEqual({ limit: 1, offset: 0, hasMore: true });
      expect(
        second.revisions.map((r: { sequence: number }) => r.sequence),
      ).toEqual([1]);
      expect(second.page.hasMore).toBe(false);
    });
  });

  describe('borradores', () => {
    it('todos, del más reciente al más antiguo, sin las operaciones', async () => {
      const { changesets } = await history('changesets');

      expect(changesets.map((c: { id: string }) => c.id)).toEqual([
        manualChangesetId,
        importedChangesetId,
      ]);
      expect(changesets[1]).toMatchObject({
        source: 'import',
        status: 'applied',
        operationCount: 3,
        appliedRevisionId: expect.any(String),
      });
      expect(changesets[0]).toMatchObject({
        source: 'manual',
        title: 'Ajustes a mano',
        status: 'draft',
        operationCount: 0,
        appliedRevisionId: null,
      });
      for (const changeset of changesets) {
        expect(changeset).not.toHaveProperty('operations');
      }
    });

    it('filtra por estado', async () => {
      const drafts = await history('changesets', '?status=draft');
      const applied = await history('changesets', '?status=applied');
      const cancelled = await history('changesets', '?status=cancelled');

      expect(drafts.changesets.map((c: { id: string }) => c.id)).toEqual([
        manualChangesetId,
      ]);
      expect(applied.changesets.map((c: { id: string }) => c.id)).toEqual([
        importedChangesetId,
      ]);
      expect(cancelled.changesets).toEqual([]);
      await send(
        'get',
        `/worksheets/${worksheetId}/changesets?status=otro`,
      ).expect(400);
    });

    it('el resumen coincide con el borrador leído entero', async () => {
      const { changesets } = await history('changesets', '?status=applied');
      const { body } = await send(
        'get',
        `/changesets/${importedChangesetId}`,
      ).expect(200);

      const { operations, ...rest } = body.changeset;
      expect(changesets[0]).toEqual({
        ...rest,
        operationCount: operations.length,
      });
    });
  });

  describe('importaciones y exportaciones', () => {
    it('importaciones: su procedencia, sin las filas excluidas, y en qué quedó su borrador', async () => {
      const { imports, page } = await history('imports');

      expect(imports).toEqual([
        expect.objectContaining({
          id: importId,
          worksheetId,
          changesetId: importedChangesetId,
          format: 'csv',
          excludedRowCount: 0,
          changesetStatus: 'applied',
          report: expect.objectContaining({ rows: 3, inserted: 3 }),
        }),
      ]);
      expect(imports[0]).not.toHaveProperty('excludedRows');
      expect(page.hasMore).toBe(false);
    });

    it('exportaciones: lo mismo que al leer una, sin la clave del archivo', async () => {
      const { exports } = await history('exports');
      const { body } = await send(
        'get',
        `/worksheet-exports/${exportId}`,
      ).expect(200);

      expect(exports).toHaveLength(1);
      expect(exports[0]).toEqual(body.export);
      expect(JSON.stringify(exports)).not.toContain('artifactKey');
    });
  });

  describe('acceso', () => {
    const lists = ['revisions', 'changesets', 'imports', 'exports'] as const;

    it('un Viewer lee el historial; también el de una hoja archivada', async () => {
      await setBobAsViewer();
      await send('post', `/worksheets/${worksheetId}/archive`).expect(200);

      for (const what of lists) {
        const body = await history(what, '', 'bob-session');
        expect(body[what].length).toBeGreaterThan(0);
      }
    });

    it('otra organización recibe 404, sin sesión 401 y una hoja que no existe 404', async () => {
      for (const what of lists) {
        await send('get', `/worksheets/${worksheetId}/${what}`, 'carol-session')
          .expect(404)
          .expect(({ body }) => expect(body.code).toMatch(/_NOT_FOUND$/));
        await request(app.getHttpServer())
          .get(`${base}/worksheets/${worksheetId}/${what}`)
          .expect(401);
        await send('get', `/worksheets/${randomUUID()}/${what}`)
          .expect(404)
          .expect(({ body }) =>
            expect(body).toMatchObject(publicError('WORKSHEET_NOT_FOUND')),
          );
        await send('get', `/worksheets/${worksheetId}/${what}?limit=0`).expect(
          400,
        );
      }
    });

    it('lo de otra hoja no aparece en el historial de esta', async () => {
      const { body: worksheet } = await send(
        'get',
        `/worksheets/${worksheetId}`,
      ).expect(200);
      const { body: other } = await send(
        'post',
        `/workbooks/${worksheet.worksheet.workbookId}/worksheets`,
      )
        .send({ name: 'Otra', columns: [{ name: 'SKU', type: 'text' }] })
        .expect(201);
      const otherId = other.worksheet.id as string;
      await send('post', `/worksheets/${otherId}/changesets`)
        .send({ title: 'En la otra' })
        .expect(201);
      await send('post', `/worksheets/${otherId}/exports`)
        .send({ format: 'csv' })
        .expect(201);

      const lengths = async (id: string) => {
        const result: number[] = [];
        for (const what of lists) {
          const { body } = await send(
            'get',
            `/worksheets/${id}/${what}`,
          ).expect(200);
          result.push(body[what].length);
        }
        return result;
      };
      expect(await lengths(worksheetId)).toEqual([2, 2, 1, 1]);
      expect(await lengths(otherId)).toEqual([1, 1, 0, 1]);
    });
  });
});
