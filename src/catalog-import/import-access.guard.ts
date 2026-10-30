import { ErrorCodes } from '../common/http/error-codes.js';
import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { ProjectsService } from '../projects/projects.service.js';
import { UsersService } from '../users/users.service.js';
import type { ImportRequest } from './import.types.js';
import { apiError } from '../common/http/api-error.js';
import { publicError } from '../common/http/public-error.js';

@Injectable()
export class ImportAccessGuard implements CanActivate {
  constructor(
    private readonly projects: ProjectsService,
    private readonly users: UsersService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<ImportRequest>();
    if (!req.authenticatedIdentity)
      throw apiError(ErrorCodes.AUTH_SESSION_REQUIRED);
    const projectId = req.params.projectId;
    if (typeof projectId !== 'string' || !isUUID(projectId))
      throw apiError(ErrorCodes.INVALID_UUID, [
        { field: 'projectId', ...publicError(ErrorCodes.INVALID_UUID) },
      ]);
    await this.projects.requireConfigured(req.authenticatedIdentity, projectId);
    req.importOwnerId = (
      await this.users.findCurrent(req.authenticatedIdentity)
    ).id;
    return true;
  }
}
