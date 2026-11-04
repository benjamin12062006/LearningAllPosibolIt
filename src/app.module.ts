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
import { FeedRefreshesModule } from './feed-refreshes/feed-refreshes.module.js';
import { FeedsModule } from './feeds/feeds.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    UsersModule,
    ProjectsModule,
    CatalogImportModule,
    RulesetsModule,
    EvaluationsModule,
    ExportsModule,
    FeedsModule,
    FeedRefreshesModule,
    GraphqlApiModule,
  ],
})
export class AppModule {}
