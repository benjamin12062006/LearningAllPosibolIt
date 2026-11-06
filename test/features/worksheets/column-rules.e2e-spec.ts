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
import { DescopeService } from '../../../src/auth/descope.service.js';
import { configureHttp } from '../../../src/configure-http.js';
import { publicError } from '../../../src/common/http/public-error.js';
import { POSTGRESQL_CONNECTION } from '../../../src/database/postgresql.connection.js';
import { OrganizationsRepository } from '../../../src/organizations/organizations.repository.js';
import { ProjectsModule } from '../../../src/projects/projects.module.js';
import { ProjectsRepository } from '../../../src/projects/projects.repository.js';
import { UsersService } from '../../../src/users/users.service.js';
import { WorksheetsModule } from '../../../src/worksheets/worksheets.module.js';
import type { Worksheet } from '../../../src/worksheets/worksheets.types.js';
import { alice, projectInput } from '../support/project-fixtures.js';
import { createTestDatabase } from '../support/test-database.js';

const ROW_A = '00000000-0000-4000-8000-00000000aa01';
const ROW_B = '00000000-0000-4000-8000-00000000bb01';

/** Columnas con selección y calculadas; la fórmula nombra columnas por nombre. */
const COLUMNS = [
  { name: 'Costo', type: 'decimal' },
  { name: 'Precio', type: 'decimal' },
  {
    name: 'Estado',
    type: 'selection',
    options: [{ label: 'Nuevo' }, { label: 'Usado' }],
  },
  {
    name: 'Margen',
    type: 'calculated',
    formula: {
      expression: {
        op: 'div',
        args: [
          { op: 'sub', args: [{ column: 'Precio' }, { column: 'Costo' }] },
          { column: 'Precio' },
        ],
      },
      scale: 2,
      rounding: 'half_up',
    },
  },
];

