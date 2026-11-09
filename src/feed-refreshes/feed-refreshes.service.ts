import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import type { OrganizationPermission } from '../organizations/organization-roles.js';
import { ProjectsService } from '../projects/projects.service.js';
import { FeedRefreshWorker } from './feed-refresh.worker.js';
import { FeedRefreshesRepository } from './feed-refreshes.repository.js';

@Injectable()
export class FeedRefreshesService {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly repository: FeedRefreshesRepository,
    private readonly worker: FeedRefreshWorker,
  ) {}

  /**
   * «Actualizar ahora» (D10): encola una actualización y responde sin esperarla.
   * Exige fuente configurada, política aprobada (D11) y que no haya otra activa
   * en el feed.
   */
  async trigger(
    identity: AuthenticatedIdentity,
    projectId: string,
    feedId: string,
  ) {
    const ownerId = await this.actorFor(identity, projectId, 'worksheet.write');
    const feed = await this.repository.findFeedForRefresh(
      ownerId,
      projectId,
      feedId,
    );
    if (!feed) {
      throw apiError(ErrorCodes.FEED_NOT_FOUND);
    }
    if (!feed.hasSource) {
      throw apiError(ErrorCodes.FEED_SOURCE_NOT_CONFIGURED);
    }
    if (!feed.hasPolicy) {
      throw apiError(ErrorCodes.FEED_POLICY_NOT_APPROVED);
    }

    const refresh = await this.repository.create({
      id: randomUUID(),
      feedId,
      createdAt: new Date().toISOString(),
    });
    if (!refresh) {
      throw apiError(ErrorCodes.FEED_REFRESH_ALREADY_ACTIVE);
    }
    this.worker.wake();
    return {
      refresh,
      statusUrl: statusUrlOf(projectId, feedId, refresh.id),
    };
  }

  async findOne(
    identity: AuthenticatedIdentity,
    projectId: string,
    feedId: string,
    refreshId: string,
  ) {
    const ownerId = await this.actorFor(
      identity,
      projectId,
      'organization.read',
    );
    const refresh = await this.repository.findByOwner({
      ownerId,
      projectId,
      feedId,
      refreshId,
    });
    if (!refresh) {
      throw apiError(ErrorCodes.FEED_REFRESH_NOT_FOUND);
    }
    return refresh;
  }

  /**
   * Quien actúa, después de comprobar su acceso al proyecto (C6): si no es
   * miembro, 404 antes de buscar nada más; sin el permiso, 403. Lanzar una
   * actualización prepara trabajo (Editor o más); consultarla, cualquier miembro.
   */
  private async actorFor(
    identity: AuthenticatedIdentity,
    projectId: string,
    permission: OrganizationPermission,
  ) {
    const { actorId } = await this.projectsService.requireAccess(
      identity,
      projectId,
      permission,
    );
    return actorId;
  }
}

function statusUrlOf(projectId: string, feedId: string, refreshId: string) {
  return `/api/v1/projects/${projectId}/feeds/${feedId}/refreshes/${refreshId}`;
}
