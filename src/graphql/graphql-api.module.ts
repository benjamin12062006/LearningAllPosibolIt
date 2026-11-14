import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogImportModule } from '../catalog-import/catalog-import.module.js';
import { EvaluationsModule } from '../evaluations/evaluations.module.js';
import { FeedViewerModule } from '../feed-viewer/feed-viewer.module.js';
import { FeedsModule } from '../feeds/feeds.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { UsersModule } from '../users/users.module.js';
import { WorksheetsModule } from '../worksheets/worksheets.module.js';
import { CatalogImportResolver } from './catalog-import/catalog-import.resolver.js';
import { EvaluationsResolver } from './evaluations/evaluations.resolver.js';
import { FeedsResolver } from './feeds/feeds.resolver.js';
import { graphqlRootModule } from './graphql-config.js';
import { ProjectsResolver } from './projects/projects.resolver.js';
import { UsersResolver } from './users/users.resolver.js';
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
    EvaluationsModule,
    FeedsModule,
    FeedViewerModule,
  ],
  providers: [
    UsersResolver,
    ProjectsResolver,
    CatalogImportResolver,
    WorksheetsResolver,
    EvaluationsResolver,
    FeedsResolver,
  ],
})
export class GraphqlApiModule {}
