import { Module } from '@nestjs/common';
import { AgentRunsModule } from '../agent-runs/agent-runs.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { UsersModule } from '../users/users.module.js';
import { WorksheetExportsModule } from '../worksheet-exports/worksheet-exports.module.js';
import { FeedsModule } from '../feeds/feeds.module.js';
import { ExportsModule } from '../exports/exports.module.js';
import { CliOAuthAccess } from './cli-oauth-access.js';
import { CLI_OAUTH_CONFIG, cliOAuthConfigFrom } from './cli-oauth-config.js';
import { CliIntegrationController } from './cli-integration.controller.js';
import { IntegrationGatewayController } from './integration-gateway.controller.js';
import { IntegrationGatewayService } from './integration-gateway.service.js';
import { IntegrationsController } from './integrations.controller.js';
import { IntegrationsRepository } from './integrations.repository.js';
import { IntegrationsService } from './integrations.service.js';
import { MCP_ADAPTER_TOKEN } from './integrations.types.js';
import { McpOAuthAccess } from './mcp-oauth-access.js';
import { MCP_OAUTH_CONFIG, mcpOAuthConfigFrom } from './mcp-oauth-config.js';
import { mcpAdapterTokenFrom } from './mcp-adapter-config.js';

/**
 * Acceso externo (plan 07): credenciales delegadas para clientes MCP. Está
 * por encima de las ejecuciones del agente, de las que reutiliza el catálogo
 * de operaciones y la confirmación humana.
 */
@Module({
  imports: [
    AuthModule,
    PrismaModule,
    UsersModule,
    KnowledgeModule,
    AgentRunsModule,
    WorksheetExportsModule,
    FeedsModule,
    ExportsModule,
  ],
  controllers: [
    IntegrationsController,
    IntegrationGatewayController,
    CliIntegrationController,
  ],
  providers: [
    IntegrationsRepository,
    IntegrationsService,
    IntegrationGatewayService,
    McpOAuthAccess,
    CliOAuthAccess,
    {
      provide: CLI_OAUTH_CONFIG,
      useFactory: () => cliOAuthConfigFrom(process.env),
    },
    {
      provide: MCP_OAUTH_CONFIG,
      useFactory: () => mcpOAuthConfigFrom(process.env),
    },
    {
      provide: MCP_ADAPTER_TOKEN,
      useFactory: () => mcpAdapterTokenFrom(process.env),
    },
  ],
})
export class IntegrationsModule {}
