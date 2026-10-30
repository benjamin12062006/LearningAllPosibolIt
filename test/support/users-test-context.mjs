import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { Pool } from 'pg';
import { PrismaService } from '../../dist/database/prisma.service.js';
import { UsersRepository } from '../../dist/users/users.repository.js';

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const prismaCli = join(projectRoot, 'node_modules', '.bin', 'prisma');

export async function createUsersTestContext() {
  const database = await PGlite.create();
  const server = new PGLiteSocketServer({
    db: database,
    host: '127.0.0.1',
    port: 0,
    maxConnections: 5,
  });
  let prisma;
  let pool;
  try {
    await server.start();
    const databaseUrl = `postgresql://postgres:postgres@${server.getServerConn()}/postgres?schema=estadistica_forms&sslmode=disable`;
    const migrate = () =>
      execFileAsync(prismaCli, ['migrate', 'deploy'], {
        cwd: projectRoot,
        env: { ...process.env, POSTGRES_MIGRATION_DATABASE_URL: databaseUrl },
        timeout: 30_000,
      });
    await migrate();

    pool = new Pool({
      connectionString: databaseUrl,
      max: 5,
      options: '-c search_path=estadistica_forms,public',
    });
    prisma = new PrismaService({ pool, close: () => pool.end() });
    await prisma.onModuleInit();

    return {
      prisma,
      migrate,
      repository: new UsersRepository(prisma),
      async close() {
        try {
          await prisma.onModuleDestroy();
        } finally {
          await server.stop();
          await database.close();
        }
      },
    };
  } catch (error) {
    if (pool && !pool.ended) await pool.end();
    await server.stop();
    await database.close();
    throw error;
  }
}

export async function withUsersRepository(run) {
  const context = await createUsersTestContext();
  try {
    await run(context.repository, context.prisma);
  } finally {
    await context.close();
  }
}
