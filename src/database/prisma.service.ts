import { PrismaPg } from '@prisma/adapter-pg';
import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client.js';
import { DATABASE_SCHEMA } from './database-connection.js';
import {
  POSTGRESQL_CONNECTION,
  type PostgreSqlConnection,
} from './postgresql.connection.js';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private shutdown?: Promise<void>;

  constructor(
    @Inject(POSTGRESQL_CONNECTION)
    private readonly connection: PostgreSqlConnection,
  ) {
    super({
      adapter: new PrismaPg(connection.pool, { schema: DATABASE_SCHEMA }),
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      await this.$queryRaw`SELECT 1`;
    } catch (error) {
      await this.onModuleDestroy();
      throw error;
    }
  }

  onModuleDestroy(): Promise<void> {
    this.shutdown ??= (async () => {
      try {
        await this.$disconnect();
      } finally {
        await this.connection.close();
      }
    })();
    return this.shutdown;
  }
}
