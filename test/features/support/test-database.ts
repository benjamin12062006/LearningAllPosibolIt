import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { Pool } from 'pg';
import type { PostgreSqlConnection } from '../../../src/database/postgresql.connection.js';

const execFileAsync = promisify(execFile);

export async function createTestDatabase(options: { migrate?: boolean } = {}) {
  const database = await PGlite.create();
  const server = new PGLiteSocketServer({
    db: database,
    host: '127.0.0.1',
    port: 0,
    maxConnections: 5,
  });
  let pool: Pool | undefined;
  let poolClosing: Promise<void> | undefined;
  async function close() {
    try {
      if (pool) await (poolClosing ??= pool.end());
    } finally {
      try {
        await server.stop();
      } finally {
        await database.close();
      }
    }
  }
  try {
    await server.start();
    const url = new URL(
      `postgresql://postgres:postgres@${server.getServerConn()}/postgres`,
    );
    if (url.hostname !== '127.0.0.1')
      throw new Error('El destino de pruebas debe ser local y temporal.');
    url.searchParams.set('schema', 'estadistica_forms');
    url.searchParams.set('sslmode', 'disable');
    const migrate = () =>
      execFileAsync(
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
          env: {
            PATH: process.env.PATH,
            POSTGRES_MIGRATION_DATABASE_URL: url.toString(),
          },
          timeout: 30_000,
        },
      );
    if (options.migrate !== false) await migrate();
    pool = new Pool({
      connectionString: url.toString(),
      max: 5,
      options: '-c search_path=estadistica_forms,public',
    });
    const localPool = pool;
    const connection: PostgreSqlConnection = {
      pool: localPool,
      close: () => (poolClosing ??= localPool.end()),
    };
    return { connection, migrate, close };
  } catch (error) {
    await close();
    throw error;
  }
}
