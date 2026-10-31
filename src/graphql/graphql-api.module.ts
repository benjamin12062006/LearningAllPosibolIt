import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogImportModule } from '../catalog-import/catalog-import.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { UsersModule } from '../users/users.module.js';
import { CatalogImportResolver } from './catalog-import/catalog-import.resolver.js';
import { graphqlRootModule } from './graphql-config.js';
import { ProjectsResolver } from './projects/projects.resolver.js';
import { UsersResolver } from './users/users.resolver.js';

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
  ],
  providers: [UsersResolver, ProjectsResolver, CatalogImportResolver],
})
export class GraphqlApiModule {}
