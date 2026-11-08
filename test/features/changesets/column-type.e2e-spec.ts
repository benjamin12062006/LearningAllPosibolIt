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
import { publicError } from '../../../src/common/http/public-error.js';
import { configureHttp } from '../../../src/configure-http.js';
import { POSTGRESQL_CONNECTION } from '../../../src/database/postgresql.connection.js';
import { OrganizationsRepository } from '../../../src/organizations/organizations.repository.js';
import { ProjectsModule } from '../../../src/projects/projects.module.js';
import { ProjectsRepository } from '../../../src/projects/projects.repository.js';
import { UsersService } from '../../../src/users/users.service.js';
import { WorksheetsModule } from '../../../src/worksheets/worksheets.module.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';

const SESSIONS: Record<string, AuthenticatedIdentity> = {
  'alice-session': alice,
  'bob-session': bob,
};
type Session = keyof typeof SESSIONS;

/** Filas de partida: un precio válido, uno que no es número, uno vacío, uno ausente y un entero. */
const ROWS = {
  valid: '00000000-0000-4000-8000-0000000000a1',
  word: '00000000-0000-4000-8000-0000000000a2',
  emptyText: '00000000-0000-4000-8000-0000000000a3',
  missing: '00000000-0000-4000-8000-0000000000a4',
  whole: '00000000-0000-4000-8000-0000000000a5',
};

type Changeset = {
  id: string;
  status: string;
  draftVersion: number;
  baseRevisionId: string;
  contentHash: string | null;
  operations: unknown[];
};

