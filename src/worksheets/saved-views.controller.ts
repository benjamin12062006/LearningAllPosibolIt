import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { CurrentIdentity } from '../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../auth/descope-session.guard.js';
import { PaginationQueryDto } from '../common/http/pagination.js';
import { uuidParamPipe } from '../common/http/validation-errors.js';
import { SavedViewsService } from './saved-views.service.js';
import { SaveViewDto } from './worksheets.dto.js';

/**
 * Vistas guardadas (H4) bajo
 * `P = /organizations/:organizationId/projects/:projectId`. Se usan al leer
 * filas con `viewId` en `rows/query`.
 */
@Controller('organizations/:organizationId/projects/:projectId')
@UseGuards(DescopeSessionGuard)
export class SavedViewsController {
  constructor(private readonly views: SavedViewsService) {}

  /** `201 { savedView }`: personal, cualquier miembro; del equipo, Editor. */
  @Post('worksheets/:worksheetId/saved-views')
  async create(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('worksheetId', uuidParamPipe('worksheetId')) worksheetId: string,
    @Body() body: SaveViewDto,
  ) {
    const savedView = await this.views.create(
      identity,
      { organizationId, projectId },
      worksheetId,
      body,
    );
    return { savedView };
  }

  /** Las del equipo y las propias: `{ savedViews, page }`. */
  @Get('worksheets/:worksheetId/saved-views')
  async findByWorksheet(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('worksheetId', uuidParamPipe('worksheetId')) worksheetId: string,
    @Query() query: PaginationQueryDto,
  ) {
    const { items, page } = await this.views.findByWorksheet(
      identity,
      { organizationId, projectId },
      worksheetId,
      query,
    );
    return { savedViews: items, page };
  }

  @Get('saved-views/:viewId')
  async find(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('viewId', uuidParamPipe('viewId')) viewId: string,
  ) {
    const savedView = await this.views.find(
      identity,
      { organizationId, projectId },
      viewId,
    );
    return { savedView };
  }

  /** Su autor, o un Manager si es del equipo. */
  @Put('saved-views/:viewId')
  async replace(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('viewId', uuidParamPipe('viewId')) viewId: string,
    @Body() body: SaveViewDto,
  ) {
    const savedView = await this.views.replace(
      identity,
      { organizationId, projectId },
      viewId,
      body,
    );
    return { savedView };
  }

  @Delete('saved-views/:viewId')
  @HttpCode(204)
  async delete(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('viewId', uuidParamPipe('viewId')) viewId: string,
  ) {
    await this.views.delete(identity, { organizationId, projectId }, viewId);
  }
}
