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
import { OrganizationsModule } from './organizations/organizations.module.js';
import { WorksheetsModule } from './worksheets/worksheets.module.js';
import { ChangesetsModule } from './changesets/changesets.module.js';
import { WorksheetImportsModule } from './worksheet-imports/worksheet-imports.module.js';
import { WorksheetExportsModule } from './worksheet-exports/worksheet-exports.module.js';
import { WorksheetCatalogSnapshotsModule } from './worksheet-catalog-snapshots/worksheet-catalog-snapshots.module.js';
import { HealthModule } from './health/health.module.js';
import { FeedViewerModule } from './feed-viewer/feed-viewer.module.js';
import { KnowledgeModule } from './knowledge/knowledge.module.js';
import { AgentRunsModule } from './agent-runs/agent-runs.module.js';
import { ConversationsModule } from './conversations/conversations.module.js';
import { WorksheetToolsModule } from './worksheet-tools/worksheet-tools.module.js';

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
    FeedsModule,
    FeedRefreshesModule,
    WorksheetsModule,
    ChangesetsModule,
    WorksheetImportsModule,
    WorksheetExportsModule,
    WorksheetCatalogSnapshotsModule,
    HealthModule,
    GraphqlApiModule,
    FeedViewerModule,
    KnowledgeModule,
    ConversationsModule,
    WorksheetToolsModule,
    AgentRunsModule,
  ],
})
export class AppModule {}
