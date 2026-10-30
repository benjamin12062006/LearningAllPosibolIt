import { loadEnvFile } from 'node:process';
import { defineConfig } from 'prisma/config';

try {
  loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

const databaseUrl = process.env.POSTGRES_MIGRATION_DATABASE_URL?.trim();
if (databaseUrl) {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('POSTGRES_MIGRATION_DATABASE_URL no es una URL válida.');
  }
  if (
    !['postgresql:', 'postgres:'].includes(parsed.protocol) ||
    parsed.searchParams.get('schema') !== 'estadistica_forms'
  ) {
    throw new Error(
      'POSTGRES_MIGRATION_DATABASE_URL debe ser PostgreSQL con schema=estadistica_forms.',
    );
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
