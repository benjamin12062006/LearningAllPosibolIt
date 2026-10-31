import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

const url = new URL(process.env.DATABASE_URL ?? '');
if (
  url.protocol !== 'postgresql:' ||
  url.hostname !== '127.0.0.1' ||
  url.searchParams.get('schema') !== 'estadistica_forms'
) {
  throw new Error(
    'Las migraciones de tests requieren PostgreSQL temporal local.',
  );
}

export default defineConfig({
  schema: resolve('prisma/schema.prisma'),
  migrations: { path: resolve('prisma/migrations') },
  datasource: { url: url.toString() },
});
