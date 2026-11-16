import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogImportModule } from '../catalog-import/catalog-import.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { EvaluationsModule } from '../evaluations/evaluations.module.js';
import { FeedViewerModule } from '../feed-viewer/feed-viewer.module.js';
import { FeedsModule } from '../feeds/feeds.module.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { RulesetsModule } from '../rulesets/rulesets.module.js';
import { UsersModule } from '../users/users.module.js';
import { WorksheetToolsModule } from '../worksheet-tools/worksheet-tools.module.js';
import { WorksheetsModule } from '../worksheets/worksheets.module.js';
import { AgentGatewayController } from './agent-gateway.controller.js';
import { AgentGatewayService } from './agent-gateway.service.js';
import { AgentRunWorker } from './agent-run.worker.js';
import { AgentRunsController } from './agent-runs.controller.js';
import { AgentRunsRepository } from './agent-runs.repository.js';
import { AgentRunsService } from './agent-runs.service.js';
import { AGENT_RUN_DEFAULTS, AGENT_RUN_OPTIONS } from './agent-runs.types.js';
import { AgentOperationCatalog } from './operations/agent-operation-catalog.js';

/**
 * Las ejecuciones del agente (E6.3a): está por encima de los módulos de
 * producto, porque su catálogo llama a sus servicios; ninguno depende de este.
 */
@Module({
  imports: [
    AuthModule,
    PrismaModule,
    UsersModule,
    ProjectsModule,
    CatalogImportModule,
    RulesetsModule,
    EvaluationsModule,
    FeedsModule,
    FeedViewerModule,
    WorksheetsModule,
    WorksheetToolsModule,
    KnowledgeModule,
  ],
  controllers: [AgentRunsController, AgentGatewayController],
  providers: [
    AgentRunsRepository,
    AgentRunsService,
    AgentGatewayService,
    AgentRunWorker,
    AgentOperationCatalog,
    { provide: AGENT_RUN_OPTIONS, useValue: AGENT_RUN_DEFAULTS },
  ],
  exports: [AgentRunsService, AgentOperationCatalog, AgentRunsRepository],
})
export class AgentRunsModule {}
