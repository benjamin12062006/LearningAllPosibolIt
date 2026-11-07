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
import { mkdtemp, readdir, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { ArtifactStore } from '../../../src/artifacts/artifact.store.js';
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
import { WorksheetExportCleanupService } from '../../../src/worksheet-exports/worksheet-export-cleanup.service.js';
import { WorksheetExportsModule } from '../../../src/worksheet-exports/worksheet-exports.module.js';
import { WorksheetExportsRepository } from '../../../src/worksheet-exports/worksheet-exports.repository.js';
import { WORKSHEET_EXPORT_OPTIONS } from '../../../src/worksheet-exports/worksheet-exports.types.js';
import { WorksheetImportsModule } from '../../../src/worksheet-imports/worksheet-imports.module.js';
import { readWorksheetXlsx } from '../../../src/worksheet-imports/worksheet-xlsx.js';
import { WorksheetsModule } from '../../../src/worksheets/worksheets.module.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';

const SESSIONS: Record<string, AuthenticatedIdentity> = {
  'alice-session': alice,
  'bob-session': bob,
};
type Session = keyof typeof SESSIONS;

/**
 * Datos de partida importados por CSV (E5.1): una fórmula en un texto, un
 * decimal de 20 cifras, una fecha anterior a 1900, saltos de línea, un `_x`
 * literal y vacíos.
 */
const PRODUCTS_CSV =
  'sku,precio,fecha,activo,estado,nota\r\n' +
  '007,10.50,2026-03-15,sí,Nuevo,"=HYPERLINK(""x"")"\r\n' +
  '008,12345678901234567.89,1899-12-31,no,Usado,"línea\nnueva"\r\n' +
  '009,,2026-11-07,sí,,"_x0041_ y, coma"\r\n';

const HEADER = 'SKU,Precio,Fecha,Activo,Estado,Doble,Nota\r\n';

describe('Exportar una revisión de hoja a CSV o XLSX por HTTP (E5.3, T16)', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let root: string;
  let base: string;
  let worksheetId: string;
  let columns: Record<string, string>;
  const validateSession = jest.fn<DescopeService['validateSession']>();

  beforeAll(async () => {
    database = await createTestDatabase();
    root = await mkdtemp(join(tmpdir(), 'worksheet-exports-http-'));
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
    await database.connection.pool.query(
      'TRUNCATE estadistica_forms.app_users CASCADE',
    );
    for (const file of await readdir(join(root, 'worksheet-exports'))) {
      await unlink(join(root, 'worksheet-exports', file));
    }
    const users = app.get(UsersService);
    const aliceId = (await users.provision(alice)).id;
    const bobId = (await users.provision(bob)).id;
    // Bob tiene su propia organización: es el propietario ajeno.
    await app.get(ProjectsRepository).create(bobId, 'Ajena', projectInput);

    const project = await app
      .get(ProjectsRepository)
      .create(aliceId, 'Tienda', projectInput);
    const [organization] = await app
      .get(OrganizationsRepository)
      .findMemberships(aliceId, { limit: 1, offset: 0 });
    base = `/api/v1/organizations/${organization.id}/projects/${project.id}`;

    const { body: created } = await send('post', `${base}/workbooks`)
      .send({ name: 'Libro' })
      .expect(201);
    const { body } = await send(
      'post',
      `${base}/workbooks/${created.workbook.id}/worksheets`,
    )
      .send({
        name: 'Productos: 2026/11',
        columns: [
          { name: 'SKU', type: 'text', required: true },
          { name: 'Precio', type: 'decimal' },
          { name: 'Fecha', type: 'date' },
          { name: 'Activo', type: 'boolean' },
          {
            name: 'Estado',
            type: 'selection',
            options: [{ label: 'Nuevo' }, { label: 'Usado' }],
          },
          {
            name: 'Doble',
            type: 'calculated',
            formula: {
              expression: {
                op: 'mul',
                args: [{ column: 'Precio' }, { value: '2' }],
              },
              scale: 2,
              rounding: 'half_up',
            },
          },
          { name: 'Nota', type: 'text' },
        ],
      })
      .expect(201);
    worksheetId = body.worksheet.id;
    columns = Object.fromEntries(
      body.worksheet.columns.map(
        ({ id, name }: { id: string; name: string }) => [name, id],
      ),
    );
    await importAndPublish(PRODUCTS_CSV, csvMapping());
  });
  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await database?.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  function send(
    method: 'get' | 'post',
    path: string,
    session: Session = 'alice-session',
  ) {
    return request(app.getHttpServer())
      [method](path)
      .auth(session, { type: 'bearer' });
  }

  function exportSheet(body: object, session: Session = 'alice-session') {
    return send(
      'post',
      `${base}/worksheets/${worksheetId}/exports`,
      session,
    ).send(body);
  }

  function download(url: string, session: Session = 'alice-session') {
    return send('get', url, session).responseType('blob');
  }

  function csvMapping() {
    return {
      mode: 'append',
      booleanLabels: { true: ['sí'], false: ['no'] },
      columns: [
        { header: 'sku', columnId: columns.SKU },
        { header: 'precio', columnId: columns.Precio },
        { header: 'fecha', columnId: columns.Fecha },
        { header: 'activo', columnId: columns.Activo },
        { header: 'estado', columnId: columns.Estado },
        { header: 'nota', columnId: columns.Nota },
      ],
    };
  }

  /** Importar, enviar, aprobar (empresa de una persona) y aplicar. */
  async function importAndPublish(content: string, options: object) {
    const { body } = await send(
      'post',
      `${base}/worksheets/${worksheetId}/imports`,
    )
      .attach('file', Buffer.from(content, 'utf8'), 'productos.csv')
      .field('options', JSON.stringify(options))
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
    const { body: applied } = await send(
      'post',
      `${base}/changesets/${pending.id}/apply`,
    )
      .set('Idempotency-Key', `importar-${pending.id}`)
      .send({
        contentHash: pending.contentHash,
        expectedHeadRevisionId: pending.baseRevisionId,
      })
      .expect(200);
    return applied;
  }

  async function headRevisionId() {
    const { body } = await send(
      'get',
      `${base}/worksheets/${worksheetId}`,
    ).expect(200);
    return body.worksheet.headRevision.id as string;
  }

  async function countExports() {
    const { rows } = await database.connection.pool.query(
      'SELECT count(*)::int AS n FROM estadistica_forms.worksheet_exports',
    );
    return rows[0].n as number;
  }

  it('CSV de la revisión actual: BOM, CRLF, comillas y fórmulas protegidas; el checksum es el del archivo (D18, F8)', async () => {
    const { body } = await exportSheet({ format: 'csv' }).expect(201);
    expect(body.export).toMatchObject({
      worksheetId,
      revisionId: await headRevisionId(),
      format: 'csv',
      options: { delimiter: 'comma', formulas: 'escape' },
      query: {
        columnIds: Object.values(columns),
        filter: null,
        sort: [],
      },
      serializerVersion: 'worksheet-export/1',
      rowCount: 3,
      columnCount: 7,
      problemCellCount: 0,
    });
    expect(body.downloadUrl).toBe(
      `${base}/worksheet-exports/${body.export.id}/file`,
    );

    const { body: file, headers } = await download(body.downloadUrl)
      .expect(200)
      .expect('Content-Type', 'text/csv; charset=utf-8; header=present')
      .expect(
        'Content-Disposition',
        `attachment; filename="hoja-${body.export.id}.csv"`,
      );
    expect(Number(headers['content-length'])).toBe(body.export.byteSize);
    expect(sha256(file)).toBe(body.export.checksum);
    expect(file.toString('utf8')).toBe(
      '\uFEFF' +
        HEADER +
        `007,10.50,2026-03-15,true,Nuevo,21.00,"'=HYPERLINK(""x"")"\r\n` +
        '008,12345678901234567.89,1899-12-31,false,Usado,24691357802469135.78,"línea\nnueva"\r\n' +
        '009,,2026-11-07,true,,,"_x0041_ y, coma"\r\n',
    );

    const { rows } = await database.connection.pool.query(
      `SELECT action, resource_id AS "resourceId" FROM estadistica_forms.audit_events
       WHERE action = 'worksheet.export.created'`,
    );
    expect(rows).toEqual([
      { action: 'worksheet.export.created', resourceId: body.export.id },
    ]);
  });

  it('XLSX: cada celda con su tipo y, al importarlo de nuevo, no cambia nada (archivo → revisión → archivo)', async () => {
    const { body } = await exportSheet({ format: 'xlsx' }).expect(201);
    const { body: file } = await download(body.downloadUrl)
      .expect(200)
      .expect(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
    expect(sha256(file)).toBe(body.export.checksum);
    expect(body.export.options).toEqual({});

    const read = await readWorksheetXlsx(file, { sheet: null, headerRow: 1 });
    expect(read.sheets).toEqual(['Productos_ 2026_11']);
    expect(read.table?.rows).toEqual([
      [
        '007',
        { kind: 'number', text: '10.50' },
        { kind: 'date', text: '2026-03-15' },
        { kind: 'boolean', text: 'true' },
        'Nuevo',
        { kind: 'number', text: '21.00' },
        '=HYPERLINK("x")',
      ],
      [
        '008',
        '12345678901234567.89',
        '1899-12-31',
        { kind: 'boolean', text: 'false' },
        'Usado',
        '24691357802469135.78',
        'línea\nnueva',
      ],
      [
        '009',
        '',
        { kind: 'date', text: '2026-11-07' },
        { kind: 'boolean', text: 'true' },
        '',
        '',
        '_x0041_ y, coma',
      ],
    ]);

    // Mismo archivo, de vuelta por `upsert`: ninguna celda cambia.
    await send('post', `${base}/worksheets/${worksheetId}/imports`)
      .attach('file', file, 'productos.xlsx')
      .field(
        'options',
        JSON.stringify({
          mode: 'upsert',
          matchColumnId: columns.SKU,
          columns: ['SKU', 'Precio', 'Fecha', 'Activo', 'Estado', 'Nota'].map(
            (name) => ({ header: name, columnId: columns[name] }),
          ),
        }),
      )
      .expect(409)
      .expect(({ body: error }) =>
        expect(error).toMatchObject(publicError('IMPORT_NOTHING_TO_CHANGE')),
      );
  });

  it('una revisión fija da los mismos bytes aunque la hoja avance; sin revisión, la actual (D21)', async () => {
    const first = await headRevisionId();
    const { body: before } = await exportSheet({ format: 'xlsx' }).expect(201);

    await importAndPublish('sku\r\n010\r\n', {
      mode: 'append',
      columns: [{ header: 'sku', columnId: columns.SKU }],
    });

    const { body: again } = await exportSheet({
      format: 'xlsx',
      revisionId: first,
    }).expect(201);
    expect(again.export).toMatchObject({
      revisionId: first,
      rowCount: 3,
      checksum: before.export.checksum,
    });
    expect(again.export.id).not.toBe(before.export.id);

    const { body: current } = await exportSheet({ format: 'xlsx' }).expect(201);
    expect(current.export.revisionId).toBe(await headRevisionId());
    expect(current.export.revisionId).not.toBe(first);
    expect(current.export.rowCount).toBe(4);
    expect(current.export.checksum).not.toBe(before.export.checksum);
  });

  it('columnas, filtro y orden elegidos, con punto y coma y sin proteger fórmulas; quedan como procedencia (D16)', async () => {
    const query = {
      columns: [columns.Nota, columns.SKU],
      filter: { column: columns.Activo, op: 'equals', value: true },
      sort: [{ columnId: columns.SKU, direction: 'desc' }],
    };
    const { body } = await exportSheet({
      format: 'csv',
      delimiter: 'semicolon',
      formulas: 'keep',
      ...query,
    }).expect(201);
    const { body: file } = await download(body.downloadUrl).expect(200);

    expect(file.toString('utf8')).toBe(
      '\uFEFFNota;SKU\r\n_x0041_ y, coma;009\r\n"=HYPERLINK(""x"")";007\r\n',
    );
    const { body: found } = await send(
      'get',
      `${base}/worksheet-exports/${body.export.id}`,
    ).expect(200);
    expect(found.export).toMatchObject({
      options: { delimiter: 'semicolon', formulas: 'keep' },
      query: {
        columnIds: query.columns,
        filter: query.filter,
        sort: query.sort,
      },
      rowCount: 2,
      columnCount: 2,
    });
  });

  it('opciones o consultas inválidas: 400 y no queda ni fila ni archivo', async () => {
    await exportSheet({ format: 'xlsx', delimiter: 'comma' })
      .expect(400)
      .expect(({ body }) =>
        expect(body.issues).toEqual([
          { field: 'delimiter', ...publicError('FIELD_NOT_ALLOWED') },
        ]),
      );
    await exportSheet({
      format: 'csv',
      sort: [{ columnId: columns.Doble, direction: 'asc' }],
    })
      .expect(400)
      .expect(({ body }) =>
        expect(body.issues).toEqual([
          { field: 'sort.0.columnId', ...publicError('ROW_SORT_UNSUPPORTED') },
        ]),
      );
    await exportSheet({ format: 'csv', columns: [randomUUID()] }).expect(400);
    await exportSheet({ format: 'pdf' }).expect(400);
    await exportSheet({ format: 'csv', formulas: 'maybe' }).expect(400);

    expect(await countExports()).toBe(0);
    expect(await readdir(join(root, 'worksheet-exports'))).toEqual([]);
    expect(await readdir(join(root, 'tmp'))).toEqual([]);
  });

  it('lo ajeno responde 404: hoja, revisión, exportación y archivo', async () => {
    const { body } = await exportSheet({ format: 'csv' }).expect(201);

    await exportSheet({ format: 'csv' }, 'bob-session')
      .expect(404)
      .expect(({ body: error }) =>
        expect(error).toMatchObject(publicError('WORKSHEET_NOT_FOUND')),
      );
    await send(
      'get',
      `${base}/worksheet-exports/${body.export.id}`,
      'bob-session',
    )
      .expect(404)
      .expect(({ body: error }) =>
        expect(error).toMatchObject(publicError('WORKSHEET_EXPORT_NOT_FOUND')),
      );
    await download(body.downloadUrl, 'bob-session').expect(404);
    await exportSheet({ format: 'csv', revisionId: randomUUID() })
      .expect(404)
      .expect(({ body: error }) =>
        expect(error).toMatchObject(
          publicError('WORKSHEET_REVISION_NOT_FOUND'),
        ),
      );
    await send('get', `${base}/worksheet-exports/${randomUUID()}`).expect(404);
    expect(await countExports()).toBe(1);
  });

  it('si la fila no se guarda, el archivo ya escrito se borra (D20)', async () => {
    jest
      .spyOn(app.get(WorksheetExportsRepository), 'insert')
      .mockRejectedValueOnce(new Error('fallo de la base'));

    await exportSheet({ format: 'csv' }).expect(500);
    expect(await countExports()).toBe(0);
    expect(await readdir(join(root, 'worksheet-exports'))).toEqual([]);
    expect(await readdir(join(root, 'tmp'))).toEqual([]);
  });

  it('si falta el archivo, 503; los archivos sin exportación se retiran al arrancar (D20)', async () => {
    const { body } = await exportSheet({ format: 'csv' }).expect(201);
    const { body: kept } = await exportSheet({ format: 'xlsx' }).expect(201);
    const [missing] = (await readdir(join(root, 'worksheet-exports'))).filter(
      (name) => name.endsWith('.csv'),
    );
    await unlink(join(root, 'worksheet-exports', missing));

    await download(body.downloadUrl)
      .expect(503)
      .expect(({ body: error }) =>
        expect(JSON.parse(String(error))).toMatchObject(
          publicError('EXPORT_FILE_UNAVAILABLE'),
        ),
      );

    const { file: orphan } = await app
      .get(ArtifactStore)
      .writeWorksheetExport('csv', async (sink) => {
        await sink.write(Buffer.from('huérfano'));
      });
    const removed = await app
      .get(WorksheetExportCleanupService)
      .removeOrphanExports(Date.now() + 2 * 60 * 60 * 1000);
    expect(removed).toBe(1);
    const left = await readdir(join(root, 'worksheet-exports'));
    expect(left).not.toContain(orphan.key);
    expect(left).toHaveLength(1);
    await download(kept.downloadUrl).expect(200);
  });
});

function sha256(content: Buffer) {
  return createHash('sha256').update(content).digest('hex');
}
