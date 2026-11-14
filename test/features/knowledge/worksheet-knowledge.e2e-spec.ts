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
import request from 'supertest';
import type { AuthenticatedIdentity } from '../../../src/auth/authenticated-request.js';
import { DescopeService } from '../../../src/auth/descope.service.js';
import { ChangesetsModule } from '../../../src/changesets/changesets.module.js';
import type { Changeset } from '../../../src/changesets/changesets.types.js';
import { publicError } from '../../../src/common/http/public-error.js';
import { configureHttp } from '../../../src/configure-http.js';
import { POSTGRESQL_CONNECTION } from '../../../src/database/postgresql.connection.js';
import {
  AI_SERVICE_CLIENT,
  AiServiceClient,
} from '../../../src/knowledge/ai-service.client.js';
import { KnowledgeSyncWorker } from '../../../src/knowledge/knowledge-sync.worker.js';
import { KnowledgeModule } from '../../../src/knowledge/knowledge.module.js';
import {
  KNOWLEDGE_DEFAULTS,
  KNOWLEDGE_OPTIONS,
  type SourceType,
} from '../../../src/knowledge/knowledge.types.js';
import type { OrganizationRole } from '../../../src/organizations/organization-roles.js';
import { OrganizationsService } from '../../../src/organizations/organizations.service.js';
import { ProjectsService } from '../../../src/projects/projects.service.js';
import { UsersService } from '../../../src/users/users.service.js';
import { WorksheetImportsModule } from '../../../src/worksheet-imports/worksheet-imports.module.js';
import type { WorksheetImport } from '../../../src/worksheet-imports/worksheet-imports.types.js';
import { WorksheetsModule } from '../../../src/worksheets/worksheets.module.js';
import type {
  ProjectScope,
  Worksheet,
} from '../../../src/worksheets/worksheets.types.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';
import {
  FIXTURE_COLUMNS,
  ROW_IDS,
  SECOND_REVISION_ID,
  seedTwoRevisions,
} from '../worksheets/support/row-fixtures.js';
import {
  knowledgePath,
  startAiHttpFixture,
  TEST_SERVICE_TOKEN,
} from './support/ai-http-fixture.js';

const FIXED_TIME = '2026-11-14T16:00:00.000Z';
const PRIVATE_NAME = 'Identidad personal de prueba';
const carol: AuthenticatedIdentity = {
  ...alice,
  subject: 'carol',
  email: 'carol@example.test',
};
const SESSIONS = new Map([
  ['alice-session', alice],
  ['bob-session', bob],
  ['carol-session', carol],
]);
const KNOWLEDGE_COLUMNS = [
  ...FIXTURE_COLUMNS.map((column) => ({
    ...column,
    required: column.name === 'SKU',
  })),
  {
    name: 'Estado',
    type: 'selection',
    options: [{ label: 'Nuevo' }, { label: 'Usado' }],
  },
  {
    name: 'Importe',
    type: 'calculated',
    formula: {
      expression: {
        op: 'mul',
        args: [{ column: 'Precio' }, { column: 'Cantidad' }],
      },
      scale: 2,
      rounding: 'half_up',
    },
  },
];

