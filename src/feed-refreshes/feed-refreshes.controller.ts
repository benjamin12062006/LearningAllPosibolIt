import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { CurrentIdentity } from '../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../auth/descope-session.guard.js';
import { uuidParamPipe } from '../common/http/validation-errors.js';
import { FeedRefreshesService } from './feed-refreshes.service.js';

@Controller('projects/:projectId/feeds/:feedId/refreshes')
@UseGuards(DescopeSessionGuard)
export class FeedRefreshesController {
  constructor(private readonly refreshes: FeedRefreshesService) {}

  /** `202`: la actualización queda en cola; se consulta en `statusUrl`. */
  @Post()
  @HttpCode(202)
  trigger(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('feedId', uuidParamPipe('feedId')) feedId: string,
  ) {
    return this.refreshes.trigger(identity, projectId, feedId);
  }

  @Get(':refreshId')
  async findOne(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('feedId', uuidParamPipe('feedId')) feedId: string,
    @Param('refreshId', uuidParamPipe('refreshId')) refreshId: string,
  ) {
    return {
      refresh: await this.refreshes.findOne(
        identity,
        projectId,
        feedId,
        refreshId,
      ),
    };
  }
}
