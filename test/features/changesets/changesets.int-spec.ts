import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import { contentHash } from '../../../src/changesets/changeset-diff.js';
import type { Operation } from '../../../src/changesets/changeset-operations.js';
import { ChangesetsRepository } from '../../../src/changesets/changesets.repository.js';
import type { Changeset } from '../../../src/changesets/changesets.types.js';
import { PrismaService } from '../../../src/database/prisma.service.js';
import { OrganizationsRepository } from '../../../src/organizations/organizations.repository.js';
import { ProjectsRepository } from '../../../src/projects/projects.repository.js';
import {
  UsersRepository,
  type LocalUser,
} from '../../../src/users/users.repository.js';
import { WorksheetsRepository } from '../../../src/worksheets/worksheets.repository.js';
import type {
  ProjectScope,
  Worksheet,
} from '../../../src/worksheets/worksheets.types.js';
import { alice, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';
import { newWorksheet } from '../worksheets/support/new-worksheet-fixture.js';

const ROW_A = '00000000-0000-4000-8000-0000000000a1';
const ROW_B = '00000000-0000-4000-8000-0000000000b1';
const PAYLOAD_HASH = 'a'.repeat(64);

/**
 * T11 ([18]): un fallo entre los datos, la auditoría y el recibo deshace todo.
 * Los fallos se fuerzan con disparadores de PostgreSQL en el punto exacto.
 */
describe('Aplicar un borrador con PostgreSQL temporal: todo o nada', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let prisma: PrismaService;
  let changesets: ChangesetsRepository;
  let owner: LocalUser;
  let scope: ProjectScope;
  let worksheet: Worksheet;

  beforeAll(async () => {
    database = await createTestDatabase();
    prisma = new PrismaService(database.connection);
    await prisma.onModuleInit();
    changesets = new ChangesetsRepository(prisma);
  });
  beforeEach(async () => {
    await database.connection.pool.query(
      'TRUNCATE estadistica_forms.app_users CASCADE',
    );
    owner = await new UsersRepository(prisma).provision(alice);
    const project = await new ProjectsRepository(prisma).create(
      owner.id,
      'Tienda',
      projectInput,
    );
    const [organization] = await new OrganizationsRepository(
      prisma,
    ).findMemberships(owner.id, { limit: 1, offset: 0 });
    scope = { organizationId: organization.id, projectId: project.id };

    const worksheets = new WorksheetsRepository(prisma);
    const workbook = await worksheets.createWorkbook(owner.id, scope, 'Libro');
    ({ worksheet } = await worksheets.createWorksheet(
      owner.id,
      scope,
      workbook.id,
      newWorksheet('Inventario', [
        { name: 'SKU', type: 'text' as const, required: false },
      ]),
    ));
  });
  afterEach(async () => {
    await database.connection.pool.query(
      'DROP FUNCTION IF EXISTS estadistica_forms.fail_on_purpose() CASCADE',
    );
  });
  afterAll(async () => {
    try {
      await prisma?.onModuleDestroy();
    } finally {
      await database?.close();
    }
  });

  const sku = () => worksheet.columns[0].id;

  /** Borrador enviado y aprobado por la única persona de la empresa. */
  async function approvedChangeset(operations: Operation[]) {
    const head = await changesets.findHead(owner.id, scope, worksheet.id);
    if (!head) throw new Error('La hoja de prueba no tiene head');
    const created = await changesets.create(owner.id, scope, {
      worksheetId: worksheet.id,
      title: 'Cambio',
      source: 'manual',
      base: head,
      operations,
    });
    const hash = contentHash({
      worksheetId: worksheet.id,
      baseRevisionId: head.id,
      baseSchemaVersion: head.schemaVersion,
      operations,
    });
    await changesets.submit(owner.id, scope, created.id, 1, hash);
    const { changeset } = await changesets.decide(owner.id, scope, created.id, {
      decision: 'accept',
      contentHash: hash,
      draftVersion: 1,
      expectedHeadRevisionId: head.id,
      reason: null,
    });
    return changeset;
  }

  function apply(changeset: Changeset, key = 'clave') {
    return changesets.apply(owner.id, scope, changeset.id, {
      idempotencyKey: key,
      payloadHash: PAYLOAD_HASH,
      contentHash: changeset.contentHash ?? '',
      expectedHeadRevisionId: changeset.baseRevisionId,
    });
  }

  async function failOnInsertInto(table: string, condition = 'TRUE') {
    const pool = database.connection.pool;
    await pool.query(`
      CREATE FUNCTION estadistica_forms.fail_on_purpose() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF ${condition} THEN
          RAISE EXCEPTION 'fallo a propósito en ${table}';
        END IF;
        RETURN NEW;
      END $$`);
    await pool.query(`
      CREATE TRIGGER fail_on_purpose BEFORE INSERT ON estadistica_forms.${table}
      FOR EACH ROW EXECUTE FUNCTION estadistica_forms.fail_on_purpose()`);
  }

  /** Lo que un apply a medias podría dejar escrito. */
  async function snapshot(changesetId: string) {
    const { rows } = await database.connection.pool.query(
      `SELECT
         (SELECT head_revision_id FROM estadistica_forms.worksheets WHERE id = $1) AS head,
         (SELECT generation FROM estadistica_forms.worksheets WHERE id = $1) AS generation,
         (SELECT count(*)::int FROM estadistica_forms.worksheet_revisions WHERE worksheet_id = $1) AS revisions,
         (SELECT count(*)::int FROM estadistica_forms.worksheet_row_versions WHERE worksheet_id = $1) AS "rowVersions",
         (SELECT count(*)::int FROM estadistica_forms.worksheet_row_versions WHERE worksheet_id = $1 AND to_sequence IS NOT NULL) AS "closedVersions",
         (SELECT count(*)::int FROM estadistica_forms.operation_receipts WHERE resource_id = $2) AS receipts,
         (SELECT count(*)::int FROM estadistica_forms.audit_events WHERE resource_id = $2) AS events,
         (SELECT status FROM estadistica_forms.worksheet_changesets WHERE id = $2) AS status`,
      [worksheet.id, changesetId],
    );
    return rows[0];
  }

  const insertBoth: Operation[] = [
    { type: 'insert_row', rowId: ROW_A, sortKey: 'a', values: {} },
    { type: 'insert_row', rowId: ROW_B, sortKey: 'b', values: {} },
  ];

  it.each([
    ['la segunda fila', 'worksheet_row_versions', `NEW.row_id = '${ROW_B}'`],
    [
      'el evento de auditoría',
      'audit_events',
      `NEW.action = 'changeset.applied'`,
    ],
    ['el recibo', 'operation_receipts', 'TRUE'],
  ])(
    'T11: si falla %s no queda ni revisión, ni filas, ni recibo, y se puede reintentar',
    async (_label, table, condition) => {
      const changeset = await approvedChangeset(
        insertBoth.map((operation) =>
          operation.type === 'insert_row'
            ? { ...operation, values: { [sku()]: operation.rowId } }
            : operation,
        ),
      );
      const before = await snapshot(changeset.id);
      expect(before).toMatchObject({ revisions: 1, status: 'approved' });

      await failOnInsertInto(table, condition);
      await expect(apply(changeset)).rejects.toThrow('fallo a propósito');
      expect(await snapshot(changeset.id)).toEqual(before);

      await database.connection.pool.query(
        'DROP FUNCTION estadistica_forms.fail_on_purpose() CASCADE',
      );
      const result = await apply(changeset);
      expect(result.sequence).toBe(2);
      expect(await snapshot(changeset.id)).toMatchObject({
        head: result.revisionId,
        revisions: 2,
        rowVersions: 2,
        receipts: 1,
        events: before.events + 1,
        status: 'applied',
      });
    },
  );

  it('editar y borrar cierran la versión vigente de cada fila sin solapar intervalos', async () => {
    await apply(
      await approvedChangeset([
        {
          type: 'insert_row',
          rowId: ROW_A,
          sortKey: 'a',
          values: { [sku()]: 'A' },
        },
        {
          type: 'insert_row',
          rowId: ROW_B,
          sortKey: 'b',
          values: { [sku()]: 'B' },
        },
      ]),
      'primera',
    );
    const second = await apply(
      await approvedChangeset([
        { type: 'set_cell', rowId: ROW_A, columnId: sku(), value: 'A2' },
        { type: 'delete_row', rowId: ROW_B },
      ]),
      'segunda',
    );
    expect(second.sequence).toBe(3);

    const { rows } = await database.connection.pool.query(
      `SELECT row_id AS "rowId", from_sequence AS "from", to_sequence AS "to",
              sort_key AS "sortKey", cell_values AS "values", is_deleted AS "deleted"
       FROM estadistica_forms.worksheet_row_versions
       WHERE worksheet_id = $1 ORDER BY row_id, from_sequence`,
      [worksheet.id],
    );
    expect(rows).toEqual([
      {
        rowId: ROW_A,
        from: 2,
        to: 3,
        sortKey: 'a',
        values: { [sku()]: 'A' },
        deleted: false,
      },
      {
        rowId: ROW_A,
        from: 3,
        to: null,
        sortKey: 'a',
        values: { [sku()]: 'A2' },
        deleted: false,
      },
      {
        rowId: ROW_B,
        from: 2,
        to: 3,
        sortKey: 'b',
        values: { [sku()]: 'B' },
        deleted: false,
      },
      {
        rowId: ROW_B,
        from: 3,
        to: null,
        sortKey: 'b',
        values: {},
        deleted: true,
      },
    ]);
    const { rows: revisions } = await database.connection.pool.query(
      `SELECT sequence, row_count AS "rowCount", source FROM estadistica_forms.worksheet_revisions
       WHERE worksheet_id = $1 ORDER BY sequence`,
      [worksheet.id],
    );
    expect(revisions).toEqual([
      { sequence: 1, rowCount: 0, source: 'initialize' },
      { sequence: 2, rowCount: 2, source: 'changeset' },
      { sequence: 3, rowCount: 1, source: 'changeset' },
    ]);
  });

  it('aplicar recuenta con la hoja bloqueada: pasar de 5.000 filas deshace todo y en 5.000 justas se aplica', async () => {
    const insertRows = (count: number): Operation[] =>
      Array.from({ length: count }, (_, index) => ({
        type: 'insert_row',
        rowId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        sortKey: String(index).padStart(5, '0'),
        values: {},
      }));

    // Aprobado desde el repositorio: no pasa por el aviso de `submit`.
    const tooMany = await approvedChangeset(insertRows(5001));
    const before = await snapshot(tooMany.id);
    await expect(apply(tooMany)).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'WORKSHEET_ROW_LIMIT_EXCEEDED',
      }),
    });
    expect(await snapshot(tooMany.id)).toEqual(before);

    await changesets.cancel(owner.id, scope, tooMany.id);
    const exact = await approvedChangeset(insertRows(5000));
    const result = await apply(exact);
    const head = await changesets.findHead(owner.id, scope, worksheet.id);
    expect(head).toMatchObject({ id: result.revisionId, rowCount: 5000 });
  });

  it('marcar en conflicto solo afecta a un borrador aprobado', async () => {
    const approved = await approvedChangeset([]);
    const head = await changesets.findHead(owner.id, scope, worksheet.id);
    const draft = await changesets.create(owner.id, scope, {
      worksheetId: worksheet.id,
      title: 'Borrador',
      source: 'manual',
      base: head!,
      operations: [],
    });

    await changesets.markConflicted(scope, draft.id, owner.id);
    await changesets.markConflicted(scope, approved.id, owner.id);

    expect((await snapshot(draft.id)).status).toBe('draft');
    expect((await snapshot(approved.id)).status).toBe('conflicted');
    const { rows } = await database.connection.pool.query(
      `SELECT resource_id FROM estadistica_forms.audit_events WHERE action = 'changeset.conflicted'`,
    );
    expect(rows).toEqual([{ resource_id: approved.id }]);
  });

  it('C5: aplicar convierte con la cabecera bloqueada y, si quedara un incompatible, no escribe nada', async () => {
    await apply(
      await approvedChangeset([
        {
          type: 'insert_row',
          rowId: ROW_A,
          sortKey: 'a',
          values: { [sku()]: 'true' },
        },
        {
          type: 'insert_row',
          rowId: ROW_B,
          sortKey: 'b',
          values: { [sku()]: 'quizá' },
        },
      ]),
      'filas',
    );
    const toBoolean: Operation[] = [
      { type: 'change_column_type', columnId: sku(), columnType: 'boolean' },
    ];

    // Aprobado desde el repositorio: no pasa por la revisión de `submit`.
    const blocked = await approvedChangeset(toBoolean);
    const before = await snapshot(blocked.id);
    await expect(apply(blocked, 'bloqueado')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    });
    expect(await snapshot(blocked.id)).toEqual(before);

    await changesets.cancel(owner.id, scope, blocked.id);
    const fixed = await approvedChangeset([
      ...toBoolean,
      { type: 'set_cell', rowId: ROW_B, columnId: sku(), value: false },
    ]);
    const result = await apply(fixed, 'corregido');
    const rows = await changesets.findRowsAt(
      scope,
      worksheet.id,
      result.sequence,
      [ROW_A, ROW_B],
    );
    expect(rows.get(ROW_A)).toEqual({ [sku()]: true });
    expect(rows.get(ROW_B)).toEqual({ [sku()]: false });
  });
});
