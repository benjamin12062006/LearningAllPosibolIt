import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { CurrentIdentity } from '../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../auth/descope-session.guard.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { PaginationQueryDto } from '../common/http/pagination.js';
import { uuidParamPipe } from '../common/http/validation-errors.js';
import { CatalogImportService } from './catalog-import.service.js';
import { ImportAccessGuard } from './import-access.guard.js';
import { ImportUploadInterceptor } from './import-upload.interceptor.js';
import { ImportCatalogDto } from './import.dto.js';
import type { ImportRequest } from './import.types.js';

@Controller('projects/:projectId')
@UseGuards(DescopeSessionGuard)
export class CatalogImportController {
  constructor(private readonly imports: CatalogImportService) {}

  /**
   * `ImportAccessGuard` comprueba el proyecto antes de recibir el archivo y
   * `ImportUploadInterceptor` lo guarda en disco; ambos dejan sus datos en la request.
   */
  @Post('imports')
  @HttpCode(202)
  @UseGuards(ImportAccessGuard)
  @UseInterceptors(ImportUploadInterceptor)
  accept(
    @Req() request: ImportRequest,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Body() input: ImportCatalogDto,
  ) {
    const { importOwnerId, file, importRequestId } = request;
    if (!importOwnerId || !file || !importRequestId) {
      throw apiError(ErrorCodes.INTERNAL_ERROR);
    }
    return this.imports.accept(
      importOwnerId,
      projectId,
      file,
      input,
      importRequestId,
    );
  }

  @Get('imports')
  list(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.imports.list(identity, projectId, query);
  }

  @Get('imports/:snapshotId')
  findSnapshot(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('snapshotId', uuidParamPipe('snapshotId')) snapshotId: string,
  ) {
    return this.imports.findSnapshot(identity, projectId, snapshotId);
  }

  /** Borra el proyecto y sus importaciones (aquí porque también borra sus archivos). */
  @Delete()
  @HttpCode(204)
  async deleteProject(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
  ) {
    await this.imports.deleteProject(identity, projectId);
  }

  @Delete('imports/:snapshotId')
  @HttpCode(204)
  async deleteImport(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('snapshotId', uuidParamPipe('snapshotId')) snapshotId: string,
  ) {
    await this.imports.deleteImport(identity, projectId, snapshotId);
  }

  @Get('jobs/:jobId')
  findJob(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('jobId', uuidParamPipe('jobId')) jobId: string,
  ) {
    return this.imports.findJob(identity, projectId, jobId);
  }
}
