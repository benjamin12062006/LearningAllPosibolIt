import { loadEnvFile } from 'node:process';
import { ConfigService } from '@nestjs/config';
import { resolveDatabaseConnection } from '../../dist/database/database-connection.js';
import { createPostgreSqlConnection } from '../../dist/database/postgresql.connection.js';
import { PrismaService } from '../../dist/database/prisma.service.js';

try {
  loadEnvFile();
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const connection = await createPostgreSqlConnection(
  resolveDatabaseConnection(new ConfigService(process.env)),
);
const prisma = new PrismaService(connection);
try {
  await prisma.onModuleInit();
  const [result] = await prisma.$queryRaw`
    SELECT 1 AS ok, current_database() AS database,
      current_user AS "user",
      to_regclass('estadistica_forms.app_users') IS NOT NULL AS "usersTableExists"
  `;
  console.log(JSON.stringify(result));
} finally {
  await prisma.onModuleDestroy();
}
