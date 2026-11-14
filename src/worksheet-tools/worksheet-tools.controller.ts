import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { CurrentIdentity } from '../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../auth/descope-session.guard.js';
import { PaginationQueryDto, resolvePage } from '../common/http/pagination.js';
import { uuidParamPipe } from '../common/http/validation-errors.js';
import {
  CreateWorksheetChangeProposalDto,
  CreateWorksheetSelectionDto,
  PreviewWorksheetTransformDto,
} from './worksheet-tools.dto.js';
import { WorksheetToolsService } from './worksheet-tools.service.js';

@Controller(
  'organizations/:organizationId/projects/:projectId/worksheets/:worksheetId',
)
@UseGuards(DescopeSessionGuard)
export class WorksheetToolsController {
  constructor(private readonly tools: WorksheetToolsService) {}

  @Post('selections')
  createSelection(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('worksheetId', uuidParamPipe('worksheetId')) worksheetId: string,
    @Body() body: CreateWorksheetSelectionDto,
  ) {
    return this.tools.createSelection(
      identity,
      { organizationId, projectId },
      worksheetId,
      body,
    );
  }

  @Post('transform-previews')
  previewTransform(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('worksheetId', uuidParamPipe('worksheetId')) worksheetId: string,
    @Body() body: PreviewWorksheetTransformDto,
  ) {
    return this.tools.previewTransform(
      identity,
      { organizationId, projectId },
      worksheetId,
      body,
    );
  }

  @Get('transform-previews/:previewId')
  findPreview(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('worksheetId', uuidParamPipe('worksheetId')) worksheetId: string,
    @Param('previewId', uuidParamPipe('previewId')) previewId: string,
    @Query() query: PaginationQueryDto,
  ) {
    const { limit, offset } = resolvePage(query);
    return this.tools.findPreview(
      identity,
      { organizationId, projectId },
      worksheetId,
      previewId,
      limit,
      offset,
    );
  }

  @Post('change-proposals')
  createChangeProposal(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('worksheetId', uuidParamPipe('worksheetId')) worksheetId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreateWorksheetChangeProposalDto,
  ) {
    return this.tools.createChangeProposal(
      identity,
      { organizationId, projectId },
      worksheetId,
      body,
      idempotencyKey,
    );
  }
}
