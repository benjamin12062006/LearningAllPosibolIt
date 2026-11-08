import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { Client, Pool } from 'pg';
import type { PostgreSqlConnection } from '../../../src/database/postgresql.connection.js';

const execFileAsync = promisify(execFile);

/**
 * La URL del PostgreSQL real de pruebas (C3 del plan de cierre). Solo la pone
 * `pnpm test:features:postgres`; sin ella, las pruebas que la necesitan se
 * saltan y la batería normal sigue en PGlite.
 */
export function postgresTestUrl(): URL | null {
  const raw = process.env.TEST_POSTGRES_URL;
  if (!raw) {
    return null;
  }
  const url = new URL(raw);
  // Nunca una base de verdad: solo el contenedor local.
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1') {
    throw new Error('TEST_POSTGRES_URL debe ser un PostgreSQL de 127.0.0.1.');
  }
  return url;
}

/**
 * Una base nueva dentro del contenedor, con las migraciones aplicadas, para
 * una sola suite. `close` cierra las conexiones y la borra. El pool tiene
 * varias conexiones de verdad: dos transacciones pueden competir.
 */
export async function createPostgresDatabase(adminUrl: URL) {
  const name = `estadistica_test_${randomUUID().replaceAll('-', '')}`;
  await runAsAdmin(adminUrl, `CREATE DATABASE ${name}`);

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  url.searchParams.set('schema', 'estadistica_forms');
  url.searchParams.set('sslmode', 'disable');

  let pool: Pool | undefined;
  // Prisma y `close` cierran el mismo pool: `pg` no admite cerrarlo dos veces.
  let poolClosing: Promise<void> | undefined;
  const endPool = (open: Pool) => (poolClosing ??= open.end());
  async function close() {
    try {
      if (pool) await endPool(pool);
    } finally {
      await runAsAdmin(adminUrl, `DROP DATABASE IF EXISTS ${name}`);
    }
  }

  try {
    await execFileAsync(
      process.execPath,
      [
        resolve('node_modules/prisma/build/index.js'),
        'migrate',
        'deploy',
        '--config',
        resolve('.test-build/test/features/support/prisma-test.config.js'),
      ],
      {
        cwd: process.cwd(),
        env: { PATH: process.env.PATH, DATABASE_URL: url.toString() },
        timeout: 60_000,
      },
    );
    pool = new Pool({
      connectionString: url.toString(),
      max: 5,
      options: '-c search_path=estadistica_forms,public',
    });
    const localPool = pool;
    const connection: PostgreSqlConnection = {
      pool: localPool,
      close: () => endPool(localPool),
    };
    return { connection, close };
  } catch (error) {
    await close();
    throw error;
  }
}

/** `name` lo genera este archivo: es seguro ponerlo en el SQL. */
async function runAsAdmin(adminUrl: URL, sql: string) {
  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}
