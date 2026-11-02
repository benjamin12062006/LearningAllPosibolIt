import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { CurrentIdentity } from '../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../auth/descope-session.guard.js';
import { uuidParamPipe } from '../common/http/validation-errors.js';
import { CreateExportDto } from './exports.dto.js';
import { ExportsService } from './exports.service.js';

/** IANA registra `text/tab-separated-values` con el juego de caracteres como parámetro (F21). */
const PRODUCTS_TSV_TYPE = 'text/tab-separated-values; charset=utf-8';

@Controller('projects/:projectId/exports')
@UseGuards(DescopeSessionGuard)
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  /**
   * `201` con la exportación nueva, o `200` con la que ya tenía la evaluación
   * (D7). `passthrough` solo fija el estado: Nest sigue enviando la respuesta y
   * no se salta interceptores ni filtros (RC1, F22).
   */
  @Post()
  async create(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Body() body: CreateExportDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.exports.create(identity, projectId, body);
    response.status(result.created ? 201 : 200);
    return { export: result.export, downloadUrl: result.downloadUrl };
  }

  @Get(':exportId')
  async findOne(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('exportId', uuidParamPipe('exportId')) exportId: string,
  ) {
    return {
      export: await this.exports.findOne(identity, projectId, exportId),
    };
  }

  /**
   * Descarga privada de `productos.tsv` (D9). `StreamableFile` deja que Nest
   * envíe el archivo sin salirse de su ciclo de vida, como `errores.csv` (F22).
   */
  @Get(':exportId/productos.tsv')
  async download(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('exportId', uuidParamPipe('exportId')) exportId: string,
  ) {
    const download = await this.exports.openDownload(
      identity,
      projectId,
      exportId,
    );
    return new StreamableFile(download.content, {
      type: PRODUCTS_TSV_TYPE,
      disposition: `attachment; filename="productos-${exportId}.tsv"`,
      length: download.byteSize,
    });
  }
}
