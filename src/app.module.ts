import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { UsersModule } from './users/users.module.js';
import { CatalogImportModule } from './catalog-import/catalog-import.module.js';
import { GraphqlApiModule } from './graphql/graphql-api.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    UsersModule,
    ProjectsModule,
    CatalogImportModule,
    GraphqlApiModule,
  ],
})
export class AppModule {}
