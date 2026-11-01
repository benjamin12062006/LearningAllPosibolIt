import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { publicError } from '../common/http/public-error.js';
import { ProjectsService } from '../projects/projects.service.js';
import { UsersService } from '../users/users.service.js';
import { CatalogImportRepository } from './catalog-import.repository.js';
import type { ImportRequest } from './import.types.js';

/**
 * Rechaza la subida antes de leer el CSV (hasta 10 MiB) si el proyecto no
 * existe, no está configurado o ya tiene una importación activa.
 */
@Injectable()
export class ImportAccessGuard implements CanActivate {
  constructor(
    private readonly projects: ProjectsService,
    private readonly users: UsersService,
    private readonly repository: CatalogImportRepository,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<ImportRequest>();
    const identity = request.authenticatedIdentity;
    if (!identity) {
      throw apiError(ErrorCodes.AUTH_SESSION_REQUIRED);
    }

    const projectId = readProjectId(request);
    await this.projects.requireConfigured(identity, projectId);
    const owner = await this.users.findCurrent(identity);

    // Comprobación temprana; la definitiva, sin carreras, está en
    // `CatalogImportRepository.accept`.
    if (await this.repository.hasActiveJob(owner.id, projectId)) {
      throw apiError(ErrorCodes.IMPORT_ALREADY_ACTIVE);
    }

    request.importOwnerId = owner.id;
    return true;
  }
}

/** El guard se ejecuta antes que los pipes, así que valida el UUID por su cuenta. */
function readProjectId(request: ImportRequest): string {
  const projectId = request.params.projectId;
  if (typeof projectId !== 'string' || !isUUID(projectId)) {
    throw apiError(ErrorCodes.INVALID_UUID, [
      { field: 'projectId', ...publicError(ErrorCodes.INVALID_UUID) },
    ]);
  }
  return projectId;
}
