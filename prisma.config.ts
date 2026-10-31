import { loadEnvFile } from 'node:process';
import { defineConfig } from 'prisma/config';

try {
  loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

// Prisma Migrate necesita la conexión directa de Neon: el pooler (-pooler)
// no soporta los bloqueos de sesión que usa para migrar.
function migrationUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('DATABASE_URL no es una URL válida.');
  }
  if (!['postgresql:', 'postgres:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL debe ser una URL PostgreSQL.');
  }
  parsed.hostname = parsed.hostname.replace(/-pooler(?=\.)/, '');
  parsed.searchParams.set('schema', 'estadistica_forms');
  return parsed.toString();
}

const databaseUrl = process.env.DATABASE_URL?.trim();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  ...(databaseUrl ? { datasource: { url: migrationUrl(databaseUrl) } } : {}),
});
