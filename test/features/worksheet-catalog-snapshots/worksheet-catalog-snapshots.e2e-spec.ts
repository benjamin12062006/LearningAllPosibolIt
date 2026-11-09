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
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { ArtifactStore } from '../../../src/artifacts/artifact.store.js';
import { ARTIFACT_STORE_OPTIONS } from '../../../src/artifacts/artifacts.types.js';
import type { AuthenticatedIdentity } from '../../../src/auth/authenticated-request.js';
import { DescopeService } from '../../../src/auth/descope.service.js';
import { CatalogImportModule } from '../../../src/catalog-import/catalog-import.module.js';
import { CatalogImportService } from '../../../src/catalog-import/catalog-import.service.js';
import { CatalogImportWorker } from '../../../src/catalog-import/catalog-import.worker.js';
import { CATALOG_IMPORT_OPTIONS } from '../../../src/catalog-import/import.types.js';
import { ChangesetsModule } from '../../../src/changesets/changesets.module.js';
import { publicError } from '../../../src/common/http/public-error.js';
import { configureHttp } from '../../../src/configure-http.js';
import { POSTGRESQL_CONNECTION } from '../../../src/database/postgresql.connection.js';
import { EvaluationsModule } from '../../../src/evaluations/evaluations.module.js';
import { EVALUATION_OPTIONS } from '../../../src/evaluations/evaluations.types.js';
import { EvaluationWorker } from '../../../src/evaluations/evaluations.worker.js';
import { ExportsModule } from '../../../src/exports/exports.module.js';
import type { OrganizationRole } from '../../../src/organizations/organization-roles.js';
import { OrganizationsRepository } from '../../../src/organizations/organizations.repository.js';
import { ProjectsModule } from '../../../src/projects/projects.module.js';
import { ProjectsRepository } from '../../../src/projects/projects.repository.js';
import { RulesetsModule } from '../../../src/rulesets/rulesets.module.js';
import { UsersService } from '../../../src/users/users.service.js';
import { WorksheetCatalogSnapshotsModule } from '../../../src/worksheet-catalog-snapshots/worksheet-catalog-snapshots.module.js';
import { WorksheetCatalogSnapshotsRepository } from '../../../src/worksheet-catalog-snapshots/worksheet-catalog-snapshots.repository.js';
import { WorksheetImportsModule } from '../../../src/worksheet-imports/worksheet-imports.module.js';
import { WorksheetsModule } from '../../../src/worksheets/worksheets.module.js';
import { rulesetBody } from '../rulesets/support/ruleset-fixtures.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';

const SESSIONS: Record<string, AuthenticatedIdentity> = {
  'alice-session': alice,
  'bob-session': bob,
};
type Session = keyof typeof SESSIONS;

/** Las cabeceras del catálogo: las columnas que mapea `rulesetBody`, más el identificador. */
const CATALOG_HEADERS = [
  'SKU',
  'Nombre',
  'Descripción',
  'URL',
  'Imagen',
  'Precio',
  'Stock',
  'Marca',
];

/**
 * Tres productos: uno válido con una descripción que empieza por `=`, uno sin
 * marca (lo excluye una regla) y uno con precio cero (inválido). `Interna` no
 * se lleva al catálogo.
 */
const PRODUCT_ROWS = [
  [
    '007',
    'Mesa 007',
    '=Mesa de roble, para seis.',
    'https://tienda.example/007',
    'https://tienda.example/007.jpg',
    '149.90',
    'in_stock',
    'Acme',
    'no sale',
  ],
  [
    '008',
    'Silla 008',
    'Silla de pino.',
    'https://tienda.example/008',
    'https://tienda.example/008.jpg',
    '39.5',
    'out_of_stock',
    '',
    'no sale',
  ],
  [
    '009',
    'Banco 009',
    'Banco de jardín.',
    'https://tienda.example/009',
    'https://tienda.example/009.jpg',
    '0.00',
    'in_stock',
    'Acme',
    'x',
  ],
];