describe('Columnas de selección y calculadas por HTTP', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: INestApplication;
  let base: string;
  let organizationId: string;
  let workbookId: string;
  const validateSession = jest.fn<DescopeService['validateSession']>();

  beforeAll(async () => {
    database = await createTestDatabase();
    const module = await Test.createTestingModule({
      imports: [ProjectsModule, WorksheetsModule],
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
    validateSession.mockReset().mockResolvedValue({
      jwt: 'alice-session',
      token: { sub: alice.subject, iss: alice.issuer, email: alice.email },
    });
    await database.connection.pool.query(
      'TRUNCATE estadistica_forms.app_users CASCADE',
    );
    const ownerId = (await app.get(UsersService).provision(alice)).id;
    const project = await app
      .get(ProjectsRepository)
      .create(ownerId, 'Tienda', projectInput);
    const [organization] = await app
      .get(OrganizationsRepository)
      .findMemberships(ownerId, { limit: 1, offset: 0 });
    organizationId = organization.id;
    base = `/api/v1/organizations/${organizationId}/projects/${project.id}`;
    const { body } = await post('/workbooks', { name: 'Libro' }).expect(201);
    workbookId = body.workbook.id;
  });
  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await database?.close();
    }
  });

  function post(path: string, body: object) {
    return request(app.getHttpServer())
      .post(`${base}${path}`)
      .auth('alice-session', { type: 'bearer' })
      .send(body);
  }

  async function createWorksheet(): Promise<Worksheet> {
    const { body } = await post(`/workbooks/${workbookId}/worksheets`, {
      name: 'Precios',
      columns: COLUMNS,
    }).expect(201);
    return body.worksheet;
  }

  /** Dos filas en la revisión inicial: una con margen y otra con precio cero. */
  async function seedRows(worksheet: Worksheet, usedOption: string) {
    const [cost, price, status] = worksheet.columns.map(({ id }) => id);
    for (const [rowId, sortKey, values] of [
      [ROW_A, 'a', { [cost]: '12.10', [price]: '19.99', [status]: usedOption }],
      [ROW_B, 'b', { [cost]: '5', [price]: '0' }],
    ] as const) {
      await database.connection.pool.query(
        `INSERT INTO estadistica_forms.worksheet_row_versions
           (organization_id, worksheet_id, row_id, from_sequence, sort_key, cell_values)
         VALUES ($1, $2, $3, 1, $4, $5)`,
        [organizationId, worksheet.id, rowId, sortKey, JSON.stringify(values)],
      );
    }
  }

  it('crea la hoja: opciones con ID y fórmula guardada con IDs de columna', async () => {
    const worksheet = await createWorksheet();
    const [cost, price, status, margin] = worksheet.columns;

    expect(cost).not.toHaveProperty('options');
    expect(status.options).toEqual([
      { id: expect.any(String), label: 'Nuevo' },
      { id: expect.any(String), label: 'Usado' },
    ]);
    expect(margin).toMatchObject({ type: 'calculated', required: false });
    expect(margin.formula).toEqual({
      engine: 'calc-v1',
      expression: {
        op: 'div',
        args: [
          { op: 'sub', args: [{ column: price.id }, { column: cost.id }] },
          { column: price.id },
        ],
      },
      scale: 2,
      rounding: 'half_up',
    });
  });

  it('rechaza una fórmula con una columna inexistente o un ciclo, con el campo exacto', async () => {
    const path = `/workbooks/${workbookId}/worksheets`;
    await post(path, {
      name: 'Rota',
      columns: [
        { name: 'Precio', type: 'decimal' },
        {
          name: 'Total',
          type: 'calculated',
          formula: {
            expression: { column: 'Cantidad' },
            scale: 2,
            rounding: 'half_up',
          },
        },
      ],
    })
      .expect(400)
      .expect(({ body }) =>
        expect(body.issues).toEqual([
          expect.objectContaining({
            field: 'columns.1.formula.expression.column',
            code: 'COLUMN_FORMULA_REFERENCE_INVALID',
          }),
        ]),
      );
    await post(path, {
      name: 'Circular',
      columns: [
        {
          name: 'A',
          type: 'calculated',
          formula: {
            expression: { column: 'A' },
            scale: 0,
            rounding: 'half_even',
          },
        },
      ],
    })
      .expect(400)
      .expect(({ body }) =>
        expect(body.issues).toEqual([
          expect.objectContaining({
            field: 'columns.0.formula',
            code: 'COLUMN_FORMULA_CYCLE',
          }),
        ]),
      );
  });

  it('al leer filas calcula el margen y explica la división entre cero', async () => {
    const worksheet = await createWorksheet();
    const usedOption = worksheet.columns[2].options![1].id;
    await seedRows(worksheet, usedOption);
    const margin = worksheet.columns[3].id;

    const { body } = await post(
      `/worksheets/${worksheet.id}/rows/query`,
      {},
    ).expect(200);

    expect(
      body.items.map(
        ({ values }: { values: Record<string, unknown> }) => values[margin],
      ),
    ).toEqual(['0.39', null]);
    expect(body.items[0].problems).toEqual([]);
    expect(body.items[1].problems).toEqual([
      { columnId: margin, ...publicError('CALC_DIVISION_BY_ZERO') },
    ]);
  });

  it('filtra por opción y no deja filtrar ni ordenar por una calculada', async () => {
    const worksheet = await createWorksheet();
    const [, , status, margin] = worksheet.columns;
    await seedRows(worksheet, status.options![1].id);
    const path = `/worksheets/${worksheet.id}/rows/query`;

    await post(path, {
      filter: { column: status.id, op: 'equals', value: status.options![1].id },
    })
      .expect(200)
      .expect(({ body }) =>
        expect(body.items.map(({ rowId }: { rowId: string }) => rowId)).toEqual(
          [ROW_A],
        ),
      );
    for (const [body, field, code] of [
      [
        { filter: { column: status.id, op: 'equals', value: 'Usado' } },
        'filter.value',
        'ROW_FILTER_VALUE_INVALID',
      ],
      [
        { filter: { column: margin.id, op: 'gt', value: '0' } },
        'filter.op',
        'ROW_FILTER_OPERATOR_INVALID',
      ],
      [
        { sort: [{ columnId: margin.id, direction: 'desc' }] },
        'sort.0.columnId',
        'ROW_SORT_UNSUPPORTED',
      ],
    ] as const) {
      await post(path, body)
        .expect(400)
        .expect(({ body: error }) =>
          expect(error.issues).toEqual([
            expect.objectContaining({ field, code }),
          ]),
        );
    }
  });
});
