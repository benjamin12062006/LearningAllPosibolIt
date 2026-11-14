import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { CurrentIdentity } from '../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../auth/descope-session.guard.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { PaginationQueryDto } from '../common/http/pagination.js';
import { uuidParamPipe } from '../common/http/validation-errors.js';
import {
  WorksheetUploadInterceptor,
  type WorksheetUploadRequest,
} from './worksheet-upload.interceptor.js';
import { WorksheetImportsService } from './worksheet-imports.service.js';

/**
 * Importar un CSV o un XLSX a una hoja (E5.1, E5.2) bajo
 * `P = /organizations/:organizationId/projects/:projectId`. El archivo llega
 * como `multipart/form-data` en el campo `file`.
 */
@Controller('organizations/:organizationId/projects/:projectId')
@UseGuards(DescopeSessionGuard)
export class WorksheetImportsController {
  constructor(private readonly imports: WorksheetImportsService) {}

  /**
   * CSV: campo opcional `delimiter` (`comma` por defecto o `semicolon`).
   * XLSX: campos opcionales `sheet` y `headerRow` (fila de Excel, 1 por defecto).
   */
  @Post('worksheets/:worksheetId/imports/preview')
  @HttpCode(200)
  @UseInterceptors(WorksheetUploadInterceptor)
  async preview(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('worksheetId', uuidParamPipe('worksheetId')) worksheetId: string,
    @Req() request: WorksheetUploadRequest,
    @Body() body: Record<string, string>,
  ) {
    const preview = await this.imports.preview(
      identity,
      { organizationId, projectId },
      worksheetId,
      fileOf(request),
      {
        delimiter: body.delimiter,
        sheet: body.sheet,
        headerRow: body.headerRow,
        mappingId: body.mappingId,
      },
    );
    return { preview };
  }

  /**
   * Campo `options`: JSON con el mapeo, el modo y las exclusiones (D3–D6).
   * Con `mappingId` (H3), el mapeo sale de la plantilla y `options` solo lleva
   * lo que depende del archivo: título, exclusiones, separador u hoja.
   */
  @Post('worksheets/:worksheetId/imports')
  @UseInterceptors(WorksheetUploadInterceptor)
  async create(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('worksheetId', uuidParamPipe('worksheetId')) worksheetId: string,
    @Req() request: WorksheetUploadRequest,
    @Body() body: Record<string, string>,
    @Res({ passthrough: true }) response: Response,
  ) {
    const created = await this.imports.create(
      identity,
      { organizationId, projectId },
      worksheetId,
      fileOf(request),
      body.options,
      body.mappingId,
    );
    response.setHeader('ETag', `"${created.changeset.draftVersion}"`);
    return created;
  }

  /** Historial (H2): `{ imports: [resumen sin filas excluidas], page }`. */
  @Get('worksheets/:worksheetId/imports')
  async findByWorksheet(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('worksheetId', uuidParamPipe('worksheetId')) worksheetId: string,
    @Query() query: PaginationQueryDto,
  ) {
    const { items, page } = await this.imports.findByWorksheet(
      identity,
      { organizationId, projectId },
      worksheetId,
      query,
    );
    return { imports: items, page };
  }

  @Get('worksheet-imports/:importId')
  async find(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('importId', uuidParamPipe('importId')) importId: string,
  ) {
    const found = await this.imports.find(
      identity,
      { organizationId, projectId },
      importId,
    );
    return { import: found };
  }
}

/** El interceptor ya comprobó que hay archivo. */
function fileOf(request: WorksheetUploadRequest): Buffer {
  if (!request.file) {
    throw apiError(ErrorCodes.IMPORT_FILE_REQUIRED);
  }
  return request.file.buffer;
}
