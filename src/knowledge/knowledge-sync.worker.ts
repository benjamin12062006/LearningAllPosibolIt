import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { WorkerLoop } from '../jobs/worker-loop.js';
import {
  AI_SERVICE_CLIENT,
  AiServiceClient,
  AiServiceRejectedError,
  AiServiceUnavailableError,
} from './ai-service.client.js';
import { KnowledgeRepository } from './knowledge.repository.js';
import {
  KNOWLEDGE_OPTIONS,
  type CurrentSource,
  type KnowledgeOptions,
  type SourceKey,
} from './knowledge.types.js';
import { SourceDocuments } from './source-documents.js';
import { planSync, type SyncPlan } from './sync-plan.js';

/** Lo que hizo una pasada; lo devuelven las pruebas y lo registra el worker. */
export type SyncOutcome = Readonly<{
  replaced: number;
  removed: number;
  removedProjects: number;
  rejected: number;
  /** La pasada paró porque el servicio de IA no respondía. */
  interrupted: boolean;
}>;

/**
 * Mantiene el índice de conocimiento al día (plan E6, D15): en cada pasada
 * compara las huellas con lo ya mandado y manda solo lo que cambió. No toca
 * ningún módulo existente ni necesita eventos en sus transacciones.
 *
 * La sincronización se puede pausar mientras el servicio de IA sigue atendiendo el chat.
 */
@Injectable()
export class KnowledgeSyncWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(KnowledgeSyncWorker.name);
  private readonly loop: WorkerLoop;

  constructor(
    private readonly repository: KnowledgeRepository,
    private readonly documents: SourceDocuments,
    @Inject(AI_SERVICE_CLIENT)
    private readonly client: AiServiceClient | null,
    @Inject(KNOWLEDGE_OPTIONS)
    private readonly options: KnowledgeOptions,
  ) {
    this.loop = new WorkerLoop(
      { ...options, autoStart: options.autoStart && this.enabled },
      async () => {
        await this.syncOnce();
      },
      () => this.logger.error({ code: 'KNOWLEDGE_SYNC_FAILED' }),
    );
  }

  get enabled(): boolean {
    return this.client !== null && this.options.syncEnabled !== false;
  }

  onApplicationBootstrap() {
    this.loop.start();
  }

  async onModuleDestroy() {
    await this.loop.stop();
  }

  wake() {
    this.loop.wake();
  }

  /** Una pasada completa; las pruebas la llaman directamente. */
  async syncOnce(): Promise<SyncOutcome> {
    if (!this.client || !this.enabled) {
      return emptyOutcome(false);
    }
    const plan = planSync(
      await this.repository.findCurrentSources(),
      await this.repository.findSyncedSources(),
    );
    return this.apply(this.client, plan);
  }

  /**
   * Primero lo que se borra (no ocupa espacio en el índice ni en la cuota),
   * después lo que cambió. Si el servicio cae, se para: la pasada siguiente
   * reintentará lo que falte, porque su huella no se guardó.
   */
  private async apply(
    client: AiServiceClient,
    plan: SyncPlan,
  ): Promise<SyncOutcome> {
    const counts = { replaced: 0, removed: 0, removedProjects: 0, rejected: 0 };
    try {
      for (const project of plan.removedProjects) {
        await client.removeProject(
          project.organizationId,
          project.projectId,
          newRequestId(),
        );
        await this.repository.forgetProject(project.projectId);
        counts.removedProjects += 1;
      }
      for (const source of plan.removed) {
        await client.removeSource(source, newRequestId());
        await this.repository.forgetSource(source);
        counts.removed += 1;
      }
      for (const source of plan.changed) {
        if (this.loop.isStopping()) {
          break;
        }
        const sent = await this.replace(client, source);
        counts[sent ? 'replaced' : 'rejected'] += 1;
      }
    } catch (error) {
      if (!(error instanceof AiServiceUnavailableError)) {
        throw error;
      }
      this.logger.warn({ code: 'KNOWLEDGE_SERVICE_UNAVAILABLE' });
      return { ...counts, interrupted: true };
    }
    return { ...counts, interrupted: false };
  }

  /**
   * Un 4xx del servicio es un fallo de Nest (un documento fuera de sus
   * límites): reintentar no lo arregla. Se registra sin contenido y se sigue
   * con las demás fuentes; la huella no se guarda.
   */
  private async replace(client: AiServiceClient, source: CurrentSource) {
    const documents = await this.documents.of(source);
    try {
      await client.replaceSource(source, documents, newRequestId());
    } catch (error) {
      if (!(error instanceof AiServiceRejectedError)) {
        throw error;
      }
      this.logger.error({
        code: 'KNOWLEDGE_SOURCE_REJECTED',
        status: error.status,
        serviceCode: error.code,
        ...describeSource(source),
      });
      return false;
    }
    await this.repository.remember(source, this.options.clock().toISOString());
    return true;
  }
}

function emptyOutcome(interrupted: boolean): SyncOutcome {
  return {
    replaced: 0,
    removed: 0,
    removedProjects: 0,
    rejected: 0,
    interrupted,
  };
}

/** Identificador de petición para seguir una llamada en los registros de los dos servicios. */
function newRequestId() {
  return `knowledge-sync:${randomUUID()}`;
}

function describeSource(source: SourceKey) {
  return {
    projectId: source.projectId,
    sourceType: source.sourceType,
    sourceId: source.sourceId,
  };
}
