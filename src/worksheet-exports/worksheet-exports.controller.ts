import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { CurrentIdentity } from '../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../auth/descope-session.guard.js';
import { uuidParamPipe } from '../common/http/validation-errors.js';
import { CreateWorksheetExportDto } from './worksheet-exports.dto.js';
import { WorksheetExportsService } from './worksheet-exports.service.js';
import type { ExportFormat } from './worksheet-exports.types.js';

/** `header=present`: el CSV empieza por la fila de nombres (RFC 4180, F66). */
const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8; header=present',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * Exportar una revisión de hoja (E5.3) bajo
 * `P = /organizations/:organizationId/projects/:projectId`.
 */
@Controller('organizations/:organizationId/projects/:projectId')
@UseGuards(DescopeSessionGuard)
export class WorksheetExportsController {
  constructor(private readonly exports: WorksheetExportsService) {}

  @Post('worksheets/:worksheetId/exports')
  create(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('worksheetId', uuidParamPipe('worksheetId')) worksheetId: string,
    @Body() body: CreateWorksheetExportDto,
  ) {
    return this.exports.create(
      identity,
      { organizationId, projectId },
      worksheetId,
      body,
    );
  }

  @Get('worksheet-exports/:exportId')
  async find(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('exportId', uuidParamPipe('exportId')) exportId: string,
  ) {
    const found = await this.exports.find(
      identity,
      { organizationId, projectId },
      exportId,
    );
    return { export: found };
  }

  /**
   * Descarga privada (D15). `StreamableFile` deja que Nest envíe el archivo
   * sin salirse de su ciclo de vida, como `productos.tsv`.
   */
  @Get('worksheet-exports/:exportId/file')
  async download(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('exportId', uuidParamPipe('exportId')) exportId: string,
  ) {
    const download = await this.exports.openDownload(
      identity,
      { organizationId, projectId },
      exportId,
    );
    const { format, byteSize } = download.file;
    return new StreamableFile(download.content, {
      type: CONTENT_TYPES[format],
      disposition: `attachment; filename="hoja-${exportId}.${format}"`,
      length: byteSize,
    });
  }
}
