import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import { PrismaService } from '../../../src/database/prisma.service.js';
import { OrganizationsRepository } from '../../../src/organizations/organizations.repository.js';
import { ProjectsRepository } from '../../../src/projects/projects.repository.js';
import {
  UsersRepository,
  type LocalUser,
} from '../../../src/users/users.repository.js';
import { newWorksheet } from './support/new-worksheet-fixture.js';
import {
  parseRowQuery,
  type RowQueryInput,
} from '../../../src/worksheets/row-query.js';
import { orderSql, whereSql } from '../../../src/worksheets/row-query-sql.js';
import {
  WorksheetRowsRepository,
  type ReadableRevision,
} from '../../../src/worksheets/worksheet-rows.repository.js';
import { WorksheetsRepository } from '../../../src/worksheets/worksheets.repository.js';
import type {
  ProjectScope,
  Worksheet,
} from '../../../src/worksheets/worksheets.types.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';
import {
  columnIdsOf,
  FIXTURE_COLUMNS,
  ROW_IDS,
  SECOND_REVISION_ID,
  seedTwoRevisions,
  type FixtureColumnIds,
} from './support/row-fixtures.js';

const { a, b, c: rowC, d, e } = ROW_IDS;

describe('Filas de una revisión con filtros y orden, en PostgreSQL temporal', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let prisma: PrismaService;
  let rows: WorksheetRowsRepository;
  let owner: LocalUser;
  let other: LocalUser;
  let scope: ProjectScope;
  let worksheet: Worksheet;
  let col: FixtureColumnIds;
  let first: ReadableRevision;
  let head: ReadableRevision;

  beforeAll(async () => {
    database = await createTestDatabase();
    prisma = new PrismaService(database.connection);
    await prisma.onModuleInit();
    rows = new WorksheetRowsRepository(prisma);
  });
  beforeEach(async () => {
    await database.connection.pool.query(
      'TRUNCATE estadistica_forms.app_users CASCADE',
    );
    const users = new UsersRepository(prisma);
    owner = await users.provision(alice);
    other = await users.provision(bob);

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
      newWorksheet(
        'Inventario',
        FIXTURE_COLUMNS.map((column) => ({ ...column, required: false })),
      ),
    ));
    col = columnIdsOf(worksheet);
    await seedTwoRevisions(
      database.connection.pool,
      worksheet,
      scope.organizationId,
      owner.id,
    );
    first = (await rows.findRevision(
      owner.id,
      scope,
      worksheet.id,
      worksheet.headRevision.id,
    ))!;
    head = (await rows.findRevision(owner.id, scope, worksheet.id, null))!;
  });
  afterAll(async () => {
    try {
      await prisma?.onModuleDestroy();
    } finally {
      await database?.close();
    }
  });

  /** Ids de las filas que devuelve la consulta en la revisión dada. */
  async function idsAt(revision: ReadableRevision, input: RowQueryInput = {}) {
    const result = parseRowQuery(input, worksheet.columns);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const found = await rows.findRows({
      scope,
      worksheetId: worksheet.id,
      sequence: revision.sequence,
      where: whereSql(result.query.filter),
      order: orderSql(result.query.sort),
      page: { limit: 100, offset: 0 },
    });
    return found.map(({ rowId }) => rowId);
  }

  it('cada revisión devuelve sus filas: la antigua no ve los cambios de la nueva', async () => {
    expect(head.id).toBe(SECOND_REVISION_ID);
    expect(await idsAt(first)).toEqual([a, b, rowC, d]);
    expect(await idsAt(head)).toEqual([a, b, d, e]);

    const price = { filter: { column: col.price, op: 'equals', value: '12' } };
    expect(await idsAt(first, price)).toEqual([]);
    expect(await idsAt(head, price)).toEqual([b]);
  });

  it('compara decimales como números y un dato mal guardado cuenta como null', async () => {
    expect(
      await idsAt(first, {
        filter: { column: col.price, op: 'gt', value: '10' },
      }),
    ).toEqual([a, rowC]);
    expect(
      await idsAt(first, {
        filter: { column: col.price, op: 'equals', value: '10.5' },
      }),
    ).toEqual([a]);
    expect(
      await idsAt(first, { filter: { column: col.price, op: 'is_null' } }),
    ).toEqual([d]);
  });

  it('vacío no es null y `not_equals` no incluye los nulos', async () => {
    expect(
      await idsAt(first, {
        filter: { column: col.sku, op: 'equals', value: '' },
      }),
    ).toEqual([rowC]);
    expect(
      await idsAt(first, { filter: { column: col.sku, op: 'is_null' } }),
    ).toEqual([]);
    expect(
      await idsAt(first, { filter: { column: col.quantity, op: 'is_null' } }),
    ).toEqual([b]);
    expect(
      await idsAt(first, {
        filter: { column: col.active, op: 'not_equals', value: true },
      }),
    ).toEqual([b]);
  });

  it('`contains` no distingue mayúsculas y trata `%` y `_` como texto', async () => {
    expect(
      await idsAt(first, {
        filter: { column: col.sku, op: 'contains', value: 'a-0' },
      }),
    ).toEqual([a]);
    expect(
      await idsAt(first, {
        filter: { column: col.sku, op: 'contains', value: '%_' },
      }),
    ).toEqual([d]);
    expect(
      await idsAt(first, {
        filter: { column: col.sku, op: 'contains', value: '_' },
      }),
    ).toEqual([d]);
  });

  it('fechas, `in` y grupos anidados', async () => {
    expect(
      await idsAt(first, {
        filter: { column: col.since, op: 'lt', value: '2026-02-01' },
      }),
    ).toEqual([a]);
    expect(
      await idsAt(head, {
        filter: { column: col.sku, op: 'in', value: ['A-001', 'E-005'] },
      }),
    ).toEqual([a, e]);
    expect(
      await idsAt(first, {
        filter: {
          or: [
            { column: col.active, op: 'equals', value: true },
            {
              and: [
                { column: col.quantity, op: 'gte', value: '5' },
                { column: col.sku, op: 'contains', value: 'off' },
              ],
            },
          ],
        },
      }),
    ).toEqual([a, d]);
  });

  it('ordenar deja los nulos al final, desempata por el orden de la hoja y no cambia ningún ID', async () => {
    const byPriceDesc = await idsAt(first, {
      sort: [{ columnId: col.price, direction: 'desc' }],
    });
    const byPriceAsc = await idsAt(first, {
      sort: [{ columnId: col.price, direction: 'asc' }],
    });

    expect(byPriceDesc).toEqual([rowC, a, b, d]);
    expect(byPriceAsc).toEqual([b, a, rowC, d]);
    expect([...byPriceDesc].sort()).toEqual([...(await idsAt(first))].sort());
  });

  it('otra organización no encuentra la revisión aunque conozca los IDs', async () => {
    expect(
      await rows.findRevision(other.id, scope, worksheet.id, null),
    ).toBeNull();
    expect(
      await rows.findRevision(
        owner.id,
        scope,
        worksheet.id,
        '00000000-0000-4000-8000-00000000beef',
      ),
    ).toBeNull();
  });
});
