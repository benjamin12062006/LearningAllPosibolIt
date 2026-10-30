import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolveDatabaseConnection } from './database-connection.js';
import {
  createPostgreSqlConnection,
  POSTGRESQL_CONNECTION,
} from './postgresql.connection.js';
import { PrismaService } from './prisma.service.js';

@Module({
  providers: [
    {
      provide: POSTGRESQL_CONNECTION,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createPostgreSqlConnection(resolveDatabaseConnection(config)),
    },
    PrismaService,
  ],
  exports: [PrismaService],
})
export class PrismaModule {}
