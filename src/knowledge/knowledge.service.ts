import { Injectable } from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { ProjectsService } from '../projects/projects.service.js';
import { KnowledgeSyncWorker } from './knowledge-sync.worker.js';
import { KnowledgeRepository } from './knowledge.repository.js';
import type { SourceType } from './knowledge.types.js';
import { keyOf, needsSync } from './sync-plan.js';

/** Una fuente del proyecto y si el índice ya tiene su versión actual. */
export type SourceStatus = Readonly<{
  sourceType: SourceType;
  sourceId: string;
  syncedAt: string | null;
  pending: boolean;
}>;

export type KnowledgeStatus = Readonly<{
  enabled: boolean;
  sources: readonly SourceStatus[];
}>;

/** Estado y reindexado del conocimiento de un proyecto (plan E6, D17). */
@Injectable()
export class KnowledgeService {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly repository: KnowledgeRepository,
    private readonly worker: KnowledgeSyncWorker,
  ) {}

  /** Cualquier miembro: qué fuentes están al día y cuáles esperan a la pasada siguiente. */
  async status(
    identity: AuthenticatedIdentity,
    projectId: string,
  ): Promise<KnowledgeStatus> {
    await this.projectsService.requireAccess(
      identity,
      projectId,
      'organization.read',
    );
    const synced = new Map(
      (await this.repository.findSyncedSourcesOfProject(projectId)).map(
        (source) => [keyOf(source), source],
      ),
    );
    const current =
      await this.repository.findCurrentSourcesOfProject(projectId);
    return {
      enabled: this.worker.enabled,
      sources: current.map((source) => {
        const done = synced.get(keyOf(source));
        return {
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          syncedAt: done?.syncedAt || null,
          pending: needsSync(source, done),
        };
      }),
    };
  }

  /**
   * Manager o más (D17). Pide otra pasada para todas las fuentes del proyecto.
   * Las claves permanecen guardadas para retirar del índice las que desaparecieron.
   */
  async reindex(identity: AuthenticatedIdentity, projectId: string) {
    await this.projectsService.requireAccess(
      identity,
      projectId,
      'changeset.approve',
    );
    if (!this.worker.enabled) {
      throw apiError(ErrorCodes.KNOWLEDGE_DISABLED);
    }
    await this.repository.requestReindex(projectId);
    this.worker.wake();
    return { status: 'queued' as const };
  }
}
