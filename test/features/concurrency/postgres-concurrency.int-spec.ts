import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import { HttpException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { contentHash } from '../../../src/changesets/changeset-diff.js';
import type { Operation } from '../../../src/changesets/changeset-operations.js';
import {
  ChangesetsRepository,
  HeadChangedError,
} from '../../../src/changesets/changesets.repository.js';
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
import {
  createPostgresDatabase,
  postgresTestUrl,
} from '../support/postgres-database.js';
import { alice, bob, projectInput } from '../support/project-fixtures.js';
import { newWorksheet } from '../worksheets/support/new-worksheet-fixture.js';

/**
 * Cuántas veces se repite cada carrera: con dos conexiones de verdad, las
 * transacciones no siempre se solapan a la primera.
 */
const ROUNDS = 10;
const PAYLOAD_HASH = 'a'.repeat(64);

const adminUrl = postgresTestUrl();
// Sin `TEST_POSTGRES_URL` (la batería normal, en PGlite) se salta: PGlite
// ejecuta una transacción cada vez y aquí no habría nada compitiendo.
const describeWithPostgres = adminUrl ? describe : describe.skip;

describeWithPostgres(
  'Concurrencia con PostgreSQL real y varias conexiones (C3 del plan de cierre; T03, T07, T09)',
  () => {
    let database: Awaited<ReturnType<typeof createPostgresDatabase>>;
    let prisma: PrismaService;
    let changesets: ChangesetsRepository;
    let organizations: OrganizationsRepository;
    let owner: LocalUser;
    let manager: LocalUser;
    let scope: ProjectScope;
    let worksheet: Worksheet;

    beforeAll(async () => {
      if (!adminUrl) throw new Error('Sin TEST_POSTGRES_URL');
      database = await createPostgresDatabase(adminUrl);
      prisma = new PrismaService(database.connection);
      await prisma.onModuleInit();
      changesets = new ChangesetsRepository(prisma);
      organizations = new OrganizationsRepository(prisma);
    });
    beforeEach(async () => {
      await pool().query('TRUNCATE estadistica_forms.app_users CASCADE');
      const users = new UsersRepository(prisma);
      owner = await users.provision(alice);
      manager = await users.provision(bob);
      const project = await new ProjectsRepository(prisma).create(
        owner.id,
        'Tienda',
        projectInput,
      );
      const [organization] = await organizations.findMemberships(owner.id, {
        limit: 1,
        offset: 0,
      });
      scope = { organizationId: organization.id, projectId: project.id };

      const worksheets = new WorksheetsRepository(prisma);
      const workbook = await worksheets.createWorkbook(
        owner.id,
        scope,
        'Libro',
      );
      ({ worksheet } = await worksheets.createWorksheet(
        owner.id,
        scope,
        workbook.id,
        newWorksheet('Inventario', [
          { name: 'SKU', type: 'text' as const, required: false },
        ]),
      ));
    });
    afterAll(async () => {
      try {
        await prisma?.onModuleDestroy();
      } finally {
        await database?.close();
      }
    });

    const pool = () => database.connection.pool;

    function insertRow(sku: string): Operation[] {
      return [
        {
          type: 'insert_row',
          rowId: randomUUID(),
          sortKey: sku,
          values: { [worksheet.columns[0].id]: sku },
        },
      ];
    }

    async function draft(operations: Operation[] = []) {
      const head = await changesets.findHead(owner.id, scope, worksheet.id);
      if (!head) throw new Error('La hoja de prueba no tiene head');
      return changesets.create(owner.id, scope, {
        worksheetId: worksheet.id,
        title: 'Cambio',
        source: 'manual',
        base: head,
        operations,
      });
    }

    /** Enviado y aprobado por Alice mientras es la única de la empresa. */
    async function approved(operations: Operation[]) {
      const created = await draft(operations);
      const hash = contentHash({
        worksheetId: worksheet.id,
        baseRevisionId: created.baseRevisionId,
        baseSchemaVersion: created.baseSchemaVersion,
        operations,
      });
      await changesets.submit(owner.id, scope, created.id, 1, hash);
      const { changeset } = await changesets.decide(
        owner.id,
        scope,
        created.id,
        {
          decision: 'accept',
          contentHash: hash,
          draftVersion: 1,
          expectedHeadRevisionId: created.baseRevisionId,
          reason: null,
        },
      );
      return changeset;
    }

    function apply(changeset: Changeset, key: string, actorId = owner.id) {
      return changesets.apply(actorId, scope, changeset.id, {
        idempotencyKey: key,
        payloadHash: PAYLOAD_HASH,
        contentHash: changeset.contentHash ?? '',
        expectedHeadRevisionId: changeset.baseRevisionId,
      });
    }

    async function setManagerRole(role: 'manager' | null) {
      await pool().query(
        `DELETE FROM estadistica_forms.organization_members
         WHERE organization_id = $1 AND user_id = $2`,
        [scope.organizationId, manager.id],
      );
      if (role) {
        await pool().query(
          `INSERT INTO estadistica_forms.organization_members
             (organization_id, user_id, role, created_at)
           VALUES ($1, $2, $3, '2026-11-08T12:00:00.000Z')`,
          [scope.organizationId, manager.id, role],
        );
      }
    }

    async function revisionCount() {
      const { rows } = await pool().query(
        `SELECT count(*)::int AS n FROM estadistica_forms.worksheet_revisions
         WHERE worksheet_id = $1`,
        [worksheet.id],
      );
      return rows[0].n as number;
    }

    it('T07: dos guardados con la misma draftVersion: uno gana y el otro recibe CHANGESET_VERSION_MISMATCH', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const created = await draft();
        const [one, two] = [insertRow(`A${round}`), insertRow(`B${round}`)];

        const results = await Promise.allSettled([
          changesets.saveOperations(owner.id, scope, created.id, 1, one),
          changesets.saveOperations(owner.id, scope, created.id, 1, two),
        ]);

        const won = results.filter(isFulfilled);
        const lost = results.filter(isRejected);
        expect(won).toHaveLength(1);
        expect(lost.map(({ reason }) => errorCodeOf(reason))).toEqual([
          'CHANGESET_VERSION_MISMATCH',
        ]);
        const stored = await changesets.findChangeset(
          owner.id,
          scope,
          created.id,
        );
        expect(stored?.draftVersion).toBe(2);
        expect(stored?.operations).toEqual(won[0].value.operations);
      }
    });

    it('T09: dos apply de borradores distintos sobre la misma base: uno aplica y el otro conserva su diff', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const before = await revisionCount();
        const first = await approved(insertRow(`A${round}`));
        const second = await approved(insertRow(`B${round}`));

        const results = await Promise.allSettled([
          apply(first, `a-${round}`),
          apply(second, `b-${round}`),
        ]);

        expect(results.filter(isFulfilled)).toHaveLength(1);
        const lost = results.filter(isRejected);
        expect(lost).toHaveLength(1);
        expect(lost[0].reason).toBeInstanceOf(HeadChangedError);
        expect(await revisionCount()).toBe(before + 1);

        const loser = results[0].status === 'rejected' ? first : second;
        const kept = await changesets.findChangeset(owner.id, scope, loser.id);
        expect(kept).toMatchObject({
          status: 'approved',
          operations: loser.operations,
        });
      }
    });

    it('el mismo apply dos veces a la vez con la misma clave: una revisión y el mismo resultado', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const before = await revisionCount();
        const changeset = await approved(insertRow(`A${round}`));

        const [one, two] = await Promise.all([
          apply(changeset, `misma-${round}`),
          apply(changeset, `misma-${round}`),
        ]);

        expect(two).toEqual(one);
        expect(await revisionCount()).toBe(before + 1);
      }
    });

    it('T03: quitar el permiso a quien aplica mientras aplica: manda la transacción que gana', async () => {
      // Cualquiera de los dos órdenes es válido; cada ronda tiene que ser uno de ellos.
      for (let round = 0; round < ROUNDS; round++) {
        await setManagerRole(null);
        const changeset = await approved(insertRow(`A${round}`));
        await setManagerRole('manager');
        const before = await revisionCount();

        const [applied, demoted] = await Promise.allSettled([
          apply(changeset, `t03-${round}`, manager.id),
          organizations.changeRole(
            owner.id,
            scope.organizationId,
            manager.id,
            'viewer',
          ),
        ]);

        expect(demoted.status).toBe('fulfilled');
        if (applied.status === 'fulfilled') {
          // Aplicó antes de perder el permiso: la revisión existe.
          expect(await revisionCount()).toBe(before + 1);
        } else {
          // Perdió el permiso antes: nada escrito y el borrador sigue aprobado.
          expect(errorCodeOf(applied.reason)).toBe('FORBIDDEN');
          expect(await revisionCount()).toBe(before);
          const kept = await changesets.findChangeset(
            owner.id,
            scope,
            changeset.id,
          );
          expect(kept?.status).toBe('approved');
        }
      }
    });

    it('doble clic de C2: dos POST /projects a la vez con la misma clave crean un solo proyecto', async () => {
      const projects = new ProjectsRepository(prisma);
      for (let round = 0; round < ROUNDS; round++) {
        const idempotency = { key: `clic-${round}`, payloadHash: PAYLOAD_HASH };

        const [one, two] = await Promise.all([
          projects.create(owner.id, 'Doble', projectInput, idempotency),
          projects.create(owner.id, 'Doble', projectInput, idempotency),
        ]);

        expect(two.id).toBe(one.id);
      }
      const { rows } = await pool().query(
        `SELECT count(*)::int AS n FROM estadistica_forms.projects
         WHERE name = 'Doble'`,
      );
      expect(rows[0].n).toBe(ROUNDS);
    });
  },
);

function isFulfilled<T>(
  result: PromiseSettledResult<T>,
): result is PromiseFulfilledResult<T> {
  return result.status === 'fulfilled';
}

function isRejected<T>(
  result: PromiseSettledResult<T>,
): result is PromiseRejectedResult {
  return result.status === 'rejected';
}

/** El código público de un error de la API, o `null` si no es uno. */
function errorCodeOf(reason: unknown): string | null {
  if (!(reason instanceof HttpException)) {
    return null;
  }
  const body = reason.getResponse();
  if (typeof body === 'object' && body !== null && 'code' in body) {
    return typeof body.code === 'string' ? body.code : null;
  }
  return null;
}
