import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { createTestDatabase } from '../support/test-database.js';

/**
 * Ensayo de la migración de organizaciones sobre datos heredados (T01). Se
 * aplican a mano, en orden, los SQL de todas las migraciones anteriores; se
 * insertan usuarios y proyectos como los dejó la fase de feeds; y solo
 * después se aplica la migración nueva. Así el backfill corre sobre filas que
 * ya existían, como ocurrirá en Neon.
 */
const MIGRATIONS = resolve('prisma/migrations');
const ORGANIZATIONS_MIGRATION = '20261103000100_create_organizations';
const BACKFILL_MARKER = '-- Backfill';

const users = {
  alice: '00000000-0000-4000-8000-0000000000a1',
  bob: '00000000-0000-4000-8000-0000000000b1',
  carol: '00000000-0000-4000-8000-0000000000c1',
};
const projects = {
  aliceFirst: '00000000-0000-4000-8000-0000000000a2',
  aliceSecond: '00000000-0000-4000-8000-0000000000a3',
  bob: '00000000-0000-4000-8000-0000000000b2',
};

describe('Migración de organizaciones sobre datos heredados', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let pool: Pool;
  let migrationSql: string;

  beforeAll(async () => {
    database = await createTestDatabase({ migrate: false });
    pool = database.connection.pool;
    await pool.query('CREATE SCHEMA IF NOT EXISTS estadistica_forms');
    for (const name of await migrationsBefore(ORGANIZATIONS_MIGRATION)) {
      await pool.query(await readMigration(name));
    }
    await insertLegacyData(pool);

    migrationSql = await readMigration(ORGANIZATIONS_MIGRATION);
    await pool.query(migrationSql);
  });
  afterAll(async () => {
    await database?.close();
  });

  it('conserva usuarios, IDs y propietarios de los proyectos', async () => {
    const { rows } = await pool.query<{ id: string; owner_id: string }>(
      'SELECT id, owner_id FROM estadistica_forms.projects ORDER BY id',
    );

    expect(rows).toEqual([
      { id: projects.aliceFirst, owner_id: users.alice },
      { id: projects.aliceSecond, owner_id: users.alice },
      { id: projects.bob, owner_id: users.bob },
    ]);
    expect(await count(pool, 'app_users')).toBe(3);
  });

  it('crea una organización personal con su owner por cada propietario con proyectos', async () => {
    const { rows } = await pool.query<{
      personal_owner_id: string;
      name: string;
      user_id: string;
      role: string;
    }>(`
      SELECT o.personal_owner_id, o.name, m.user_id, m.role
      FROM estadistica_forms.organizations o
      JOIN estadistica_forms.organization_members m ON m.organization_id = o.id
      ORDER BY o.personal_owner_id
    `);

    expect(rows).toEqual([
      {
        personal_owner_id: users.alice,
        name: 'Personal',
        user_id: users.alice,
        role: 'owner',
      },
      {
        personal_owner_id: users.bob,
        name: 'Personal',
        user_id: users.bob,
        role: 'owner',
      },
    ]);
  });

  it('asigna cada proyecto a la organización personal de su propietario', async () => {
    const { rows } = await pool.query<{ unassigned: number }>(`
      SELECT count(*)::int AS unassigned
      FROM estadistica_forms.projects p
      LEFT JOIN estadistica_forms.organizations o
        ON o.id = p.organization_id AND o.personal_owner_id = p.owner_id
      WHERE o.id IS NULL
    `);

    expect(rows[0].unassigned).toBe(0);
  });

  it('el backfill es repetible y completa un proyecto creado después por un binario antiguo', async () => {
    const lateProject = '00000000-0000-4000-8000-0000000000b3';
    await pool.query(
      `INSERT INTO estadistica_forms.projects (id, name, owner_id, created_at)
       VALUES ($1, 'Tardío', $2, '2026-11-02T12:00:00.000Z')`,
      [lateProject, users.bob],
    );

    const backfill = migrationSql.slice(migrationSql.indexOf(BACKFILL_MARKER));
    await pool.query(backfill);
    await pool.query(backfill);

    expect(await count(pool, 'organizations')).toBe(2);
    expect(await count(pool, 'organization_members')).toBe(2);
    const { rows } = await pool.query<{ same: boolean }>(
      `SELECT late.organization_id = bob.organization_id AS same
       FROM estadistica_forms.projects late, estadistica_forms.projects bob
       WHERE late.id = $1 AND bob.id = $2`,
      [lateProject, projects.bob],
    );
    expect(rows[0].same).toBe(true);
  });

  it('rechaza roles desconocidos y una segunda organización personal', async () => {
    const { rows } = await pool.query<{ id: string }>(
      'SELECT id FROM estadistica_forms.organizations WHERE personal_owner_id = $1',
      [users.alice],
    );

    await expect(
      pool.query(
        `INSERT INTO estadistica_forms.organization_members
           (organization_id, user_id, role, created_at)
         VALUES ($1, $2, 'superuser', '2026-11-02')`,
        [rows[0].id, users.carol],
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      pool.query(
        `INSERT INTO estadistica_forms.organizations
           (id, name, personal_owner_id, created_at)
         VALUES (gen_random_uuid()::text, 'Otra', $1, '2026-11-02')`,
        [users.alice],
      ),
    ).rejects.toThrow(/duplicate key/);
  });
});

async function migrationsBefore(target: string) {
  const entries = await readdir(MIGRATIONS, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name < target)
    .map((entry) => entry.name)
    .sort();
}

function readMigration(name: string) {
  return readFile(resolve(MIGRATIONS, name, 'migration.sql'), 'utf8');
}

/** Carol no tiene proyectos: no recibe organización en el backfill. */
async function insertLegacyData(pool: Pool) {
  for (const [name, id] of Object.entries(users)) {
    await pool.query(
      `INSERT INTO estadistica_forms.app_users
         (id, identity_issuer, identity_subject, created_at, updated_at)
       VALUES ($1, 'https://identity.example.test', $2, '2026-10-25', '2026-10-25')`,
      [id, name],
    );
  }
  for (const [id, owner] of [
    [projects.aliceFirst, users.alice],
    [projects.aliceSecond, users.alice],
    [projects.bob, users.bob],
  ]) {
    await pool.query(
      `INSERT INTO estadistica_forms.projects
         (id, name, owner_id, created_at, country, currency, channel_profile)
       VALUES ($1, 'Heredado', $2, '2026-10-26', 'US', 'USD', 'google_merchant')`,
      [id, owner],
    );
  }
}

async function count(pool: Pool, table: string) {
  const { rows } = await pool.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM estadistica_forms.${table}`,
  );
  return rows[0].total;
}
