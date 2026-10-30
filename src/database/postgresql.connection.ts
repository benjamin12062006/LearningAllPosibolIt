import { Connector, IpAddressTypes } from '@google-cloud/cloud-sql-connector';
import { Logger } from '@nestjs/common';
import { Pool } from 'pg';
import type { DatabaseConnection } from './database-connection.js';

export const POSTGRESQL_CONNECTION = Symbol('POSTGRESQL_CONNECTION');

export type PostgreSqlConnection = Readonly<{
  pool: Pool;
  close(): Promise<void>;
}>;

export async function createPostgreSqlConnection(
  config: DatabaseConnection,
): Promise<PostgreSqlConnection> {
  const connector = new Connector();
  try {
    const options = await connector.getOptions({
      instanceConnectionName: config.instanceConnectionName,
      ipType: IpAddressTypes.PUBLIC,
    });
    const pool = new Pool({
      ...options,
      database: config.database,
      user: config.user,
      password: config.password,
      max: 5,
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
        closing ??= pool.end().finally(() => connector.close());
        return closing;
      },
    };
  } catch (error) {
    connector.close();
    throw error;
  }
}
