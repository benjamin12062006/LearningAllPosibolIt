import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogImportModule } from '../catalog-import/catalog-import.module.js';
import { ChangesetsModule } from '../changesets/changesets.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { EvaluationsModule } from '../evaluations/evaluations.module.js';
import { ExportsModule } from '../exports/exports.module.js';
import { FeedRefreshesModule } from '../feed-refreshes/feed-refreshes.module.js';
import { FeedViewerModule } from '../feed-viewer/feed-viewer.module.js';
import { FeedsModule } from '../feeds/feeds.module.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { RulesetsModule } from '../rulesets/rulesets.module.js';
import { UsersModule } from '../users/users.module.js';
import { WorksheetExportsModule } from '../worksheet-exports/worksheet-exports.module.js';
import { WorksheetImportsModule } from '../worksheet-imports/worksheet-imports.module.js';
import { WorksheetToolsModule } from '../worksheet-tools/worksheet-tools.module.js';
import { WorksheetsModule } from '../worksheets/worksheets.module.js';
import { WorksheetCatalogSnapshotsModule } from '../worksheet-catalog-snapshots/worksheet-catalog-snapshots.module.js';
import { AgentGatewayController } from './agent-gateway.controller.js';
import { AgentGatewayService } from './agent-gateway.service.js';
import { AgentRunWorker } from './agent-run.worker.js';
import { AgentRunsController } from './agent-runs.controller.js';
import { AgentRunsRepository } from './agent-runs.repository.js';
import { AgentRunsService } from './agent-runs.service.js';
import { AGENT_RUN_DEFAULTS, AGENT_RUN_OPTIONS } from './agent-runs.types.js';
import { AI_AUTO_CONFIRM, aiAutoConfirmFrom } from './auto-confirm.js';
import { AgentOperationCatalog } from './operations/agent-operation-catalog.js';
import { ProjectBriefing } from './project-briefing.js';
import { ProposalDecisions } from './proposal-decisions.js';

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
    ExportsModule,
    FeedsModule,
    FeedRefreshesModule,
    FeedViewerModule,
    WorksheetsModule,
    WorksheetCatalogSnapshotsModule,
    WorksheetToolsModule,
    ChangesetsModule,
    WorksheetImportsModule,
    WorksheetExportsModule,
    KnowledgeModule,
    ConversationsModule,
  ],
  controllers: [AgentRunsController, AgentGatewayController],
  providers: [
    AgentRunsRepository,
    AgentRunsService,
    AgentGatewayService,
    AgentRunWorker,
    ProjectBriefing,
    AgentOperationCatalog,
    ProposalDecisions,
    { provide: AGENT_RUN_OPTIONS, useValue: AGENT_RUN_DEFAULTS },
    {
      provide: AI_AUTO_CONFIRM,
      useFactory: () => aiAutoConfirmFrom(process.env),
    },
  ],
  // Las integraciones externas reutilizan el catálogo y la confirmación.
  exports: [
    AgentRunsService,
    AgentOperationCatalog,
    AgentRunsRepository,
    ProposalDecisions,
    AGENT_RUN_OPTIONS,
    AI_AUTO_CONFIRM,
  ],
})
export class AgentRunsModule {}
