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
import { createHash } from 'node:crypto';
import request from 'supertest';
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
import { WorksheetImportsModule } from '../../../src/worksheet-imports/worksheet-imports.module.js';
import { WorksheetsModule } from '../../../src/worksheets/worksheets.module.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';
import { row, xlsxBook, type BookFixture } from './support/xlsx-fixture.js';

const SESSIONS: Record<string, AuthenticatedIdentity> = {
  'alice-session': alice,
  'bob-session': bob,
};
type Session = keyof typeof SESSIONS;

/** T13: BOM, comillas, comas y saltos dentro de un campo, CRLF y ceros iniciales. */
const PRODUCTS_CSV =
  '\uFEFFsku,nombre,precio,activo\r\n' +
  '007,"Tornillo, 5 mm",10.50,sí\r\n' +
  '008,"Tuerca ""M5""",0.10,no\r\n' +
  '009,"Arandela\nplana",,sí\r\n';

/**
 * T13 en XLSX: dos hojas; en «Productos», ceros como texto, decimal escrito
 * por Excel, exponente, booleanos, fechas con estilo estándar y propio, una
 * fórmula con valor y otra con error, y una fila con celdas que faltan.
 */
function productsBook() {
  const strings = [
    'sku',
    'precio',
    'activo',
    'alta',
    'total',
    '007',
    '008',
    '009',
    'no importar',
  ];
  const header = ['A', 'B', 'C', 'D', 'E']
    .map((column, index) => `<c r="${column}1" t="s"><v>${index}</v></c>`)
    .join('');
  return xlsxBook({
    sheets: [
      { name: 'Notas', rows: row(1, '<c r="A1" t="s"><v>8</v></c>') },
      {
        name: 'Productos',
        rows:
          row(1, header) +
          row(
            2,
            '<c r="A2" t="s"><v>5</v></c><c r="B2"><v>10.5</v></c><c r="C2" t="b"><v>1</v></c>' +
              '<c r="D2" s="1"><v>46096</v></c><c r="E2"><f>0.1+0.2</f><v>0.30000000000000004</v></c>',
          ) +
          row(
            3,
            '<c r="A3" t="s"><v>6</v></c><c r="B3"><v>1.5E-3</v></c><c r="C3" t="b"><v>0</v></c>' +
              '<c r="D3" s="2"><v>46097</v></c><c r="E3" t="e"><f>1/0</f><v>#DIV/0!</v></c>',
          ) +
          row(
            4,
            '<c r="A4" t="inlineStr"><is><t>009</t></is></c><c r="E4"><f>3+4</f><v>7</v></c>',
          ),
      },
    ],
    strings,
  });
}

