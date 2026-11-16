import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { CurrentIdentity } from '../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../auth/descope-session.guard.js';
import { PaginationQueryDto } from '../common/http/pagination.js';
import { uuidParamPipe } from '../common/http/validation-errors.js';
import { CreateImportMappingDto } from './import-mappings.dto.js';
import { ImportMappingsService } from './import-mappings.service.js';

/**
 * Plantillas de mapeo (H3) bajo
 * `P = /organizations/:organizationId/projects/:projectId`. Se usan al
 * importar con el campo `mappingId` del formulario.
 */
@Controller('organizations/:organizationId/projects/:projectId')
@UseGuards(DescopeSessionGuard)
export class ImportMappingsController {
  constructor(private readonly mappings: ImportMappingsService) {}

  /** `201 { importMapping }`. Pide Editor y una hoja activa. */
  @Post('worksheets/:worksheetId/import-mappings')
  async create(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('worksheetId', uuidParamPipe('worksheetId')) worksheetId: string,
    @Body() body: CreateImportMappingDto,
  ) {
    const importMapping = await this.mappings.create(
      identity,
      { organizationId, projectId },
      worksheetId,
      body,
    );
    return { importMapping };
  }

  @Get('worksheets/:worksheetId/import-mappings')
  async findByWorksheet(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('worksheetId', uuidParamPipe('worksheetId')) worksheetId: string,
    @Query() query: PaginationQueryDto,
  ) {
    const { items, page } = await this.mappings.findByWorksheet(
      identity,
      { organizationId, projectId },
      worksheetId,
      query,
    );
    return { importMappings: items, page };
  }

  @Get('import-mappings/:mappingId')
  async find(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('mappingId', uuidParamPipe('mappingId')) mappingId: string,
  ) {
    const importMapping = await this.mappings.find(
      identity,
      { organizationId, projectId },
      mappingId,
    );
    return { importMapping };
  }

  @Delete('import-mappings/:mappingId')
  @HttpCode(204)
  async delete(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('mappingId', uuidParamPipe('mappingId')) mappingId: string,
  ) {
    await this.mappings.delete(
      identity,
      { organizationId, projectId },
      mappingId,
    );
  }
}
