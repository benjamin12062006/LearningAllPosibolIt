import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogImportModule } from '../catalog-import/catalog-import.module.js';
import { ChangesetsModule } from '../changesets/changesets.module.js';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { EvaluationsModule } from '../evaluations/evaluations.module.js';
import { ExportsModule } from '../exports/exports.module.js';
import { FeedRefreshesModule } from '../feed-refreshes/feed-refreshes.module.js';
import { FeedViewerModule } from '../feed-viewer/feed-viewer.module.js';
import { FeedsModule } from '../feeds/feeds.module.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { RulesetsModule } from '../rulesets/rulesets.module.js';
import { UsersModule } from '../users/users.module.js';
import { WorksheetCatalogSnapshotsModule } from '../worksheet-catalog-snapshots/worksheet-catalog-snapshots.module.js';
import { WorksheetExportsModule } from '../worksheet-exports/worksheet-exports.module.js';
import { WorksheetImportsModule } from '../worksheet-imports/worksheet-imports.module.js';
import { WorksheetToolsModule } from '../worksheet-tools/worksheet-tools.module.js';
import { WorksheetsModule } from '../worksheets/worksheets.module.js';
import { CatalogImportResolver } from './catalog-import/catalog-import.resolver.js';
import { ChangesetsResolver } from './changesets/changesets.resolver.js';
import { ConversationsResolver } from './conversations/conversations.resolver.js';
import { EvaluationsResolver } from './evaluations/evaluations.resolver.js';
import { ExportsResolver } from './exports/exports.resolver.js';
import { FeedVersionsResolver } from './feeds/feed-versions.resolver.js';
import { FeedsResolver } from './feeds/feeds.resolver.js';
import { graphqlRootModule } from './graphql-config.js';
import { KnowledgeResolver } from './knowledge/knowledge.resolver.js';
import { ProjectFieldsResolver } from './projects/project-fields.resolver.js';
import { ProjectsResolver } from './projects/projects.resolver.js';
import { RulesetsResolver } from './rulesets/rulesets.resolver.js';
import { UsersResolver } from './users/users.resolver.js';
import { WorksheetCatalogSnapshotsResolver } from './worksheet-catalog-snapshots/worksheet-catalog-snapshots.resolver.js';
import { WorksheetExportsResolver } from './worksheet-exports/worksheet-exports.resolver.js';
import { WorksheetImportsResolver } from './worksheet-imports/worksheet-imports.resolver.js';
import { WorksheetToolsResolver } from './worksheet-tools/worksheet-tools.resolver.js';
import { SavedViewsResolver } from './worksheets/saved-views.resolver.js';
import { WorkbooksResolver } from './worksheets/workbooks.resolver.js';
import { WorksheetHistoryResolver } from './worksheets/worksheet-history.resolver.js';
import { WorksheetsResolver } from './worksheets/worksheets.resolver.js';

/**
 * Capa GraphQL completa: configuración de Apollo y resolvers.
 * Los módulos de negocio solo exportan sus servicios; no conocen GraphQL.
 */
@Module({
  imports: [
    graphqlRootModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    CatalogImportModule,
    WorksheetsModule,
    ChangesetsModule,
    WorksheetImportsModule,
    WorksheetExportsModule,
    WorksheetCatalogSnapshotsModule,
    RulesetsModule,
    EvaluationsModule,
    ExportsModule,
    FeedsModule,
    FeedViewerModule,
    FeedRefreshesModule,
    KnowledgeModule,
    ConversationsModule,
    WorksheetToolsModule,
  ],
  providers: [
    UsersResolver,
    ProjectsResolver,
    ProjectFieldsResolver,
    CatalogImportResolver,
    RulesetsResolver,
    WorksheetsResolver,
    WorkbooksResolver,
    WorksheetHistoryResolver,
    ChangesetsResolver,
    WorksheetImportsResolver,
    WorksheetExportsResolver,
    WorksheetCatalogSnapshotsResolver,
    SavedViewsResolver,
    EvaluationsResolver,
    ExportsResolver,
    FeedsResolver,
    FeedVersionsResolver,
    KnowledgeResolver,
    ConversationsResolver,
    WorksheetToolsResolver,
  ],
})
export class GraphqlApiModule {}