function csvOf(headers: readonly string[], rows: readonly string[][]) {
  const quote = (field: string) =>
    /[",\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
  return [headers, ...rows]
    .map((fields) => fields.map(quote).join(','))
    .join('\r\n');
}

describe('Llevar una revisión de hoja al catálogo y al feed por HTTP (E5.4, T17)', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let root: string;
  let organizationId: string;
  let projectId: string;
  let base: string;
  let bobId: string;
  let worksheetId: string;
  let columns: Record<string, string>;
  const validateSession = jest.fn<DescopeService['validateSession']>();

  beforeAll(async () => {
    database = await createTestDatabase();
    root = await mkdtemp(join(tmpdir(), 'worksheet-catalog-http-'));
    const workerOptions = { autoStart: false, pollMs: 1000, shutdownMs: 1000 };
    const module = await Test.createTestingModule({
      imports: [
        ProjectsModule,
        WorksheetsModule,
        ChangesetsModule,
        WorksheetImportsModule,
        CatalogImportModule,
        RulesetsModule,
        EvaluationsModule,
        ExportsModule,
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
      .useValue(workerOptions)
      .overrideProvider(EVALUATION_OPTIONS)
      .useValue(workerOptions)
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
    // TRUNCATE borra las filas, no los archivos: cada prueba empieza sin ellos.
    for (const folder of ['tmp', 'artifacts', 'exports']) {
      await rm(join(root, folder), { recursive: true, force: true });
    }
    await app.get(ArtifactStore).onModuleInit();

    const users = app.get(UsersService);
    const aliceId = (await users.provision(alice)).id;
    bobId = (await users.provision(bob)).id;
    await app.get(ProjectsRepository).create(bobId, 'Ajena', projectInput);
    const project = await app
      .get(ProjectsRepository)
      .create(aliceId, 'Tienda', projectInput);
    projectId = project.id;
    const [organization] = await app
      .get(OrganizationsRepository)
      .findMemberships(aliceId, { limit: 1, offset: 0 });
    organizationId = organization.id;
    base = `/api/v1/organizations/${organizationId}/projects/${projectId}`;

    const { body: created } = await send('post', `${base}/workbooks`)
      .send({ name: 'Libro' })
      .expect(201);
    const { body } = await send(
      'post',
      `${base}/workbooks/${created.workbook.id}/worksheets`,
    )
      .send({
        name: 'Productos',
        columns: [
          { name: 'SKU', type: 'text', required: true },
          { name: 'Nombre', type: 'text' },
          { name: 'Descripción', type: 'text' },
          { name: 'URL', type: 'text' },
          { name: 'Imagen', type: 'text' },
          { name: 'Precio', type: 'decimal' },
          {
            name: 'Stock',
            type: 'selection',
            options: [{ label: 'in_stock' }, { label: 'out_of_stock' }],
          },
          { name: 'Marca', type: 'text' },
          { name: 'Interna', type: 'text' },
        ],
      })
      .expect(201);
    worksheetId = body.worksheet.id;
    columns = Object.fromEntries(
      body.worksheet.columns.map(
        ({ id, name }: { id: string; name: string }) => [name, id],
      ),
    );
    await importAndPublish(PRODUCT_ROWS);
  });
  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await database?.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  const pool = () => database.connection.pool;

  function send(
    method: 'get' | 'post' | 'delete',
    path: string,
    session: Session = 'alice-session',
  ) {
    return request(app.getHttpServer())
      [method](path)
      .auth(session, { type: 'bearer' });
  }

  function sendToCatalog(body: object, session: Session = 'alice-session') {
    return send(
      'post',
      `${base}/worksheets/${worksheetId}/catalog-snapshots`,
      session,
    ).send(body);
  }

  /** Lo que se lleva al catálogo en casi todas las pruebas: todo menos `Interna`. */
  function catalogRequest(extra: object = {}) {
    return {
      idColumnId: columns.SKU,
      columns: CATALOG_HEADERS.map((name) => columns[name]),
      ...extra,
    };
  }

  /** Importar las filas (E5.1), enviar, aprobar (empresa de una persona) y aplicar. */
  async function importAndPublish(rows: readonly string[][]) {
    const headers = [...CATALOG_HEADERS, 'Interna'];
    const { body } = await send(
      'post',
      `${base}/worksheets/${worksheetId}/imports`,
    )
      .attach('file', Buffer.from(csvOf(headers, rows), 'utf8'), 'hoja.csv')
      .field(
        'options',
        JSON.stringify({
          mode: 'append',
          columns: headers.map((header) => ({
            header,
            columnId: columns[header],
          })),
        }),
      )
      .expect(201);
    const { body: sent } = await send(
      'post',
      `${base}/changesets/${body.changeset.id}/submit`,
    )
      .send({ draftVersion: body.changeset.draftVersion })
      .expect(200);
    const pending = sent.changeset;
    await send('post', `${base}/changesets/${pending.id}/decisions`)
      .send({
        decision: 'accept',
        contentHash: pending.contentHash,
        draftVersion: pending.draftVersion,
        expectedHeadRevisionId: pending.baseRevisionId,
      })
      .expect(201);
    await send('post', `${base}/changesets/${pending.id}/apply`)
      .set('Idempotency-Key', `importar-${pending.id}`)
      .send({
        contentHash: pending.contentHash,
        expectedHeadRevisionId: pending.baseRevisionId,
      })
      .expect(200);
  }

  async function headRevisionId() {
    const { body } = await send(
      'get',
      `${base}/worksheets/${worksheetId}`,
    ).expect(200);
    return body.worksheet.headRevision.id as string;
  }

  /** La subida de siempre, por la ruta existente del propietario. */
  function uploadLegacyCsv(content: string) {
    return send('post', `/api/v1/projects/${projectId}/imports`)
      .field('idColumn', 'SKU')
      .attach('file', Buffer.from(content, 'utf8'), {
        filename: 'catalogo.csv',
        contentType: 'text/csv',
      });
  }

  async function finishImports() {
    await app.get(CatalogImportWorker).runUntilIdle();
  }

  async function readSnapshot(snapshotId: string) {
    const { body } = await send(
      'get',
      `/api/v1/projects/${projectId}/imports/${snapshotId}`,
    ).expect(200);
    return body.snapshot;
  }

  async function catalogRows(snapshotId: string) {
    const { rows } = await pool().query(
      `SELECT source_row AS "sourceRow", external_id AS "externalId",
              original_values AS "originalValues"
       FROM estadistica_forms.catalog_rows
       WHERE snapshot_id = $1
       ORDER BY source_row`,
      [snapshotId],
    );
    return rows;
  }

  /** Evalúa el snapshot, aprueba lo leído, exporta y descarga el TSV (recorrido existente). */
  async function feedTsvOf(snapshotId: string) {
    const { body: accepted } = await send(
      'post',
      `/api/v1/projects/${projectId}/evaluations`,
    )
      .send({ snapshotId, rulesetRevision: 1 })
      .expect(202);
    await app.get(EvaluationWorker).runUntilIdle();
    const { body } = await send('get', accepted.statusUrl).expect(200);
    const { evaluation } = body;
    const { body: exported } = await send(
      'post',
      `/api/v1/projects/${projectId}/exports`,
    )
      .send({
        evaluationId: evaluation.id,
        resultChecksum: evaluation.resultChecksum,
        acceptedInvalidCount: evaluation.counts.invalid,
        acceptedExcludedCount: evaluation.counts.excluded,
      })
      .expect(201);
    const { body: tsv } = await send('get', exported.downloadUrl)
      .responseType('blob')
      .expect(200);
    return { evaluation, tsv: tsv as Buffer };
  }

  async function setBobRole(role: OrganizationRole) {
    await pool().query(
      `INSERT INTO estadistica_forms.organization_members
         (organization_id, user_id, role, created_at)
       VALUES ($1, $2, $3, '2026-11-07T12:00:00.000Z')
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = $3`,
      [organizationId, bobId, role],
    );
  }

  async function count(table: string) {
    const { rows } = await pool().query(
      `SELECT count(*)::int AS n FROM estadistica_forms.${table}`,
    );
    return rows[0].n as number;
  }

  const files = (folder: string) => readdir(join(root, folder));

  it('T17: la revisión llega a un snapshot nuevo cuya evaluación y cuyo TSV son los del CSV equivalente', async () => {
    const { body } = await sendToCatalog(catalogRequest()).expect(202);
    const revisionId = await headRevisionId();

    expect(body).toEqual({
      catalogSnapshot: {
        snapshotId: body.snapshotId,
        worksheetId,
        revisionId,
        revisionSequence: 2,
        createdBy: expect.any(String),
        idColumnId: columns.SKU,
        columns: CATALOG_HEADERS.map((header) => ({
          columnId: columns[header],
          header,
        })),
        query: { filter: null, sort: [] },
        serializerVersion: 'worksheet-catalog/1',
        rowCount: 3,
        sourceHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        createdAt: expect.any(String),
      },
      snapshotId: expect.any(String),
      jobId: expect.any(String),
      status: 'queued',
      statusUrl: `/api/v1/projects/${projectId}/jobs/${body.jobId}`,
    });

    await finishImports();
    const bridged = await readSnapshot(body.snapshotId);
    expect(bridged).toMatchObject({
      status: 'ready',
      idColumn: 'SKU',
      delimiter: 'comma',
      headers: CATALOG_HEADERS,
      rowCount: 3,
      originalName: 'Productos (revisión 2).csv',
    });

    // El mismo catálogo subido como CSV por la ruta de siempre.
    const equivalent = csvOf(
      CATALOG_HEADERS,
      PRODUCT_ROWS.map((row) => row.slice(0, CATALOG_HEADERS.length)),
    );
    const { body: legacy } = await uploadLegacyCsv(equivalent).expect(202);
    await finishImports();

    expect(await catalogRows(body.snapshotId)).toEqual(
      await catalogRows(legacy.snapshotId),
    );
    const [row007] = await catalogRows(body.snapshotId);
    expect(row007.originalValues['Descripción']).toBe(
      '=Mesa de roble, para seis.',
    );

    await send('post', `/api/v1/projects/${projectId}/rulesets`)
      .send(rulesetBody())
      .expect(201);
    const fromSheet = await feedTsvOf(body.snapshotId);
    const fromCsv = await feedTsvOf(legacy.snapshotId);

    expect(fromSheet.evaluation.counts).toEqual(fromCsv.evaluation.counts);
    expect(fromSheet.evaluation.counts).toMatchObject({
      valid: 1,
      invalid: 1,
      excluded: 1,
    });
    expect(fromSheet.evaluation.resultChecksum).toBe(
      fromCsv.evaluation.resultChecksum,
    );
    expect(fromSheet.tsv.equals(fromCsv.tsv)).toBe(true);
    expect(fromSheet.tsv.toString('utf8')).toContain('Acme Mesa 007');

    const { rows: events } = await pool().query(
      `SELECT action, resource_type AS "resourceType", details
       FROM estadistica_forms.audit_events
       WHERE resource_id = $1`,
      [body.snapshotId],
    );
    expect(events).toEqual([
      {
        action: 'worksheet.catalog_snapshot.created',
        resourceType: 'catalog_snapshot',
        details: {
          worksheetId,
          revisionId,
          sourceHash: body.catalogSnapshot.sourceHash,
        },
      },
    ]);
  });

  it('una revisión fija da el mismo CSV aunque la hoja avance; la procedencia se lee por GET (D28)', async () => {
    const firstRevision = await headRevisionId();
    const { body: first } = await sendToCatalog(catalogRequest()).expect(202);
    await finishImports();
    await importAndPublish([
      [
        '010',
        'Cama 010',
        'Cama.',
        'https://t/010',
        'https://t/010.jpg',
        '1.00',
        'in_stock',
        'Acme',
        '',
      ],
    ]);

    const { body: again } = await sendToCatalog(
      catalogRequest({ revisionId: firstRevision }),
    ).expect(202);
    await finishImports();
    const { body: current } = await sendToCatalog(catalogRequest()).expect(202);

    expect(again.catalogSnapshot.sourceHash).toBe(
      first.catalogSnapshot.sourceHash,
    );
    expect(again.snapshotId).not.toBe(first.snapshotId);
    expect(current.catalogSnapshot).toMatchObject({
      revisionSequence: 3,
      rowCount: 4,
    });
    expect(current.catalogSnapshot.sourceHash).not.toBe(
      first.catalogSnapshot.sourceHash,
    );
    // El SHA-256 es el del CSV que el worker lee y comprueba.
    const [artifact] = await pool()
      .query(
        `SELECT source_hash AS "sourceHash"
       FROM estadistica_forms.catalog_snapshots WHERE id = $1`,
        [again.snapshotId],
      )
      .then(({ rows }) => rows);
    expect(artifact.sourceHash).toBe(again.catalogSnapshot.sourceHash);

    await send('get', `${base}/worksheet-catalog-snapshots/${again.snapshotId}`)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toEqual({ catalogSnapshot: again.catalogSnapshot }),
      );
    await send(
      'get',
      `${base}/worksheet-catalog-snapshots/${again.snapshotId}`,
      'bob-session',
    )
      .expect(404)
      .expect(({ body }) =>
        expect(body).toMatchObject(
          publicError('WORKSHEET_CATALOG_SNAPSHOT_NOT_FOUND'),
        ),
      );
  });

  it('columnas, filtro y orden elegidos: solo esas cabeceras y filas, en ese orden', async () => {
    const { body } = await sendToCatalog({
      idColumnId: columns.SKU,
      columns: [columns.Nombre, columns.SKU],
      filter: { column: columns.Precio, op: 'lt', value: '100' },
      sort: [{ columnId: columns.SKU, direction: 'desc' }],
    }).expect(202);
    await finishImports();

    expect(await readSnapshot(body.snapshotId)).toMatchObject({
      status: 'ready',
      headers: ['Nombre', 'SKU'],
      rowCount: 2,
    });
    expect(
      (await catalogRows(body.snapshotId)).map(({ externalId }) => externalId),
    ).toEqual(['009', '008']);
    expect(body.catalogSnapshot.query).toEqual({
      filter: { column: columns.Precio, op: 'lt', value: '100' },
      sort: [{ columnId: columns.SKU, direction: 'desc' }],
    });
  });

  it('422 con cada fila que el catálogo rechazaría; no queda archivo ni snapshot (D25)', async () => {
    const { body } = await sendToCatalog(
      catalogRequest({ idColumnId: columns.Marca }),
    ).expect(422);

    expect(body).toMatchObject(publicError('WORKSHEET_CATALOG_ROWS_INVALID'));
    expect(
      body.issues.map(({ field, code }: { field: string; code: string }) => ({
        field: field.replace(/^rows\.[0-9a-f-]{36}\./, 'rows.<fila>.'),
        code,
      })),
    ).toEqual([
      { field: `rows.<fila>.${columns.Marca}`, code: 'CATALOG_ID_MISSING' },
      { field: `rows.<fila>.${columns.Marca}`, code: 'CATALOG_ID_DUPLICATE' },
    ]);
    expect(await files('tmp')).toEqual([]);
    expect(await files('artifacts')).toEqual([]);
    expect(await count('catalog_snapshots')).toBe(0);
  });

  it('422 si ninguna fila cumple el filtro y 400 si la columna identificadora no está entre las elegidas', async () => {
    await sendToCatalog(
      catalogRequest({
        filter: { column: columns.SKU, op: 'equals', value: 'no-existe' },
      }),
    )
      .expect(422)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('WORKSHEET_CATALOG_EMPTY')),
      );
    for (const idColumnId of [columns.Interna, randomUUID()]) {
      await sendToCatalog(catalogRequest({ idColumnId }))
        .expect(400)
        .expect(({ body }) =>
          expect(body.issues).toEqual([
            {
              field: 'idColumnId',
              ...publicError('CATALOG_ID_COLUMN_INVALID'),
            },
          ]),
        );
    }
    await sendToCatalog({ columns: [columns.SKU] }).expect(400);
    expect(await files('tmp')).toEqual([]);
    expect(await count('catalog_snapshots')).toBe(0);
  });

  it('acceso: ajeno 404; lector 403; un Editor que no creó el proyecto sí puede (C6); archivada 409 (D23)', async () => {
    await sendToCatalog(catalogRequest(), 'bob-session')
      .expect(404)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('WORKSHEET_NOT_FOUND')),
      );
    await setBobRole('viewer');
    await sendToCatalog(catalogRequest(), 'bob-session')
      .expect(403)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('FORBIDDEN')),
      );
    // Desde C6 el catálogo es de la organización: basta con poder preparar trabajo.
    await setBobRole('editor');
    const { body: bobs } = await sendToCatalog(
      catalogRequest(),
      'bob-session',
    ).expect(202);
    expect(bobs.catalogSnapshot.createdBy).toBe(bobId);
    await finishImports();

    // Una organización personal no se archiva: se convierte antes en de equipo.
    await pool().query(
      `UPDATE estadistica_forms.organizations
       SET personal_owner_id = NULL, archived_at = '2026-11-07T12:00:00.000Z'
       WHERE id = $1`,
      [organizationId],
    );
    await sendToCatalog(catalogRequest())
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('ORGANIZATION_ARCHIVED')),
      );
    // Solo el de Bob, de antes de archivar.
    expect(await count('catalog_snapshots')).toBe(1);
  });

  it('si la organización se archiva mientras se escribe el CSV, la transacción de accept lo rechaza (D23)', async () => {
    const imports = app.get(CatalogImportService);
    const accept = imports.accept.bind(imports);
    jest.spyOn(imports, 'accept').mockImplementationOnce(async (...args) => {
      await pool().query(
        `UPDATE estadistica_forms.organizations
           SET personal_owner_id = NULL, archived_at = '2026-11-07T12:00:00.000Z'
           WHERE id = $1`,
        [organizationId],
      );
      return accept(...args);
    });

    await sendToCatalog(catalogRequest())
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('ORGANIZATION_ARCHIVED')),
      );
    expect(await count('catalog_snapshots')).toBe(0);
    expect(await files('artifacts')).toEqual([]);
    expect(await files('tmp')).toEqual([]);
  });

  it('con una importación activa responde 409 y retira su CSV temporal', async () => {
    await uploadLegacyCsv('SKU,Nombre\r\n1,Uno\r\n').expect(202);

    await sendToCatalog(catalogRequest())
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('IMPORT_ALREADY_ACTIVE')),
      );
    expect(await files('tmp')).toEqual([]);
    expect(await files('artifacts')).toHaveLength(1);
    expect(await count('worksheet_catalog_snapshots')).toBe(0);
  });

  it('si el CSV no se puede enlazar en artifacts, responde 503 y retira el temporal', async () => {
    jest
      .spyOn(app.get(ArtifactStore), 'finalize')
      .mockRejectedValueOnce(new Error('disco lleno'));

    await sendToCatalog(catalogRequest())
      .expect(503)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('IMPORT_STORAGE_UNAVAILABLE')),
      );
    expect(await files('tmp')).toEqual([]);
    expect(await files('artifacts')).toEqual([]);
    expect(await count('catalog_snapshots')).toBe(0);
  });

  it('si la procedencia no se guarda, tampoco el snapshot ni su archivo: misma transacción (D22)', async () => {
    jest
      .spyOn(app.get(WorksheetCatalogSnapshotsRepository), 'insert')
      .mockRejectedValueOnce(new Error('fallo de la base'));

    await sendToCatalog(catalogRequest()).expect(503);

    expect(await count('catalog_snapshots')).toBe(0);
    expect(await count('catalog_import_jobs')).toBe(0);
    expect(await files('artifacts')).toEqual([]);
    expect(await files('tmp')).toEqual([]);
  });

  it('borrar la importación por la ruta existente borra su procedencia; la revisión sigue (D27)', async () => {
    const { body } = await sendToCatalog(catalogRequest()).expect(202);
    await finishImports();
    await setBobRole('viewer');
    const provenance = `${base}/worksheet-catalog-snapshots/${body.snapshotId}`;
    await send('get', provenance, 'bob-session').expect(200);

    await send(
      'delete',
      `/api/v1/projects/${projectId}/imports/${body.snapshotId}`,
    ).expect(204);

    await send('get', provenance)
      .expect(404)
      .expect(({ body: error }) =>
        expect(error).toMatchObject(
          publicError('WORKSHEET_CATALOG_SNAPSHOT_NOT_FOUND'),
        ),
      );
    expect(await headRevisionId()).toBe(body.catalogSnapshot.revisionId);
  });

  it('el CSV que lee el worker es el que se describe: su SHA-256 coincide con el del archivo guardado', async () => {
    const { body } = await sendToCatalog(catalogRequest()).expect(202);
    const [key] = await files('artifacts');
    const stored = await app.get(ArtifactStore).openRead(key).toArray();
    const hash = createHash('sha256')
      .update(Buffer.concat(stored as Buffer[]))
      .digest('hex');

    expect(hash).toBe(body.catalogSnapshot.sourceHash);
  });
});
