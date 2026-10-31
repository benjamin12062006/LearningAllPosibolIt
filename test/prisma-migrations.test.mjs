import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUsersTestContext } from './support/users-test-context.mjs';

test('Prisma despliega las migraciones PostgreSQL y no las repite', async () => {
  const context = await createUsersTestContext();
  try {
    await context.migrate();
    const migrations = await context.prisma.$queryRaw`
      SELECT migration_name, finished_at, rolled_back_at
      FROM estadistica_forms._prisma_migrations
      ORDER BY migration_name
    `;

    assert.deepEqual(
      migrations.map((migration) => migration.migration_name),
      [
        '20261022000100_create_app_users',
        '20261022000200_create_statistical_spaces',
        '20261022000300_index_statistical_spaces_owner',
        '20261025000100_configure_projects',
        '20261026000100_create_catalog_import',
        '20261030000100_index_catalog_snapshots_project',
      ],
    );
    assert.ok(migrations.every((migration) => migration.finished_at));
    assert.ok(
      migrations.every((migration) => migration.rolled_back_at === null),
    );

    const tables = await context.prisma.$queryRaw`
      SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = 'estadistica_forms'
      ORDER BY table_name
    `;
    assert.ok(tables.some((table) => table.name === 'app_users'));
    assert.ok(tables.some((table) => table.name === 'projects'));
    assert.ok(!tables.some((table) => table.name === 'statistical_spaces'));
  } finally {
    await context.close();
  }
});
