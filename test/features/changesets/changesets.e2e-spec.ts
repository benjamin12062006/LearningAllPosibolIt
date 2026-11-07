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
import type { OrganizationRole } from '../../../src/organizations/organization-roles.js';
import { OrganizationsRepository } from '../../../src/organizations/organizations.repository.js';
import { ProjectsModule } from '../../../src/projects/projects.module.js';
import { ProjectsRepository } from '../../../src/projects/projects.repository.js';
import { UsersService } from '../../../src/users/users.service.js';
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

const ROW_A = '00000000-0000-4000-8000-0000000000a1';
const ROW_B = '00000000-0000-4000-8000-0000000000b1';
const ROW_N = '00000000-0000-4000-8000-0000000000f1';

type Session = 'alice-session' | 'bob-session' | 'carol-session';
type Changeset = {
  id: string;
  status: string;
  draftVersion: number;
  baseRevisionId: string;
  contentHash: string | null;
  operations: unknown[];
  source: string;
};

describe('Borradores de hojas por HTTP (E4), con guard y PostgreSQL temporal', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let base: string;
  let organizationId: string;
  let worksheetId: string;
  let sku: string;
  let price: string;
  let bobId: string;
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
    bobId = (await users.provision(bob)).id;
    const carolId = (await users.provision(carol)).id;
    // Carol tiene su propia organización: sirve de propietaria ajena.
    await app.get(ProjectsRepository).create(carolId, 'Ajena', projectInput);

    const project = await app
      .get(ProjectsRepository)
      .create(aliceId, 'Tienda', projectInput);
    const [organization] = await app
      .get(OrganizationsRepository)
      .findMemberships(aliceId, { limit: 1, offset: 0 });
    organizationId = organization.id;
    base = `/api/v1/organizations/${organizationId}/projects/${project.id}`;
    await setBobRole('manager');

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
          { name: 'Precio', type: 'decimal' },
        ],
      })
      .expect(201);
    worksheetId = body.worksheet.id;
    [sku, price] = body.worksheet.columns.map(({ id }: { id: string }) => id);
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

  async function setBobRole(role: OrganizationRole | null) {
    await database.connection.pool.query(
      `DELETE FROM estadistica_forms.organization_members
       WHERE organization_id = $1 AND user_id = $2`,
      [organizationId, bobId],
    );
    if (role) {
      await database.connection.pool.query(
        `INSERT INTO estadistica_forms.organization_members
           (organization_id, user_id, role, created_at)
         VALUES ($1, $2, $3, '2026-11-06T12:00:00.000Z')`,
        [organizationId, bobId, role],
      );
    }
  }

  async function createDraft(title = 'Cambio'): Promise<Changeset> {
    const { body } = await send(
      'post',
      `${base}/worksheets/${worksheetId}/changesets`,
    )
      .send({ title })
      .expect(201)
      .expect('ETag', '"1"');
    return body.changeset;
  }

  function save(changeset: Changeset, operations: unknown[], ifMatch?: string) {
    const call = send('put', `${base}/changesets/${changeset.id}/operations`);
    if (ifMatch !== undefined) call.set('If-Match', ifMatch);
    return call.send({ operations });
  }

  async function saved(changeset: Changeset, operations: unknown[]) {
    const { body } = await save(
      changeset,
      operations,
      `"${changeset.draftVersion}"`,
    ).expect(200);
    return body.changeset as Changeset;
  }

  async function review(changesetId: string, session: Session = 'bob-session') {
    const { body } = await send(
      'get',
      `${base}/changesets/${changesetId}/diff`,
      session,
    ).expect(200);
    return body.review;
  }

  async function submitted(changeset: Changeset) {
    const { body } = await send(
      'post',
      `${base}/changesets/${changeset.id}/submit`,
    )
      .send({ draftVersion: changeset.draftVersion })
      .expect(200);
    return body.changeset as Changeset;
  }

  function decide(
    changeset: Changeset,
    decision: 'accept' | 'reject',
    session: Session = 'bob-session',
  ) {
    return send(
      'post',
      `${base}/changesets/${changeset.id}/decisions`,
      session,
    ).send({
      decision,
      contentHash: changeset.contentHash,
      draftVersion: changeset.draftVersion,
      expectedHeadRevisionId: changeset.baseRevisionId,
    });
  }

  async function approved(changeset: Changeset) {
    const { body } = await decide(changeset, 'accept').expect(201);
    return body.changeset as Changeset;
  }

  function apply(
    changeset: Changeset,
    key: string | null,
    session: Session = 'bob-session',
    expectedHeadRevisionId = changeset.baseRevisionId,
  ) {
    const call = send(
      'post',
      `${base}/changesets/${changeset.id}/apply`,
      session,
    );
    if (key !== null) call.set('Idempotency-Key', key);
    return call.send({
      contentHash: changeset.contentHash,
      expectedHeadRevisionId,
    });
  }

  /** Borrador → guardado → enviado → aprobado por Bob → aplicado. */
  async function publish(operations: unknown[], title = 'Cambio') {
    const draft = await saved(await createDraft(title), operations);
    const ready = await approved(await submitted(draft));
    const { body } = await apply(ready, `publicar-${ready.id}`).expect(200);
    return body.applied as { revisionId: string; sequence: number };
  }

  async function rows() {
    const { body } = await send(
      'post',
      `${base}/worksheets/${worksheetId}/rows/query`,
    )
      .send({})
      .expect(200);
    return body as {
      revisionId: string;
      items: { rowId: string; values: Record<string, unknown> }[];
    };
  }

  async function count(table: string, where = 'TRUE', values: unknown[] = []) {
    const { rows: result } = await database.connection.pool.query<{
      n: number;
    }>(
      `SELECT count(*)::int AS n FROM estadistica_forms.${table} WHERE ${where}`,
      values,
    );
    return result[0].n;
  }

  const insertA = {
    type: 'insert_row',
    rowId: ROW_A,
    sortKey: 'a',
    values: {} as Record<string, string>,
  };
  function seedRows() {
    return publish(
      [
        { ...insertA, values: { [sku]: 'A-001', [price]: '10.00' } },
        {
          type: 'insert_row',
          rowId: ROW_B,
          sortKey: 'b',
          values: { [sku]: 'B-002', [price]: '5.00' },
        },
      ],
      'Filas iniciales',
    );
  }

  // ── Pruebas ──

  it('recorrido completo: guardar, comparar, enviar, aprobar otra persona y aplicar crea una revisión legible', async () => {
    const draft = await createDraft();
    expect(draft).toMatchObject({
      status: 'draft',
      draftVersion: 1,
      source: 'manual',
      operations: [],
    });

    const edited = await saved(draft, [
      { ...insertA, values: { [sku]: 'A-001', [price]: '10.00' } },
    ]);
    expect(edited.draftVersion).toBe(2);

    const comparison = await review(edited.id);
    expect(comparison).toMatchObject({
      baseRevisionId: draft.baseRevisionId,
      headRevisionId: draft.baseRevisionId,
      counts: { change: 1, noop: 0, satisfied: 0, conflict: 0 },
      problems: [],
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    const pending = await submitted(edited);
    expect(pending).toMatchObject({
      status: 'pending_review',
      contentHash: comparison.contentHash,
      draftVersion: 2,
    });

    const { body: decided } = await decide(pending, 'accept').expect(201);
    expect(decided.decision).toMatchObject({
      decision: 'accept',
      policy: 'peer',
      contentHash: comparison.contentHash,
    });

    const { body } = await apply(decided.changeset, 'clave-1').expect(200);
    expect(body.applied).toEqual({
      changesetId: draft.id,
      revisionId: expect.any(String),
      sequence: 2,
    });

    const current = await rows();
    expect(current.revisionId).toBe(body.applied.revisionId);
    expect(current.items).toEqual([
      expect.objectContaining({
        rowId: ROW_A,
        values: { [sku]: 'A-001', [price]: '10.00' },
      }),
    ]);
    await send('get', `${base}/worksheets/${worksheetId}`)
      .expect(200)
      .expect(({ body: sheet }) =>
        expect(sheet.worksheet.headRevision).toMatchObject({
          id: body.applied.revisionId,
          sequence: 2,
          rowCount: 1,
        }),
      );
    await send('get', `${base}/changesets/${draft.id}`)
      .expect(200)
      .expect(({ body: final }) =>
        expect(final.changeset).toMatchObject({
          status: 'applied',
          appliedRevisionId: body.applied.revisionId,
        }),
      );

    const { rows: events } = await database.connection.pool.query<{
      action: string;
    }>(
      `SELECT action FROM estadistica_forms.audit_events
       WHERE resource_id = $1 ORDER BY created_at, action`,
      [draft.id],
    );
    expect(events.map(({ action }) => action).sort()).toEqual(
      [
        'changeset.applied',
        'changeset.approved',
        'changeset.created',
        'changeset.submitted',
      ].sort(),
    );
  });

  it('T07: dos pestañas con la misma versión: la primera guarda y la segunda recibe 412 sin pisarla', async () => {
    const draft = await createDraft();
    const tabA = [{ ...insertA, values: { [sku]: 'de A' } }];
    const tabB = [{ ...insertA, values: { [sku]: 'de B' } }];

    await save(draft, tabA, '"1"').expect(200).expect('ETag', '"2"');
    await save(draft, tabB, '"1"')
      .expect(412)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('CHANGESET_VERSION_MISMATCH')),
      );
    await save(draft, tabB)
      .expect(428)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('CHANGESET_VERSION_REQUIRED')),
      );
    await save(draft, tabB, 'W/"2"').expect(412);

    await send('get', `${base}/changesets/${draft.id}`)
      .expect(200)
      .expect('ETag', '"2"')
      .expect(({ body }) =>
        expect(body.changeset.operations).toEqual([
          { ...insertA, values: { [sku]: 'de A' } },
        ]),
      );
  });

  it('guardar valida las operaciones contra el esquema y solo lo hace su autor', async () => {
    const draft = await createDraft();
    await save(
      draft,
      [
        { type: 'set_cell', rowId: ROW_B, columnId: sku, value: 'X' },
        { ...insertA, values: { [price]: '1,50' } },
      ],
      '"1"',
    )
      .expect(400)
      .expect(({ body }) =>
        expect(body.issues).toEqual([
          expect.objectContaining({
            field: 'operations.0.rowId',
            code: 'OPERATION_ROW_UNKNOWN',
          }),
          expect.objectContaining({
            field: `operations.1.values.${price}`,
            code: 'OPERATION_VALUE_INVALID',
          }),
        ]),
      );

    await send(
      'put',
      `${base}/changesets/${draft.id}/operations`,
      'bob-session',
    )
      .set('If-Match', '"1"')
      .send({ operations: [] })
      .expect(403);
  });

  it('enviar exige la versión vigente y que las filas resultantes cumplan sus columnas', async () => {
    const draft = await saved(await createDraft(), [
      { ...insertA, values: { [price]: '3' } },
    ]);
    await send('post', `${base}/changesets/${draft.id}/submit`)
      .send({ draftVersion: 1 })
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('CHANGESET_STALE')),
      );
    await send('post', `${base}/changesets/${draft.id}/submit`)
      .send({ draftVersion: 2 })
      .expect(400)
      .expect(({ body }) =>
        expect(body.issues).toEqual([
          expect.objectContaining({
            field: `rows.${ROW_A}.${sku}`,
            code: 'CELL_REQUIRED',
          }),
        ]),
      );
  });

  it('aprobar: no el propio borrador en un equipo, no sin permiso, no otro contenido; sí en una empresa de una persona', async () => {
    const pending = await submitted(
      await saved(await createDraft(), [
        { ...insertA, values: { [sku]: 'A' } },
      ]),
    );

    await decide(pending, 'accept', 'alice-session')
      .expect(403)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('CHANGESET_SELF_APPROVAL')),
      );
    await setBobRole('editor');
    await decide(pending, 'accept').expect(403);
    await setBobRole('manager');
    await decide({ ...pending, contentHash: 'f'.repeat(64) }, 'accept')
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('CHANGESET_STALE')),
      );

    await setBobRole(null);
    const { body } = await decide(pending, 'accept', 'alice-session').expect(
      201,
    );
    expect(body.decision.policy).toBe('single_member');
    expect(body.changeset.status).toBe('approved');
  });

  it('T10: doble clic, reintento y otra clave producen una sola revisión y un solo recibo', async () => {
    const ready = await approved(
      await submitted(
        await saved(await createDraft(), [
          { ...insertA, values: { [sku]: 'A' } },
        ]),
      ),
    );

    await apply(ready, null)
      .expect(400)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('IDEMPOTENCY_KEY_REQUIRED')),
      );

    const [first, second] = await Promise.all([
      apply(ready, 'doble-clic'),
      apply(ready, 'doble-clic'),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // El mismo cuerpo byte a byte, no solo los mismos datos.
    expect(second.text).toBe(first.text);

    await apply(ready, 'doble-clic')
      .expect(200)
      .expect(({ text }) => expect(text).toBe(first.text));
    await apply(
      ready,
      'doble-clic',
      'bob-session',
      first.body.applied.revisionId,
    )
      .expect(422)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('IDEMPOTENCY_KEY_REUSED')),
      );
    await apply(ready, 'otra-clave')
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('CHANGESET_STATE_INVALID')),
      );

    expect(
      await count('worksheet_revisions', 'changeset_id = $1', [ready.id]),
    ).toBe(1);
    expect(
      await count('operation_receipts', 'resource_id = $1', [ready.id]),
    ).toBe(1);
  });

  it('T09: si el head cambia después de aprobar no se aplica, el borrador queda en conflicto y el rebase lo recupera', async () => {
    await seedRows();
    const mine = await approved(
      await submitted(
        await saved(await createDraft('Mío'), [
          { type: 'set_cell', rowId: ROW_A, columnId: price, value: '11.00' },
        ]),
      ),
    );
    await publish([
      { type: 'set_cell', rowId: ROW_A, columnId: price, value: '12.00' },
    ]);

    await apply(mine, 'tarde')
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('WORKSHEET_HEAD_CHANGED')),
      );
    const comparison = await review(mine.id);
    expect(comparison.counts.conflict).toBe(1);
    expect(comparison.entries[0]).toMatchObject({
      base: '10.00',
      head: '12.00',
      proposed: '11.00',
      status: 'conflict',
    });
    const { body: stored } = await send(
      'get',
      `${base}/changesets/${mine.id}`,
    ).expect(200);
    expect(stored.changeset.status).toBe('conflicted');
    expect((await rows()).items[0].values[price]).toBe('12.00');

    const rebase = (resolutions?: unknown[]) =>
      send('post', `${base}/changesets/${mine.id}/rebase`).send({
        draftVersion: stored.changeset.draftVersion,
        ...(resolutions ? { resolutions } : {}),
      });
    await rebase()
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('CHANGESET_CONFLICTS')),
      );
    const { body: rebased } = await rebase([
      { rowId: ROW_A, columnId: price, choice: 'proposed' },
    ]).expect(200);
    expect(rebased.changeset).toMatchObject({
      status: 'draft',
      baseRevisionId: comparison.headRevisionId,
      draftVersion: stored.changeset.draftVersion + 1,
    });

    const ready = await approved(await submitted(rebased.changeset));
    await apply(ready, 'otra-vez').expect(200);
    expect((await rows()).items[0].values[price]).toBe('11.00');
  });

  it('rebase: elegir la propuesta sobre una fila que otra persona borró no la resucita', async () => {
    await seedRows();
    const mine = await saved(await createDraft(), [
      { type: 'set_cell', rowId: ROW_A, columnId: price, value: '11.00' },
    ]);
    await publish([{ type: 'delete_row', rowId: ROW_A }]);

    const rebase = (choice: 'proposed' | 'head') =>
      send('post', `${base}/changesets/${mine.id}/rebase`).send({
        draftVersion: mine.draftVersion,
        resolutions: [{ rowId: ROW_A, columnId: price, choice }],
      });
    await rebase('proposed')
      .expect(400)
      .expect(({ body }) =>
        expect(body.issues).toEqual([
          expect.objectContaining({ code: 'OPERATION_ROW_UNKNOWN' }),
        ]),
      );
    const { body } = await rebase('head').expect(200);
    expect(body.changeset.operations).toEqual([]);
    expect((await rows()).items.map(({ rowId }) => rowId)).toEqual([ROW_B]);
  });

  it('T12: reabrir invalida las decisiones, y restaurar crea un borrador inverso que publica una revisión nueva', async () => {
    await seedRows();
    const pending = await submitted(
      await saved(await createDraft(), [
        { type: 'set_cell', rowId: ROW_A, columnId: price, value: '99.00' },
      ]),
    );
    await decide(pending, 'reject').expect(201);

    const { body: reopened } = await send(
      'post',
      `${base}/changesets/${pending.id}/reopen`,
    )
      .send({ draftVersion: pending.draftVersion })
      .expect(200)
      .expect('ETag', `"${pending.draftVersion + 1}"`);
    expect(reopened.changeset).toMatchObject({
      status: 'draft',
      contentHash: null,
    });
    // Mismo contenido enviado otra vez: lo decidido sobre la versión anterior ya no vale.
    const resent = await submitted(reopened.changeset);
    expect(resent.contentHash).toBe(pending.contentHash);
    await decide(pending, 'accept')
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('CHANGESET_STALE')),
      );
    await apply(resent, 'sin-aprobar').expect(409);

    const ready = await approved(resent);
    // [13]: un borrador aprobado no vuelve a borrador; solo se cancela.
    await send('post', `${base}/changesets/${ready.id}/reopen`)
      .send({ draftVersion: ready.draftVersion })
      .expect(409);
    const changed = await apply(ready, 'aprobado').expect(200);
    expect((await rows()).items[0].values[price]).toBe('99.00');

    const { body: proposal } = await send(
      'post',
      `${base}/revisions/${changed.body.applied.revisionId}/revert-proposal`,
    ).expect(201);
    expect(proposal.changeset).toMatchObject({
      source: 'revert',
      status: 'draft',
      baseRevisionId: changed.body.applied.revisionId,
      operations: [
        { type: 'set_cell', rowId: ROW_A, columnId: price, value: '10.00' },
      ],
    });

    const reverted = await apply(
      await approved(await submitted(proposal.changeset)),
      'revertir',
    ).expect(200);
    expect(reverted.body.applied.sequence).toBe(
      changed.body.applied.sequence + 1,
    );
    expect((await rows()).items[0].values[price]).toBe('10.00');

    await send(
      'post',
      `${base}/revisions/${changed.body.applied.revisionId}/revert-proposal`,
    )
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('REVERT_NOTHING_TO_UNDO')),
      );
  });

  it('cancelar: el autor o quien aprueba; uno aplicado ya no se cancela', async () => {
    const draft = await createDraft();
    await send('post', `${base}/changesets/${draft.id}/cancel`, 'bob-session')
      .expect(200)
      .expect(({ body }) => expect(body.changeset.status).toBe('cancelled'));
    await save(draft, [], '"1"').expect(409);

    await seedRows();
    const { rows: applied } = await database.connection.pool.query<{
      id: string;
    }>(
      `SELECT id FROM estadistica_forms.worksheet_changesets WHERE status = 'applied'`,
    );
    await send('post', `${base}/changesets/${applied[0].id}/cancel`)
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('CHANGESET_STATE_INVALID')),
      );
  });

  it('una organización archivada se lee pero no acepta cambios de borradores', async () => {
    const draft = await createDraft();
    // Una organización personal no se archiva: se convierte antes en de equipo.
    await database.connection.pool.query(
      `UPDATE estadistica_forms.organizations
       SET personal_owner_id = NULL, archived_at = '2026-11-06T12:00:00.000Z'
       WHERE id = $1`,
      [organizationId],
    );
    await send('get', `${base}/changesets/${draft.id}`).expect(200);
    await save(draft, [], '"1"')
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('ORGANIZATION_ARCHIVED')),
      );
    await send('post', `${base}/worksheets/${worksheetId}/changesets`)
      .send({ title: 'Otro' })
      .expect(409);
  });

  it('para una propietaria ajena, todo lo de otra organización responde 404', async () => {
    const { revisionId } = await seedRows();
    const pending = await submitted(
      await saved(await createDraft(), [
        { type: 'set_cell', rowId: ROW_A, columnId: price, value: '1.00' },
      ]),
    );
    const outsider = 'carol-session';

    await send('get', `${base}/changesets/${pending.id}`, outsider).expect(404);
    await send('get', `${base}/changesets/${pending.id}/diff`, outsider).expect(
      404,
    );
    await send('put', `${base}/changesets/${pending.id}/operations`, outsider)
      .set('If-Match', `"${pending.draftVersion}"`)
      .send({ operations: [] })
      .expect(404);
    await decide(pending, 'accept', outsider).expect(404);
    await apply(pending, 'ajena', outsider).expect(404);
    await send('post', `${base}/worksheets/${worksheetId}/changesets`, outsider)
      .send({ title: 'Intruso' })
      .expect(404);
    await send(
      'post',
      `${base}/revisions/${revisionId}/revert-proposal`,
      outsider,
    ).expect(404);
    await send('post', `${base}/changesets/${pending.id}/reopen`, outsider)
      .send({ draftVersion: pending.draftVersion })
      .expect(404);
    await send(
      'post',
      `${base}/changesets/${pending.id}/cancel`,
      outsider,
    ).expect(404);

    expect(
      await count('worksheet_changesets', "status = 'pending_review'"),
    ).toBe(1);
  });

  it('E4.7: añadir, renombrar y borrar columnas publica un esquema nuevo y las revisiones antiguas conservan el suyo', async () => {
    const color = '00000000-0000-4000-8000-00000000c0aa';
    const seeded = await seedRows();
    const withColor = await publish([
      {
        type: 'add_column',
        columnId: color,
        name: 'Color',
        columnType: 'text',
      },
      { type: 'rename_column', columnId: price, name: 'Venta' },
      { type: 'set_cell', rowId: ROW_A, columnId: color, value: 'rojo' },
    ]);

    const { body: sheet } = await send(
      'get',
      `${base}/worksheets/${worksheetId}`,
    ).expect(200);
    expect(sheet.worksheet.schemaVersion).toBe(2);
    expect(
      sheet.worksheet.columns.map(
        ({ id, name }: { id: string; name: string }) => [id, name],
      ),
    ).toEqual([
      [sku, 'SKU'],
      [price, 'Venta'],
      [color, 'Color'],
    ]);
    const current = await rows();
    expect(current.items[0].values).toEqual({
      [sku]: 'A-001',
      [price]: '10.00',
      [color]: 'rojo',
    });

    // La revisión anterior se sigue leyendo con su esquema de dos columnas.
    await send('post', `${base}/worksheets/${worksheetId}/rows/query`)
      .send({ revisionId: seeded.revisionId })
      .expect(200)
      .expect(({ body }) => {
        expect(body.schemaVersion).toBe(1);
        expect(Object.keys(body.items[0].values)).toEqual([sku, price]);
      });

    await publish([{ type: 'delete_column', columnId: color }]);
    expect(Object.keys((await rows()).items[0].values)).toEqual([sku, price]);
    expect(withColor.sequence).toBe(3);
  });

  it('E4.7: un cambio de esquema sobre un esquema ya cambiado es conflicto y se resuelve por columna', async () => {
    await seedRows();
    const mine = await saved(await createDraft(), [
      { type: 'rename_column', columnId: sku, name: 'Código' },
    ]);
    await publish([
      {
        type: 'add_column',
        columnId: '00000000-0000-4000-8000-00000000c0bb',
        name: 'Notas',
        columnType: 'text',
      },
    ]);

    const comparison = await review(mine.id);
    expect(comparison.entries[0]).toMatchObject({
      rowId: null,
      columnId: sku,
      status: 'conflict',
      reason: 'schema_changed',
    });
    await send('post', `${base}/changesets/${mine.id}/submit`)
      .send({ draftVersion: mine.draftVersion })
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject(publicError('CHANGESET_BASE_OUTDATED')),
      );

    const { body } = await send('post', `${base}/changesets/${mine.id}/rebase`)
      .send({
        draftVersion: mine.draftVersion,
        resolutions: [{ rowId: null, columnId: sku, choice: 'proposed' }],
      })
      .expect(200);
    await apply(
      await approved(await submitted(body.changeset)),
      'renombrar',
    ).expect(200);
    await send('get', `${base}/worksheets/${worksheetId}`)
      .expect(200)
      .expect(({ body: sheet }) => {
        expect(sheet.worksheet.schemaVersion).toBe(3);
        expect(
          sheet.worksheet.columns.map(({ name }: { name: string }) => name),
        ).toEqual(['Código', 'Precio', 'Notas']);
      });
  });

  it('E4.7: borrar una columna que usa una fórmula se rechaza al guardar', async () => {
    const { body: created } = await send('post', `${base}/workbooks`)
      .send({ name: 'Cálculos' })
      .expect(201);
    const { body } = await send(
      'post',
      `${base}/workbooks/${created.workbook.id}/worksheets`,
    )
      .send({
        name: 'Margen',
        columns: [
          { name: 'Precio', type: 'decimal' },
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
        ],
      })
      .expect(201);
    const [priceColumn] = body.worksheet.columns;
    const { body: draft } = await send(
      'post',
      `${base}/worksheets/${body.worksheet.id}/changesets`,
    )
      .send({ title: 'Quitar precio' })
      .expect(201);

    await save(
      draft.changeset,
      [{ type: 'delete_column', columnId: priceColumn.id }],
      '"1"',
    )
      .expect(400)
      .expect(({ body: error }) =>
        expect(error.issues).toEqual([
          expect.objectContaining({
            field: 'operations.0',
            code: 'COLUMN_IN_USE',
          }),
        ]),
      );
  });

  it('rechaza IDs que no son UUID y cuerpos mal formados', async () => {
    await send('get', `${base}/changesets/no-uuid`).expect(400);
    const draft = await createDraft();
    await send('post', `${base}/changesets/${draft.id}/submit`)
      .send({ draftVersion: 0 })
      .expect(400);
    await save(
      draft,
      Array.from({ length: 1001 }, () => ({})),
      '"1"',
    ).expect(400);
    await send('post', `${base}/changesets/${draft.id}/rebase`)
      .send({
        draftVersion: 1,
        resolutions: [{ rowId: ROW_N, columnId: null, choice: 'mine' }],
      })
      .expect(400);
  });
});
