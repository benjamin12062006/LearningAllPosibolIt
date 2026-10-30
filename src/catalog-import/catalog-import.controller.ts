import { ErrorCodes } from '../common/http/error-codes.js';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { DescopeSessionGuard } from '../auth/descope-session.guard.js';
import { CatalogImportService } from './catalog-import.service.js';
import { ImportAccessGuard } from './import-access.guard.js';
import { ImportCatalogDto } from './import.dto.js';
import { apiError } from '../common/http/api-error.js';
import { uuidParamPipe } from '../common/http/validation-errors.js';
import { ImportUploadInterceptor } from './import-upload.interceptor.js';
import type { ImportRequest } from './import.types.js';

@Controller('projects/:projectId')
@UseGuards(DescopeSessionGuard)
export class CatalogImportController {
  constructor(private readonly imports: CatalogImportService) {}

  @Post('imports')
  @HttpCode(202)
  @UseGuards(ImportAccessGuard)
  @UseInterceptors(ImportUploadInterceptor)
  accept(
    @Req() req: ImportRequest,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Body() input: ImportCatalogDto,
  ) {
    if (!req.importOwnerId || !req.file || !req.importRequestId)
      throw apiError(ErrorCodes.INTERNAL_ERROR);
    return this.imports.accept(
      req.importOwnerId,
      projectId,
      req.file,
      input,
      req.importRequestId,
    );
  }

  @Get('jobs/:jobId')
  findJob(
    @Req() req: ImportRequest,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('jobId', uuidParamPipe('jobId')) jobId: string,
  ) {
    return this.imports.findJob(identityOf(req), projectId, jobId);
  }

  @Get('imports/:snapshotId')
  findSnapshot(
    @Req() req: ImportRequest,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('snapshotId', uuidParamPipe('snapshotId')) snapshotId: string,
  ) {
    return this.imports.findSnapshot(identityOf(req), projectId, snapshotId);
  }
}

function identityOf(req: ImportRequest) {
  if (!req.authenticatedIdentity) throw apiError(ErrorCodes.INTERNAL_ERROR);
  return req.authenticatedIdentity;
}