describe('Conocimiento de hojas: Nest sincroniza las fuentes por HTTP', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let ai: Awaited<ReturnType<typeof startAiHttpFixture>>;
  let app: INestApplication;
  let worker: KnowledgeSyncWorker;
  let scope: ProjectScope;
  let bobScope: ProjectScope;
  let aliceId: string;
  let carolId: string;
  let workbookId: string;
  let worksheet: Worksheet;
  const validateSession = jest.fn<DescopeService['validateSession']>();

  const pool = () => database.connection.pool;
  const scopePath = ({ organizationId, projectId }: ProjectScope) =>
    `/api/v1/organizations/${organizationId}/projects/${projectId}`;

  beforeAll(async () => {
    database = await createTestDatabase();
    ai = await startAiHttpFixture();
    const module = await Test.createTestingModule({
      imports: [
        KnowledgeModule,
        WorksheetsModule,
        ChangesetsModule,
        WorksheetImportsModule,
      ],
    })
      .overrideProvider(POSTGRESQL_CONNECTION)
      .useValue(database.connection)
      .overrideProvider(DescopeService)
      .useValue({ validateSession })
      .overrideProvider(AI_SERVICE_CLIENT)
      .useValue(
        new AiServiceClient({
          url: ai.url,
          token: TEST_SERVICE_TOKEN,
          timeoutMs: 2_000,
        }),
      )
      .overrideProvider(KNOWLEDGE_OPTIONS)
      .useValue({
        ...KNOWLEDGE_DEFAULTS,
        autoStart: false,
        clock: () => new Date(FIXED_TIME),
      })
      .compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
    worker = app.get(KnowledgeSyncWorker);
  });

  beforeEach(async () => {
    validateSession.mockReset().mockImplementation(async (token) => {
      const identity = SESSIONS.get(token);
      if (!identity) throw new Error('Sesión de prueba inválida.');
      return {
        jwt: token,
        token: {
          sub: identity.subject,
          iss: identity.issuer,
          email: identity.email,
        },
      };
    });
    ai.reset();
    await pool().query('TRUNCATE estadistica_forms.app_users CASCADE');
    await pool().query('TRUNCATE estadistica_forms.knowledge_sync_state');
    const users = app.get(UsersService);
    aliceId = (await users.provision(alice)).id;
    await users.provision(bob);
    carolId = (await users.provision(carol)).id;
    await pool().query(
      'UPDATE estadistica_forms.app_users SET display_name = $1 WHERE id = $2',
      [PRIVATE_NAME, aliceId],
    );
    scope = await createTeamProject(alice, 'Equipo de Alice');
    bobScope = await createTeamProject(bob, 'Equipo de Bob');
    workbookId = await createWorkbook('Libro de productos');
    worksheet = await createWorksheet('Productos activos', workbookId);
  });

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await ai?.close();
      await database?.close();
    }
  });

  it('cambia a la revisión vigente y conserva solo las filas vivas de cada proyecto', async () => {
    const workbookOfBob = await createWorkbook(
      'Libro ajeno',
      bobScope,
      'bob-session',
    );
    const worksheetOfBob = await createWorksheet(
      'Hoja ajena',
      workbookOfBob,
      bobScope,
      'bob-session',
    );
    await worker.syncOnce();
    expect(documentsOf('worksheet', worksheet.id)).toHaveLength(1);
    ai.reset();

    await seedTwoRevisions(pool(), worksheet, scope.organizationId, aliceId);
    const [selection, formula] = worksheet.columns.slice(-2);
    const option = selection.options?.find(({ label }) => label === 'Nuevo');
    if (!option || !formula.formula) {
      throw new Error(
        'La hoja de prueba necesita una selección y una fórmula.',
      );
    }
    await pool().query(
      `UPDATE estadistica_forms.worksheet_row_versions
       SET cell_values = cell_values || $3::jsonb
       WHERE worksheet_id = $1 AND row_id = $2`,
      [
        worksheet.id,
        ROW_IDS.a,
        JSON.stringify({ [selection.id]: option.id, [formula.id]: '999.99' }),
      ],
    );
    const outcome = await worker.syncOnce();

    expect(outcome).toMatchObject({ rejected: 0, interrupted: false });
    expect(ai.requests).toContainEqual(
      expect.objectContaining({
        method: 'PUT',
        path: knowledgePath(key('worksheet', worksheet.id)),
        authorization: `Bearer ${TEST_SERVICE_TOKEN}`,
        requestId: expect.stringMatching(/^knowledge-sync:/),
      }),
    );
    const [summary, ...rows] = documentsOf('worksheet', worksheet.id);
    expect(summary).toMatchObject({
      documentId: 'worksheet',
      metadata: { kind: 'worksheet' },
    });
    for (const heading of [
      'Productos activos',
      'SKU',
      'Precio',
      'Estado',
      'Nuevo',
      'Usado',
      'Importe',
    ]) {
      expect(summary.text).toContain(heading);
    }
    expect(summary.text).toMatch(/obligatori/i);
    expect(summary.text).toContain('fórmula: («Precio» × «Cantidad»)');
    expect(rows.map((row) => row.documentId)).toEqual([
      `row:${ROW_IDS.a}`,
      `row:${ROW_IDS.b}`,
      `row:${ROW_IDS.d}`,
      `row:${ROW_IDS.e}`,
    ]);
    expect(rows[0].text).toContain('Importe: 31.50');
    expect(rows[0].text).toContain('Estado: Nuevo');
    expect(rows[0].text).not.toContain('999.99');
    expect(rows[0].text).not.toContain(option.id);
    expect(rows[1].text).toContain('B-002');
    expect(rows[1].text).toContain('12.00');
    expect(rows[1].text).not.toContain('9.99');
    expect(rows[1].metadata).toMatchObject({
      kind: 'worksheet_row',
      revision_id: SECOND_REVISION_ID,
      row_id: ROW_IDS.b,
      source_row: 2,
    });
    expect(
      ai.requests.some(({ path }) => path.includes(bobScope.projectId)),
    ).toBe(false);

    ai.reset();
    await send(
      'post',
      `/api/v1/projects/${bobScope.projectId}/knowledge/reindex`,
      'bob-session',
    ).expect(202);
    await worker.syncOnce();
    const bobDocuments = documentsOf('worksheet', worksheetOfBob.id, bobScope);
    expect(bobDocuments).toHaveLength(1);
    expect(bobDocuments[0].text).toContain('Hoja ajena');
    expect(JSON.stringify(ai.requests)).not.toContain('B-002');
    expect(
      ai.requests.every(({ path }) =>
        path.includes(
          `/organizations/${bobScope.organizationId}/projects/${bobScope.projectId}/`,
        ),
      ),
    ).toBe(true);
  });

  it('actualiza el nombre y el archivado del libro y de la hoja, y una pasada en reposo no escribe', async () => {
    await worker.syncOnce();
    ai.reset();
    await expect(worker.syncOnce()).resolves.toMatchObject({
      replaced: 0,
      removed: 0,
    });
    expect(ai.requests).toEqual([]);

    await send('patch', `${scopePath(scope)}/worksheets/${worksheet.id}`)
      .send({ name: 'Productos renombrados' })
      .expect(200);
    await worker.syncOnce();
    expect(documentsOf('worksheet', worksheet.id)[0].text).toContain(
      'Productos renombrados',
    );
    expect(documentsOf('workbook', workbookId)[0].text).toContain(
      'Productos renombrados',
    );

    ai.reset();
    await send('patch', `${scopePath(scope)}/workbooks/${workbookId}`)
      .send({ name: 'Libro renombrado' })
      .expect(200);
    await send(
      'post',
      `${scopePath(scope)}/workbooks/${workbookId}/archive`,
    ).expect(200);
    await worker.syncOnce();
    const archivedWorkbook = documentsOf('workbook', workbookId)[0];
    expect(archivedWorkbook.text).toContain('Libro renombrado');
    expect(archivedWorkbook.metadata.archived).toBe(true);
    expect(documentsOf('worksheet', worksheet.id)[0].metadata.archived).toBe(
      true,
    );

    ai.reset();
    await send(
      'post',
      `${scopePath(scope)}/workbooks/${workbookId}/restore`,
    ).expect(200);
    await worker.syncOnce();
    expect(documentsOf('workbook', workbookId)[0].metadata.archived).toBe(
      false,
    );
    expect(documentsOf('worksheet', worksheet.id)[0].metadata.archived).toBe(
      false,
    );

    ai.reset();
    await send(
      'post',
      `${scopePath(scope)}/worksheets/${worksheet.id}/archive`,
    ).expect(200);
    await worker.syncOnce();
    const workbookWithArchivedSheet = documentsOf('workbook', workbookId)[0];
    expect(workbookWithArchivedSheet.metadata.archived).toBe(false);
    expect(workbookWithArchivedSheet.text).toMatch(/archivad/i);
    expect(documentsOf('worksheet', worksheet.id)[0].metadata.archived).toBe(
      true,
    );
  });

  it('mantiene el orden y recorre las filas de más de una página', async () => {
    const rowCount = 105;
    await pool().query(
      `INSERT INTO estadistica_forms.worksheet_row_versions
         (organization_id, worksheet_id, row_id, from_sequence, sort_key, cell_values)
       SELECT $1, $2, 'fila-' || lpad(row_number::text, 3, '0'), 1, 'same-order',
              jsonb_build_object($3::text, 'SKU-' || row_number)
       FROM generate_series($4::int, 1, -1) AS sequence(row_number)`,
      [scope.organizationId, worksheet.id, worksheet.columns[0].id, rowCount],
    );
    await pool().query(
      'UPDATE estadistica_forms.worksheet_revisions SET row_count = $1 WHERE id = $2',
      [rowCount, worksheet.headRevision.id],
    );

    await worker.syncOnce();

    const [, ...rows] = documentsOf('worksheet', worksheet.id);
    expect(rows.map(({ documentId }) => documentId)).toEqual(
      Array.from(
        { length: rowCount },
        (_, index) => `row:fila-${String(index + 1).padStart(3, '0')}`,
      ),
    );
    expect(rows.map(({ metadata }) => metadata.source_row)).toEqual(
      Array.from({ length: rowCount }, (_, index) => index + 1),
    );
  });

  it('la organización se replica por proyecto, actualiza roles y recuentos y conserva el acceso de lectura al archivarse', async () => {
    const sibling = await createProjectIn(
      scope.organizationId,
      alice,
      'Proyecto hermano',
    );
    await setCarolRole('viewer');
    await worker.syncOnce();
    const sourceId = scope.organizationId;
    const [first] = documentsOf('organization', sourceId);
    expect(documentsOf('organization', sourceId, sibling)).toEqual([first]);
    expect(first.text).toContain('Equipo de Alice');
    expect(first.metadata.project_count).toBe(2);
    expect(first.text).toContain('owner: 1');
    expect(first.text).toContain('viewer: 1');
    expect(JSON.stringify(ai.requests)).not.toMatch(
      /@example\.test|Identidad personal de prueba/,
    );

    ai.reset();
    await setCarolRole('editor');
    await worker.syncOnce();
    const [rolesUpdated] = documentsOf('organization', sourceId);
    expect(rolesUpdated.text).toContain('editor: 1');
    expect(rolesUpdated.text).toContain('viewer: 0');
    expect(ai.requests.map(({ path }) => path).sort()).toEqual(
      [
        knowledgePath(key('organization', sourceId)),
        knowledgePath(key('organization', sourceId, sibling)),
      ].sort(),
    );

    const path = `/api/v1/projects/${scope.projectId}/knowledge`;
    for (const role of ['editor', 'viewer'] as const) {
      await setCarolRole(role);
      await send('get', path, 'carol-session').expect(200);
      await send('post', `${path}/reindex`, 'carol-session')
        .expect(403)
        .expect(({ body }) =>
          expect(body).toMatchObject(publicError('FORBIDDEN')),
        );
    }
    await send('get', path, 'bob-session').expect(404);
    await request(app.getHttpServer()).get(path).expect(401);
    await setCarolRole('manager');
    await send('post', `${path}/reindex`, 'carol-session').expect(202);

    ai.reset();
    await send('post', `/api/v1/organizations/${sourceId}/archive`).expect(200);
    await worker.syncOnce();
    expect(documentsOf('organization', sourceId)[0].metadata.archived).toBe(
      true,
    );
    await send('get', path, 'carol-session').expect(200);
    await send('post', `${path}/reindex`, 'carol-session')
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('ORGANIZATION_ARCHIVED')),
      );
  });

  it('resume los borradores abiertos y retira el que termina sin mandar operaciones, autores ni motivos', async () => {
    const draft = await createDraft('Preparar nuevos productos');
    await worker.syncOnce();
    expect(documentsOf('changeset', draft.id)[0].text).toContain(
      'Preparar nuevos productos',
    );

    ai.reset();
    const { body: saved } = await send(
      'put',
      `${scopePath(scope)}/changesets/${draft.id}/operations`,
    )
      .set('If-Match', `"${draft.draftVersion}"`)
      .send({
        operations: [
          {
            type: 'insert_row',
            rowId: ROW_IDS.a,
            sortKey: 'a',
            values: { [worksheet.columns[0].id]: 'VALOR-PROPUESTO-SECRET' },
          },
          {
            type: 'insert_row',
            rowId: ROW_IDS.b,
            sortKey: 'b',
            values: { [worksheet.columns[0].id]: 'OTRO-VALOR-PROPUESTO' },
          },
        ],
      })
      .expect(200);
    await worker.syncOnce();
    const edited = documentsOf('changeset', draft.id)[0];
    expect(edited.metadata.operation_count).toBe(2);
    expect(edited.text).toContain('insert_row: 2');
    expect(JSON.stringify(ai.requests)).not.toMatch(
      /VALOR-PROPUESTO|Identidad personal de prueba/,
    );

    ai.reset();
    const { body: pending } = await send(
      'post',
      `${scopePath(scope)}/changesets/${draft.id}/submit`,
    )
      .send({ draftVersion: saved.changeset.draftVersion })
      .expect(200);
    await worker.syncOnce();
    expect(documentsOf('changeset', draft.id)[0].metadata.status).toBe(
      'pending_review',
    );

    ai.reset();
    await send('post', `${scopePath(scope)}/changesets/${draft.id}/decisions`)
      .send({
        decision: 'accept',
        contentHash: pending.changeset.contentHash,
        draftVersion: pending.changeset.draftVersion,
        expectedHeadRevisionId: pending.changeset.baseRevisionId,
        reason: 'Motivo privado del revisor',
      })
      .expect(201);
    await worker.syncOnce();
    const approved = documentsOf('changeset', draft.id)[0];
    expect(approved.metadata).toMatchObject({
      decision: 'accept',
      status: 'approved',
    });
    expect(JSON.stringify(ai.requests)).not.toContain(
      'Motivo privado del revisor',
    );

    ai.reset();
    await send('post', `${scopePath(scope)}/changesets/${draft.id}/apply`)
      .set('Idempotency-Key', `aplicar-${draft.id}`)
      .send({
        contentHash: pending.changeset.contentHash,
        expectedHeadRevisionId: pending.changeset.baseRevisionId,
      })
      .expect(200);
    await worker.syncOnce();
    expect(ai.requests).toContainEqual(
      expect.objectContaining({
        method: 'DELETE',
        path: knowledgePath(key('changeset', draft.id)),
      }),
    );
    expect(
      ai.requests.some(
        ({ method, path }) =>
          method === 'PUT' &&
          path === knowledgePath(key('changeset', draft.id)),
      ),
    ).toBe(false);
  });

  it('reemplaza solo la última importación de cada hoja y omite hashes, archivos y vistas guardadas', async () => {
    const first = await upload(worksheet, 'sku\nimportado-viejo\n');
    await pool().query(
      'UPDATE estadistica_forms.worksheet_imports SET created_at = $1 WHERE id = $2',
      ['2026-11-13T00:00:00.000Z', first.id],
    );
    const otherWorksheet = await createWorksheet('Otros productos', workbookId);
    const other = await upload(otherWorksheet, 'sku\nimportado-otra-hoja\n');
    await worker.syncOnce();
    expect(documentsOf('worksheet_import', first.id)).toHaveLength(1);
    expect(documentsOf('worksheet_import', other.id)).toHaveLength(1);
    ai.reset();

    const current = await upload(
      worksheet,
      'sku,cabecera-privada\nimportado-nuevo,x\n,y\n',
      [2],
    );
    await send(
      'post',
      `${scopePath(scope)}/worksheets/${worksheet.id}/saved-views`,
    )
      .send({
        name: 'Vista personal privada',
        visibility: 'personal',
        query: {},
      })
      .expect(201);
    await send(
      'post',
      `${scopePath(scope)}/worksheets/${worksheet.id}/saved-views`,
    )
      .send({ name: 'Vista equipo', visibility: 'team', query: {} })
      .expect(201);
    await send(
      'post',
      `${scopePath(scope)}/worksheets/${worksheet.id}/import-mappings`,
    )
      .send({ name: 'Plantilla de entrada', mapping: importOptions(worksheet) })
      .expect(201);
    await worker.syncOnce();

    const [importDocument] = documentsOf('worksheet_import', current.id);
    expect(importDocument.metadata).toMatchObject({
      format: 'csv',
      row_count: 2,
      excluded_count: 1,
    });
    expect(importDocument.text).toContain('CELL_REQUIRED');
    expect(ai.requests).toContainEqual(
      expect.objectContaining({
        method: 'DELETE',
        path: knowledgePath(key('worksheet_import', first.id)),
      }),
    );
    expect(
      ai.requests.some(
        ({ path }) => path === knowledgePath(key('worksheet_import', other.id)),
      ),
    ).toBe(false);
    const payload = JSON.stringify(ai.requests);
    expect(payload).not.toMatch(
      /importado-nuevo|cabecera-privada|Vista personal privada|Vista equipo|Plantilla de entrada/,
    );
    expect(payload).not.toContain(current.fileHash);
    expect(payload).not.toContain(current.includedHash);
  });

  it('reindexar conserva el borrado de una fuente que dejó de estar vigente', async () => {
    const draft = await createDraft('Borrador próximo a cancelar');
    await worker.syncOnce();
    expect(documentsOf('changeset', draft.id)).toHaveLength(1);
    ai.reset();

    await send(
      'post',
      `${scopePath(scope)}/changesets/${draft.id}/cancel`,
    ).expect(200);
    const statusPath = `/api/v1/projects/${scope.projectId}/knowledge`;
    await send('post', `${statusPath}/reindex`).expect(202);

    await send('get', statusPath)
      .expect(200)
      .expect(({ body }) => {
        expect(body.sources).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              sourceType: 'worksheet',
              sourceId: worksheet.id,
              pending: true,
              syncedAt: null,
            }),
          ]),
        );
      });
    const result = await worker.syncOnce();

    expect(result).toMatchObject({ removed: 1, replaced: 4 });
    expect(ai.requests).toContainEqual(
      expect.objectContaining({
        method: 'DELETE',
        path: knowledgePath(key('changeset', draft.id)),
      }),
    );
    expect(documentsOf('worksheet', worksheet.id)).toHaveLength(1);
    expect(
      ai.requests.some(({ path }) => path.includes(bobScope.projectId)),
    ).toBe(false);
  });

  function send(
    method: 'get' | 'post' | 'patch' | 'put',
    path: string,
    session = 'alice-session',
  ) {
    return request(app.getHttpServer())
      [method](path)
      .auth(session, { type: 'bearer' });
  }

  function key(sourceType: SourceType, sourceId: string, forProject = scope) {
    return { ...forProject, sourceType, sourceId };
  }

  function documentsOf(
    sourceType: SourceType,
    sourceId: string,
    forProject = scope,
  ) {
    return ai.documentsOf(key(sourceType, sourceId, forProject));
  }

  async function createTeamProject(
    identity: AuthenticatedIdentity,
    organizationName: string,
  ) {
    const { organization } = await app
      .get(OrganizationsService)
      .create(identity, organizationName);
    return createProjectIn(organization.id, identity, projectInput.name);
  }

  async function createProjectIn(
    organizationId: string,
    identity: AuthenticatedIdentity,
    name: string,
  ) {
    const { id: projectId } = await app
      .get(ProjectsService)
      .create(identity, { ...projectInput, name });
    await pool().query(
      'UPDATE estadistica_forms.projects SET organization_id = $1 WHERE id = $2',
      [organizationId, projectId],
    );
    return { organizationId, projectId };
  }

  async function createWorkbook(
    name: string,
    project = scope,
    session = 'alice-session',
  ) {
    const { body } = await send(
      'post',
      `${scopePath(project)}/workbooks`,
      session,
    )
      .send({ name })
      .expect(201);
    return body.workbook.id as string;
  }

  async function createWorksheet(
    name: string,
    workbook: string,
    project = scope,
    session = 'alice-session',
  ) {
    const { body } = await send(
      'post',
      `${scopePath(project)}/workbooks/${workbook}/worksheets`,
      session,
    )
      .send({ name, columns: KNOWLEDGE_COLUMNS })
      .expect(201);
    return body.worksheet as Worksheet;
  }

  async function setCarolRole(role: OrganizationRole) {
    await pool().query(
      `INSERT INTO estadistica_forms.organization_members
         (organization_id, user_id, role, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = $3`,
      [scope.organizationId, carolId, role, FIXED_TIME],
    );
  }

  async function createDraft(title: string) {
    const { body } = await send(
      'post',
      `${scopePath(scope)}/worksheets/${worksheet.id}/changesets`,
    )
      .send({ title })
      .expect(201);
    return body.changeset as Changeset;
  }

  async function upload(
    sheet: Worksheet,
    csv: string,
    excludeRows: readonly number[] = [],
  ) {
    const { body } = await send(
      'post',
      `${scopePath(scope)}/worksheets/${sheet.id}/imports`,
    )
      .attach('file', Buffer.from(csv), 'productos.csv')
      .field(
        'options',
        JSON.stringify({ ...importOptions(sheet), excludeRows }),
      )
      .expect(201);
    return body.import as WorksheetImport;
  }

  function importOptions(sheet: Worksheet) {
    return {
      mode: 'append',
      columns: [{ header: 'sku', columnId: sheet.columns[0].id }],
    };
  }
});
