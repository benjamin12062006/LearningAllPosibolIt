import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { CurrentIdentity } from '../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../auth/descope-session.guard.js';
import type { RequestWithId } from '../common/http/request-id.js';
import { uuidParamPipe } from '../common/http/validation-errors.js';
import { CreateWorksheetCatalogSnapshotDto } from './worksheet-catalog-snapshots.dto.js';
import { WorksheetCatalogSnapshotsService } from './worksheet-catalog-snapshots.service.js';

/**
 * Llevar una revisión de hoja al catálogo (E5.4) bajo
 * `P = /organizations/:organizationId/projects/:projectId`. El snapshot y su
 * trabajo se consultan por las rutas de importaciones existentes.
 */
@Controller('organizations/:organizationId/projects/:projectId')
@UseGuards(DescopeSessionGuard)
export class WorksheetCatalogSnapshotsController {
  constructor(private readonly snapshots: WorksheetCatalogSnapshotsService) {}

  /** 202, como una importación: el worker de catálogo termina el snapshot. */
  @Post('worksheets/:worksheetId/catalog-snapshots')
  @HttpCode(202)
  create(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Req() request: RequestWithId,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('worksheetId', uuidParamPipe('worksheetId')) worksheetId: string,
    @Body() body: CreateWorksheetCatalogSnapshotDto,
  ) {
    return this.snapshots.create(
      identity,
      { organizationId, projectId },
      worksheetId,
      body,
      // `assignRequestId` lo pone en toda petición; sin él (una prueba que no
      // configura HTTP), uno nuevo.
      request.requestId ?? randomUUID(),
    );
  }

  @Get('worksheet-catalog-snapshots/:snapshotId')
  async find(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('snapshotId', uuidParamPipe('snapshotId')) snapshotId: string,
  ) {
    const catalogSnapshot = await this.snapshots.find(
      identity,
      { organizationId, projectId },
      snapshotId,
    );
    return { catalogSnapshot };
  }
}
