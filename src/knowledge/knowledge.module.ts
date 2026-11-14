import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { aiServiceConfigFrom } from './ai-service-config.js';
import { AI_SERVICE_CLIENT, AiServiceClient } from './ai-service.client.js';
import { KnowledgeSyncWorker } from './knowledge-sync.worker.js';
import { KnowledgeController } from './knowledge.controller.js';
import { KnowledgeRepository } from './knowledge.repository.js';
import { KnowledgeService } from './knowledge.service.js';
import { KNOWLEDGE_DEFAULTS, KNOWLEDGE_OPTIONS } from './knowledge.types.js';
import { SourceDocuments } from './source-documents.js';

/**
 * Conocimiento para el asistente (plan E6, E6.1b): manda al servicio de IA lo
 * que cada proyecto tiene. Está por encima de proyectos, catálogo, evaluaciones,
 * reglas y feeds: lee sus tablas y ninguno de ellos depende de este módulo.
 */
@Module({
  imports: [AuthModule, PrismaModule, ProjectsModule],
  controllers: [KnowledgeController],
  providers: [
    KnowledgeRepository,
    KnowledgeService,
    KnowledgeSyncWorker,
    SourceDocuments,
    {
      provide: AI_SERVICE_CLIENT,
      useFactory: () => {
        const config = aiServiceConfigFrom(process.env);
        return config ? new AiServiceClient(config) : null;
      },
    },
    { provide: KNOWLEDGE_OPTIONS, useValue: KNOWLEDGE_DEFAULTS },
  ],
  // Lo usa la capa GraphQL, igual que el controlador REST.
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
