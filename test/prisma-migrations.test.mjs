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
        '20261030000200_cascade_catalog_import_children',
        '20261101000100_create_ruleset_versions',
        '20261101000200_create_evaluations',
        '20261101000300_create_exports',
        '20261102000100_create_feeds',
        '20261102000200_add_feed_source',
        '20261102000300_create_feed_refreshes',
        '20261103000100_create_organizations',
        '20261103000200_create_organization_invitations',
        '20261103000300_add_feed_policy',
        '20261103000400_add_feed_schedule',
        '20261103090000_add_organization_archived_at',
        '20261103100000_create_worksheets',
        '20261104090000_create_worksheet_row_versions',
        '20261104100000_add_worksheet_column_rules',
        '20261105000100_add_import_job_lease',
        '20261105000200_add_evaluation_lease',
        '20261105000300_create_outbox_events',
        '20261105100000_create_worksheet_changesets',
        '20261106100000_create_worksheet_imports',
        '20261107100000_allow_xlsx_worksheet_imports',
        '20261107110000_create_worksheet_exports',
        '20261107120000_create_worksheet_catalog_snapshots',
        '20261108100000_require_project_organization',
        '20261109100000_create_knowledge_sync_state',
        '20261113100000_archive_and_duplicate_worksheets',
        '20261114100000_create_worksheet_import_mappings',
        '20261114110000_create_worksheet_saved_views',
        '20261114120000_open_catalog_as_worksheet',
        '20261114130000_create_ai_conversations',
        '20261114140000_create_worksheet_transform_previews',
        '20261114150000_create_ai_runs',
        '20261114160000_create_ai_run_events',
        '20261114170000_create_integration_credentials',
        '20261114230000_add_mcp_oauth_grants',
        '20261115100000_add_project_conversations',
        '20261121120000_add_ai_proposal_failure',
        '20261121130000_add_cli_oauth_grants',
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
