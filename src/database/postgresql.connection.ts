import { Logger } from '@nestjs/common';
import { Pool } from 'pg';
import type { DatabaseConnection } from './database-connection.js';

export const POSTGRESQL_CONNECTION = Symbol('POSTGRESQL_CONNECTION');

export type PostgreSqlConnection = Readonly<{
  pool: Pool;
  close(): Promise<void>;
}>;

export function createPostgreSqlConnection(
  config: DatabaseConnection,
): PostgreSqlConnection {
  const pool = new Pool({
    connectionString: config.url,
    max: 5,
    // La primera conexión puede tardar: el proxy pide su token a Google (y
    // Neon, si se usa, despierta el cómputo suspendido).
    connectionTimeoutMillis: 10_000,
    query_timeout: 10_000,
  });
  const logger = new Logger('PostgreSQL');
  pool.on('error', () => {
    logger.error('Se cerró una conexión PostgreSQL inactiva del pool.');
  });

  let closing: Promise<void> | undefined;
  return {
    pool,
    close() {
      closing ??= pool.end();
      return closing;
    },
  };
}