describe('Cambiar el tipo de una columna desde un borrador por HTTP (C5, E4.8)', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let base: string;
  let worksheetId: string;
  let columns: Record<string, string>;
  const validateSession = jest.fn<DescopeService['validateSession']>();

  beforeAll(async () => {
    database = await createTestDatabase();
    const module = await Test.createTestingModule({
      imports: [ProjectsModule, WorksheetsModule, ChangesetsModule],
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
    const project = await app
      .get(ProjectsRepository)
      .create(aliceId, 'Tienda', projectInput);
    const [organization] = await app
      .get(OrganizationsRepository)
      .findMemberships(aliceId, { limit: 1, offset: 0 });
    base = `/api/v1/organizations/${organization.id}/projects/${project.id}`;
    // Bob aprueba y aplica lo que prepara Alice.
    await database.connection.pool.query(
      `INSERT INTO estadistica_forms.organization_members
         (organization_id, user_id, role, created_at)
       VALUES ($1, $2, 'manager', '2026-11-08T12:00:00.000Z')`,
      [organization.id, bobId],
    );

    const { body: created } = await send('post', `${base}/workbooks`)
      .send({ name: 'Libro' })
      .expect(201);
    const { body } = await send(
      'post',
      `${base}/workbooks/${created.workbook.id}/worksheets`,
    )
      .send({
        name: 'Inventario',
        columns: [
          { name: 'SKU', type: 'text', required: true },
          { name: 'Precio', type: 'text' },
          { name: 'Estado', type: 'text' },
          { name: 'Cantidad', type: 'integer' },
          {
            name: 'Doble',
            type: 'calculated',
            formula: {
              expression: {
                op: 'mul',
                args: [{ column: 'Cantidad' }, { value: '2' }],
              },
              scale: 0,
              rounding: 'half_up',
            },
          },
        ],
      })
      .expect(201);
    worksheetId = body.worksheet.id;
    columns = Object.fromEntries(
      body.worksheet.columns.map(
        ({ id, name }: { id: string; name: string }) => [name, id],
      ),
    );
    await publish([
      insert(ROWS.valid, 'a', { SKU: 'A', Precio: '10.50', Estado: 'nuevo' }),
      insert(ROWS.word, 'b', { SKU: 'B', Precio: 'diez' }),
      insert(ROWS.emptyText, 'c', { SKU: 'C', Precio: '' }),
      insert(ROWS.missing, 'd', { SKU: 'D', Cantidad: '3' }),
      insert(ROWS.whole, 'e', { SKU: 'E', Precio: '7' }),
    ]);
  });
  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await database?.close();
    }
  });

  // ── Ayudas HTTP ──

  function send(
    method: 'get' | 'post' | 'put',
    path: string,
    session: Session = 'alice-session',
  ) {
    return request(app.getHttpServer())
      [method](path)
      .auth(session, { type: 'bearer' });
  }

  function insert(
    rowId: string,
    sortKey: string,
    named: Record<string, string>,
  ) {
    const values = Object.fromEntries(
      Object.entries(named).map(([name, value]) => [columns[name], value]),
    );
    return { type: 'insert_row', rowId, sortKey, values };
  }

  function retype(name: string, columnType: string, extra: object = {}) {
    return {
      type: 'change_column_type',
      columnId: columns[name],
      columnType,
      ...extra,
    };
  }

  async function draft(operations: unknown[]): Promise<Changeset> {
    const { body } = await send(
      'post',
      `${base}/worksheets/${worksheetId}/changesets`,
    )
      .send({ title: 'Cambio de tipo' })
      .expect(201);
    return saved(body.changeset, operations);
  }

  function save(changeset: Changeset, operations: unknown[]) {
    return send('put', `${base}/changesets/${changeset.id}/operations`)
      .set('If-Match', `"${changeset.draftVersion}"`)
      .send({ operations });
  }

  async function saved(changeset: Changeset, operations: unknown[]) {
    const { body } = await save(changeset, operations).expect(200);
    return body.changeset as Changeset;
  }

  async function review(changeset: Changeset) {
    const { body } = await send(
      'get',
      `${base}/changesets/${changeset.id}/diff`,
    ).expect(200);
    return body.review;
  }

  function submit(changeset: Changeset) {
    return send('post', `${base}/changesets/${changeset.id}/submit`).send({
      draftVersion: changeset.draftVersion,
    });
  }

  /** Enviado por Alice, aprobado y aplicado por Bob. */
  async function applied(changeset: Changeset) {
    const { body: sent } = await submit(changeset).expect(200);
    const pending = sent.changeset as Changeset;
    const { body: decided } = await send(
      'post',
      `${base}/changesets/${pending.id}/decisions`,
      'bob-session',
    )
      .send({
        decision: 'accept',
        contentHash: pending.contentHash,
        draftVersion: pending.draftVersion,
        expectedHeadRevisionId: pending.baseRevisionId,
      })
      .expect(201);
    const ready = decided.changeset as Changeset;
    const { body } = await send(
      'post',
      `${base}/changesets/${ready.id}/apply`,
      'bob-session',
    )
      .set('Idempotency-Key', `aplicar-${ready.id}`)
      .send({
        contentHash: ready.contentHash,
        expectedHeadRevisionId: ready.baseRevisionId,
      })
      .expect(200);
    return body.applied as { revisionId: string; sequence: number };
  }

  async function publish(operations: unknown[]) {
    return applied(await draft(operations));
  }

  async function valuesByRow() {
    const { body } = await send(
      'post',
      `${base}/worksheets/${worksheetId}/rows/query`,
    )
      .send({})
      .expect(200);
    return Object.fromEntries(
      body.items.map(
        (item: { rowId: string; values: Record<string, unknown> }) => [
          item.rowId,
          item.values,
        ],
      ),
    );
  }

  async function columnTypes() {
    const { body } = await send(
      'get',
      `${base}/worksheets/${worksheetId}`,
    ).expect(200);
    return Object.fromEntries(
      body.worksheet.columns.map(
        ({ name, type }: { name: string; type: string }) => [name, type],
      ),
    );
  }

  const problemOf = (rowId: string, name: string) => ({
    rowId,
    columnId: columns[name],
    code: 'CELL_VALUE_INVALID',
  });

  it('H3: la revisión enseña cada incompatible y no deja enviar; corregidos en el mismo borrador, se aplica sin perder nada', async () => {
    const pending = await draft([retype('Precio', 'decimal')]);
    // La conversión no se guarda en el borrador: sigue siendo una operación.
    expect(pending.operations).toHaveLength(1);

    const preview = await review(pending);
    expect(preview.columnConversions).toEqual([
      {
        columnId: columns.Precio,
        fromType: 'text',
        toType: 'decimal',
        convertedCells: 2,
        incompatibleCells: 2,
      },
    ]);
    expect(preview.problems).toEqual(
      expect.arrayContaining([
        problemOf(ROWS.word, 'Precio'),
        problemOf(ROWS.emptyText, 'Precio'),
      ]),
    );
    expect(preview.problems).toHaveLength(2);
    await submit(pending)
      .expect(400)
      .expect(({ body }) =>
        expect(
          body.issues.map(({ field }: { field: string }) => field),
        ).toEqual(
          expect.arrayContaining([
            `rows.${ROWS.word}.${columns.Precio}`,
            `rows.${ROWS.emptyText}.${columns.Precio}`,
          ]),
        ),
      );
    expect((await valuesByRow())[ROWS.word][columns.Precio]).toBe('diez');

    const fixed = await saved(pending, [
      retype('Precio', 'decimal'),
      {
        type: 'set_cell',
        rowId: ROWS.word,
        columnId: columns.Precio,
        value: '10.00',
      },
      {
        type: 'set_cell',
        rowId: ROWS.emptyText,
        columnId: columns.Precio,
        value: null,
      },
    ]);
    const clean = await review(fixed);
    expect(clean.problems).toEqual([]);
    expect(clean.columnConversions[0]).toMatchObject({
      convertedCells: 2,
      incompatibleCells: 0,
    });

    await applied(fixed);
    const values = await valuesByRow();
    expect(values[ROWS.valid][columns.Precio]).toBe('10.50');
    expect(values[ROWS.word][columns.Precio]).toBe('10.00');
    expect(values[ROWS.emptyText][columns.Precio]).toBeNull();
    expect(values[ROWS.missing][columns.Precio]).toBeNull();
    expect(values[ROWS.whole][columns.Precio]).toBe('7');
    expect(values[ROWS.valid][columns.SKU]).toBe('A');
    expect((await columnTypes()).Precio).toBe('decimal');
  });

  it('hacia selección guarda el ID de la opción con esa etiqueta', async () => {
    await publish([
      retype('Estado', 'selection', {
        options: [{ label: 'nuevo' }, { label: 'usado' }],
      }),
    ]);

    const { body } = await send(
      'get',
      `${base}/worksheets/${worksheetId}`,
    ).expect(200);
    const estado = body.worksheet.columns.find(
      ({ name }: { name: string }) => name === 'Estado',
    );
    const nuevo = estado.options.find(
      ({ label }: { label: string }) => label === 'nuevo',
    );
    expect(estado.type).toBe('selection');
    expect((await valuesByRow())[ROWS.valid][columns.Estado]).toBe(nuevo.id);
  });

  it('una entrada de una calculada solo cambia a otro tipo numérico', async () => {
    const pending = await draft([]);
    await save(pending, [retype('Cantidad', 'text')])
      .expect(400)
      .expect(({ body }) =>
        expect(body.issues).toEqual([
          { field: 'operations.0', ...publicError('COLUMN_IN_USE') },
        ]),
      );

    await applied(await saved(pending, [retype('Cantidad', 'decimal')]));
    const { body } = await send(
      'post',
      `${base}/worksheets/${worksheetId}/rows/query`,
    )
      .send({})
      .expect(200);
    const row = body.items.find(
      ({ rowId }: { rowId: string }) => rowId === ROWS.missing,
    );
    expect(row.values[columns.Cantidad]).toBe('3');
    expect(row.values[columns.Doble]).toBe('6');
  });

  it('rebasar recalcula la conversión sobre la cabecera nueva: una edición posterior no se pierde', async () => {
    const pending = await draft([retype('Precio', 'decimal')]);
    await publish([
      {
        type: 'set_cell',
        rowId: ROWS.word,
        columnId: columns.Precio,
        value: '3.00',
      },
    ]);
    await submit(pending)
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('CHANGESET_BASE_OUTDATED')),
      );

    const { body } = await send(
      'post',
      `${base}/changesets/${pending.id}/rebase`,
    )
      .send({ draftVersion: pending.draftVersion })
      .expect(200);
    const rebased = await review(body.changeset);
    expect(rebased.columnConversions[0]).toMatchObject({
      convertedCells: 3,
      incompatibleCells: 1,
    });
    expect(rebased.problems).toEqual([problemOf(ROWS.emptyText, 'Precio')]);
  });

  it('H4: si la cabecera cambió el esquema de esa columna, el cambio de tipo es un conflicto', async () => {
    const pending = await draft([retype('Precio', 'decimal')]);
    await publish([
      { type: 'rename_column', columnId: columns.Precio, name: 'Coste' },
    ]);

    const comparison = await review(pending);
    expect(comparison.entries[0]).toMatchObject({
      columnId: columns.Precio,
      proposed: 'decimal',
      status: 'conflict',
      reason: 'schema_changed',
    });
  });
});
