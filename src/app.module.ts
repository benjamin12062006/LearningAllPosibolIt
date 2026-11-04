import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { UsersModule } from './users/users.module.js';
import { CatalogImportModule } from './catalog-import/catalog-import.module.js';
import { GraphqlApiModule } from './graphql/graphql-api.module.js';
import { RulesetsModule } from './rulesets/rulesets.module.js';
import { EvaluationsModule } from './evaluations/evaluations.module.js';
import { ExportsModule } from './exports/exports.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { WorksheetsModule } from './worksheets/worksheets.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    UsersModule,
    OrganizationsModule,
    ProjectsModule,
    CatalogImportModule,
    RulesetsModule,
    EvaluationsModule,
    ExportsModule,
    WorksheetsModule,
    GraphqlApiModule,
  ],
})
export class AppModule {}