describe('Importar un CSV o un XLSX a una hoja por HTTP (E5.1, E5.2)', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let base: string;
  let worksheetId: string;
  let sku: string;
  let price: string;
  let active: string;
  let organizationId: string;
  const validateSession = jest.fn<DescopeService['validateSession']>();

  beforeAll(async () => {
    database = await createTestDatabase();
    const module = await Test.createTestingModule({
      imports: [
        ProjectsModule,
        WorksheetsModule,
        ChangesetsModule,
        WorksheetImportsModule,
      ],
    })
      .overrideProvider(POSTGRESQL_CONNECTION)
      .useValue(database.connection)
      .overrideProvider(DescopeService)
      .useValue({ validateSession })
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
    organizationId = organization.id;
    base = `/api/v1/organizations/${organizationId}/projects/${project.id}`;

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
          { name: 'Precio', type: 'decimal' },
          { name: 'Activo', type: 'boolean' },
        ],
      })
      .expect(201);
    worksheetId = body.worksheet.id;
    [sku, price, active] = body.worksheet.columns.map(
      ({ id }: { id: string }) => id,
    );
  });
  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await database?.close();
    }
  });

  function send(
    method: 'get' | 'post' | 'put',
    path: string,
    session: Session = 'alice-session',
  ) {
    return request(app.getHttpServer())
      [method](path)
      .auth(session, { type: 'bearer' });
  }

  function upload(
    content: string,
    options: object | string,
    session: Session = 'alice-session',
  ) {
    return send('post', `${base}/worksheets/${worksheetId}/imports`, session)
      .attach('file', Buffer.from(content, 'utf8'), 'productos.csv')
      .field(
        'options',
        typeof options === 'string' ? options : JSON.stringify(options),
      );
  }

  function uploadXlsx(
    content: Buffer,
    options: object,
    session: Session = 'alice-session',
  ) {
    return send('post', `${base}/worksheets/${worksheetId}/imports`, session)
      .attach('file', content, 'productos.xlsx')
      .field('options', JSON.stringify(options));
  }

  function previewXlsx(content: Buffer, fields: Record<string, string> = {}) {
    let call = send(
      'post',
      `${base}/worksheets/${worksheetId}/imports/preview`,
    ).attach('file', content, 'productos.xlsx');
    for (const [name, value] of Object.entries(fields)) {
      call = call.field(name, value);
    }
    return call;
  }

  async function countChangesets() {
    const { rows: stored } = await database.connection.pool.query(
      'SELECT count(*)::int AS n FROM estadistica_forms.worksheet_changesets',
    );
    return stored[0].n as number;
  }

  function mapping(extra: object = {}) {
    return {
      mode: 'append',
      booleanLabels: { true: ['sí'], false: ['no'] },
      columns: [
        { header: 'sku', columnId: sku },
        { header: 'precio', columnId: price },
        { header: 'activo', columnId: active },
      ],
      ...extra,
    };
  }

  async function rows() {
    const { body } = await send(
      'post',
      `${base}/worksheets/${worksheetId}/rows/query`,
    )
      .send({})
      .expect(200);
    return body.items as { rowId: string; values: Record<string, unknown> }[];
  }

  /** Enviar, aprobar (empresa de una persona) y aplicar el borrador. */
  async function publish(changeset: { id: string; draftVersion: number }) {
    const { body: sent } = await send(
      'post',
      `${base}/changesets/${changeset.id}/submit`,
    )
      .send({ draftVersion: changeset.draftVersion })
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

  it('vista previa: cabeceras, muestra y mapeo sugerido, sin guardar nada', async () => {
    const { body } = await send(
      'post',
      `${base}/worksheets/${worksheetId}/imports/preview`,
    )
      .attach('file', Buffer.from(PRODUCTS_CSV, 'utf8'), 'productos.csv')
      .expect(200);
    expect(body.preview).toMatchObject({
      rows: 3,
      headers: ['sku', 'nombre', 'precio', 'activo'],
      sample: [
        ['007', 'Tornillo, 5 mm', '10.50', 'sí'],
        ['008', 'Tuerca "M5"', '0.10', 'no'],
        ['009', 'Arandela\nplana', '', 'sí'],
      ],
      suggestedColumns: [
        { header: 'sku', columnId: sku },
        { header: 'precio', columnId: price },
        { header: 'activo', columnId: active },
      ],
    });
    const { rows: stored } = await database.connection.pool.query(
      'SELECT count(*)::int AS n FROM estadistica_forms.worksheet_changesets',
    );
    expect(stored[0].n).toBe(0);
  });

  it('archivo → borrador → revisión: conserva ceros, decimales exactos y vacíos; la hoja no cambia hasta aplicar (T04, T13)', async () => {
    const { body } = await upload(PRODUCTS_CSV, mapping())
      .expect(201)
      .expect('ETag', '"1"');
    expect(body.import).toMatchObject({
      worksheetId,
      changesetId: body.changeset.id,
      format: 'csv',
      fileBytes: Buffer.byteLength(PRODUCTS_CSV),
      report: { rows: 3, inserted: 3, invalid: 0, ignoredHeaders: ['nombre'] },
      excludedRows: [],
      includedHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(body.changeset).toMatchObject({ source: 'import', status: 'draft' });
    expect(await rows()).toEqual([]);

    await publish(body.changeset);
    expect((await rows()).map(({ values }) => values)).toEqual([
      { [sku]: '007', [price]: '10.50', [active]: true },
      { [sku]: '008', [price]: '0.10', [active]: false },
      { [sku]: '009', [price]: null, [active]: true },
    ]);

    await send('get', `${base}/worksheet-imports/${body.import.id}`)
      .expect(200)
      .expect(({ body: found }) => expect(found.import).toEqual(body.import));
  });

  it('T15: con filas inválidas no se crea nada; al excluirlas se guardan exactamente y el resto no cambia', async () => {
    const content = 'sku,precio,activo\nA,1,sí\n,2,sí\nC,abc,no\nD,4,quizá\n';
    await upload(content, mapping())
      .expect(422)
      .expect(({ body }) => {
        expect(body).toMatchObject(publicError('IMPORT_ROWS_INVALID'));
        expect(
          body.issues.map(
            ({ field, code }: { field: string; code: string }) => [field, code],
          ),
        ).toEqual([
          ['rows.2.sku', 'CELL_REQUIRED'],
          ['rows.3.precio', 'CELL_VALUE_INVALID'],
          ['rows.4.activo', 'CELL_VALUE_INVALID'],
        ]);
      });
    const { rows: none } = await database.connection.pool.query(
      'SELECT count(*)::int AS n FROM estadistica_forms.worksheet_imports',
    );
    expect(none[0].n).toBe(0);

    const first = await upload(
      content,
      mapping({ excludeRows: [2, 3, 4] }),
    ).expect(201);
    expect(first.body.import.excludedRows).toEqual([
      { sourceRow: 2, codes: ['CELL_REQUIRED'] },
      { sourceRow: 3, codes: ['CELL_VALUE_INVALID'] },
      { sourceRow: 4, codes: ['CELL_VALUE_INVALID'] },
    ]);
    expect(first.body.changeset.operations).toEqual([
      expect.objectContaining({
        type: 'insert_row',
        values: { [sku]: 'A', [price]: '1', [active]: true },
      }),
    ]);
    // La huella fija qué fila de origen entra y con qué `rowId`.
    const [inserted] = first.body.changeset.operations;
    const expectedHash = createHash('sha256')
      .update(
        JSON.stringify([
          'worksheet-import-v1',
          first.body.import.fileHash,
          [[1, inserted.rowId, 'insert']],
        ]),
      )
      .digest('hex');
    expect(first.body.import.includedHash).toBe(expectedHash);

    // Excluirlo todo no deja nada que cambiar: no se crea ningún borrador.
    await upload(content, mapping({ excludeRows: [1, 2, 3, 4] }))
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('IMPORT_NOTHING_TO_CHANGE')),
      );
    expect(await rows()).toEqual([]);
  });

  it('upsert: actualiza por SKU, añade lo nuevo, no borra lo ausente y crea columnas nuevas', async () => {
    const seed = await upload(
      'sku,precio,activo\n007,10.50,sí\n008,0.10,no\n',
      mapping(),
    ).expect(201);
    await publish(seed.body.changeset);

    const { body } = await upload(
      'sku,precio,color\n007,11.00,rojo\n010,1,azul\n',
      {
        mode: 'upsert',
        matchColumnId: sku,
        columns: [
          { header: 'sku', columnId: sku },
          { header: 'precio', columnId: price },
          { header: 'color', newColumn: { name: 'Color', type: 'text' } },
        ],
      },
    ).expect(201);
    expect(body.import.report).toMatchObject({
      updated: 1,
      inserted: 1,
      unchanged: 0,
      newColumns: 1,
    });
    await publish(body.changeset);

    const { body: sheet } = await send(
      'get',
      `${base}/worksheets/${worksheetId}`,
    ).expect(200);
    const color = sheet.worksheet.columns[3].id;
    expect(sheet.worksheet.columns[3].name).toBe('Color');
    expect((await rows()).map(({ values }) => values)).toEqual([
      { [sku]: '007', [price]: '11.00', [active]: true, [color]: 'rojo' },
      { [sku]: '008', [price]: '0.10', [active]: false, [color]: null },
      { [sku]: '010', [price]: '1', [active]: null, [color]: 'azul' },
    ]);
  });

  it('límite de 5.000 filas: importar o enviar más allá responde 409 sin crear nada; editar una hoja llena sí se puede', async () => {
    const onlySku = {
      mode: 'append',
      columns: [{ header: 'sku', columnId: sku }],
    };
    const skus = Array.from({ length: 5000 }, (_, index) => `S${index}`);
    const { body: first } = await upload(
      `sku\n${skus.join('\n')}\n`,
      onlySku,
    ).expect(201);
    await publish(first.changeset);
    const countChangesets = async () => {
      const { rows: stored } = await database.connection.pool.query(
        'SELECT count(*)::int AS n FROM estadistica_forms.worksheet_changesets',
      );
      return stored[0].n;
    };

    await upload('sku\nS5000\n', onlySku)
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('WORKSHEET_ROW_LIMIT_EXCEEDED')),
      );
    expect(await countChangesets()).toBe(1);

    // Actualizar por clave no añade filas: con la hoja llena se puede.
    const { body: update } = await upload('sku,precio\nS0,1.5\n', {
      mode: 'upsert',
      matchColumnId: sku,
      columns: [
        { header: 'sku', columnId: sku },
        { header: 'precio', columnId: price },
      ],
    }).expect(201);
    await publish(update.changeset);

    // Un borrador manual: la revisión dice cuántas filas quedarían y enviar lo rechaza.
    const { body: created } = await send(
      'post',
      `${base}/worksheets/${worksheetId}/changesets`,
    )
      .send({ title: 'Una más' })
      .expect(201);
    const { body: saved } = await send(
      'put',
      `${base}/changesets/${created.changeset.id}/operations`,
    )
      .set('If-Match', '"1"')
      .send({
        operations: [
          {
            type: 'insert_row',
            rowId: '00000000-0000-4000-8000-00000000f001',
            values: { [sku]: 'S5000' },
          },
        ],
      })
      .expect(200);
    await send('get', `${base}/changesets/${created.changeset.id}/diff`)
      .expect(200)
      .expect(({ body }) => expect(body.review.resultingRowCount).toBe(5001));
    await send('post', `${base}/changesets/${created.changeset.id}/submit`)
      .send({ draftVersion: saved.changeset.draftVersion })
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('WORKSHEET_ROW_LIMIT_EXCEEDED')),
      );
  }, 30_000);

  it('rechaza opciones, mapeos y archivos inválidos antes de crear nada', async () => {
    await upload(PRODUCTS_CSV, '{no es json')
      .expect(400)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('IMPORT_OPTIONS_INVALID')),
      );
    await upload(
      PRODUCTS_CSV,
      mapping({ columns: [{ header: 'falta', columnId: sku }] }),
    )
      .expect(400)
      .expect(({ body }) =>
        expect(body.issues).toEqual([
          expect.objectContaining({
            field: 'columns.0.header',
            code: 'IMPORT_MAPPING_INVALID',
          }),
        ]),
      );
    await upload('sku,sku\n1,2\n', mapping())
      .expect(400)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('CSV_HEADERS_INVALID')),
      );
    await send('post', `${base}/worksheets/${worksheetId}/imports`)
      .field('options', JSON.stringify(mapping()))
      .expect(400)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('IMPORT_FILE_REQUIRED')),
      );
    await upload('sku\n'.padEnd(10_485_761, 'x'), mapping())
      .expect(413)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('IMPORT_FILE_TOO_LARGE')),
      );
  });

  it('si falla el registro de la importación no queda ni borrador ni auditoría', async () => {
    const pool = database.connection.pool;
    await pool.query(`
      CREATE FUNCTION estadistica_forms.fail_import() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo a propósito'; END $$`);
    await pool.query(`
      CREATE TRIGGER fail_import BEFORE INSERT ON estadistica_forms.worksheet_imports
      FOR EACH ROW EXECUTE FUNCTION estadistica_forms.fail_import()`);
    try {
      await upload(PRODUCTS_CSV, mapping()).expect(500);
    } finally {
      await pool.query('DROP FUNCTION estadistica_forms.fail_import() CASCADE');
    }
    const { rows: counts } = await pool.query(`
      SELECT
        (SELECT count(*)::int FROM estadistica_forms.worksheet_changesets) AS changesets,
        (SELECT count(*)::int FROM estadistica_forms.audit_events
          WHERE resource_type IN ('worksheet_changeset', 'worksheet_import')) AS events`);
    expect(counts[0]).toEqual({ changesets: 0, events: 0 });
  });

  it('quien solo puede leer ve la vista previa, pero no puede importar', async () => {
    const { rows: users } = await database.connection.pool.query<{
      id: string;
    }>(`SELECT id FROM estadistica_forms.app_users WHERE email = $1`, [
      bob.email,
    ]);
    await database.connection.pool.query(
      `INSERT INTO estadistica_forms.organization_members
         (organization_id, user_id, role, created_at)
       VALUES ($1, $2, 'viewer', '2026-11-06T12:00:00.000Z')`,
      [organizationId, users[0].id],
    );
    await send(
      'post',
      `${base}/worksheets/${worksheetId}/imports/preview`,
      'bob-session',
    )
      .attach('file', Buffer.from(PRODUCTS_CSV, 'utf8'), 'productos.csv')
      .expect(200);
    await upload(PRODUCTS_CSV, mapping(), 'bob-session')
      .expect(403)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('FORBIDDEN')),
      );
  });

  it('XLSX: de un libro con varias hojas, la vista previa da la lista; con la hoja, cabeceras y muestra', async () => {
    const content = productsBook();
    await previewXlsx(content)
      .expect(200)
      .expect(({ body }) =>
        expect(body.preview).toMatchObject({
          format: 'xlsx',
          sheets: ['Notas', 'Productos'],
          sheet: null,
          rows: 0,
          headers: [],
        }),
      );
    await previewXlsx(content, { sheet: 'Productos' })
      .expect(200)
      .expect(({ body }) =>
        expect(body.preview).toMatchObject({
          format: 'xlsx',
          sheet: 'Productos',
          rows: 3,
          headers: ['sku', 'precio', 'activo', 'alta', 'total'],
          sample: [
            ['007', '10.5', 'true', '2026-03-15', '0.30000000000000004'],
            ['008', '0.0015', 'false', '2026-03-16', '#DIV/0!'],
            ['009', '', '', '', '7'],
          ],
          suggestedColumns: [
            { header: 'sku', columnId: sku },
            { header: 'precio', columnId: price },
            { header: 'activo', columnId: active },
          ],
        }),
      );
    expect(await countChangesets()).toBe(0);
  });

  it('XLSX → borrador → revisión (T13): ceros, decimales exactos, fechas y fórmulas con valor; un error de fórmula no entra solo', async () => {
    const content = productsBook();
    const options = {
      mode: 'append',
      sheet: 'Productos',
      // Etiquetas propias para texto: los booleanos de Excel no dependen de ellas.
      booleanLabels: { true: ['sí'], false: ['no'] },
      columns: [
        { header: 'sku', columnId: sku },
        { header: 'precio', columnId: price },
        { header: 'activo', columnId: active },
        { header: 'alta', newColumn: { name: 'Alta', type: 'date' } },
        { header: 'total', newColumn: { name: 'Total', type: 'decimal' } },
      ],
    };
    await uploadXlsx(content, options)
      .expect(422)
      .expect(({ body }) =>
        expect(body.issues).toEqual([
          expect.objectContaining({
            field: 'rows.2.total',
            code: 'XLSX_CELL_ERROR',
          }),
        ]),
      );
    expect(await countChangesets()).toBe(0);

    const { body } = await uploadXlsx(content, {
      ...options,
      excludeRows: [2],
    }).expect(201);
    expect(body.import).toMatchObject({
      format: 'xlsx',
      options: { format: 'xlsx', sheet: 'Productos', headerRow: 1 },
      excludedRows: [{ sourceRow: 2, codes: ['XLSX_CELL_ERROR'] }],
      report: { rows: 3, inserted: 2, excluded: 1 },
    });
    await publish(body.changeset);
    const values = (await rows()).map(({ values: cells }) => [
      cells[sku],
      cells[price],
      cells[active],
    ]);
    expect(values).toEqual([
      ['007', '10.5', true],
      ['009', null, null],
    ]);
  });

  it('XLSX: el sistema de fechas 1904 sale del libro', async () => {
    const content = xlsxBook({
      date1904: true,
      sheets: [
        {
          name: 'Datos',
          rows:
            row(1, '<c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c>') +
            row(
              2,
              '<c r="A2" t="s"><v>2</v></c><c r="B2" s="1"><v>44634</v></c>',
            ),
        },
      ],
      strings: ['sku', 'alta', '010'],
    });
    const { body } = await uploadXlsx(content, {
      mode: 'append',
      columns: [
        { header: 'sku', columnId: sku },
        { header: 'alta', newColumn: { name: 'Alta', type: 'date' } },
      ],
    }).expect(201);
    expect(body.changeset.operations).toContainEqual(
      expect.objectContaining({
        type: 'insert_row',
        values: expect.objectContaining({ [sku]: '010' }),
      }),
    );
    const inserted = body.changeset.operations.find(
      (operation: { type: string }) => operation.type === 'insert_row',
    );
    expect(Object.values(inserted.values)).toContain('2026-03-15');
  });

  it('XLSX peligroso o mal pedido (T14): se rechaza sin crear nada', async () => {
    const options = {
      mode: 'append',
      columns: [{ header: 'sku', columnId: sku }],
    };
    const oneSheet = (extra: Partial<BookFixture> = {}) =>
      xlsxBook({
        sheets: [
          {
            name: 'Datos',
            rows:
              row(1, '<c r="A1" t="s"><v>0</v></c>') +
              row(2, '<c r="A2" t="s"><v>1</v></c>'),
          },
        ],
        strings: ['sku', '007'],
        ...extra,
      });
    const cases: [string, Buffer, object, number, string][] = [
      [
        'cifrado',
        Buffer.from('d0cf11e0a1b11ae1' + '00'.repeat(512), 'hex'),
        options,
        400,
        'XLSX_ENCRYPTED',
      ],
      [
        'con macros',
        oneSheet({ extraParts: [{ name: 'xl/vbaProject.bin', data: 'VBA' }] }),
        options,
        400,
        'XLSX_ACTIVE_CONTENT',
      ],
      [
        'bomba',
        oneSheet({
          replaceParts: {
            'xl/worksheets/sheet1.xml': `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${' '.repeat(60 * 1024 * 1024)}</sheetData></worksheet>`,
          },
        }),
        options,
        413,
        'XLSX_LIMITS_EXCEEDED',
      ],
      [
        'sin elegir hoja en un libro de varias',
        productsBook(),
        options,
        400,
        'XLSX_SHEET_REQUIRED',
      ],
      [
        'con una opción de CSV',
        oneSheet(),
        { ...options, delimiter: 'comma' },
        400,
        'IMPORT_OPTIONS_INVALID',
      ],
    ];
    for (const [label, content, body, status, code] of cases) {
      await uploadXlsx(content, body)
        .expect(status)
        .expect(({ body: error }) =>
          expect({ label, code: error.code }).toEqual({ label, code }),
        );
    }
    await previewXlsx(oneSheet(), { delimiter: 'comma' }).expect(400);
    await previewXlsx(oneSheet(), { headerRow: 'cero' }).expect(400);
    // Un propietario ajeno no llega a leer el archivo.
    await uploadXlsx(oneSheet(), options, 'bob-session').expect(404);
    expect(await countChangesets()).toBe(0);
  });

  it('un propietario ajeno recibe 404 en la hoja y en la importación', async () => {
    const { body } = await upload(PRODUCTS_CSV, mapping()).expect(201);
    await upload(PRODUCTS_CSV, mapping(), 'bob-session').expect(404);
    await send(
      'post',
      `${base}/worksheets/${worksheetId}/imports/preview`,
      'bob-session',
    )
      .attach('file', Buffer.from(PRODUCTS_CSV, 'utf8'), 'productos.csv')
      .expect(404);
    await send(
      'get',
      `${base}/worksheet-imports/${body.import.id}`,
      'bob-session',
    ).expect(404);
  });
});
