import {
  Body,
  Controller,
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
import { WorksheetRowsService } from './worksheet-rows.service.js';
import {
  CreateWorkbookDto,
  CreateWorksheetDto,
  QueryRowsDto,
} from './worksheets.dto.js';
import { WorksheetsService } from './worksheets.service.js';
import type { ProjectScope } from './worksheets.types.js';

/**
 * Rutas bajo `P = /organizations/:organizationId/projects/:projectId` ([16]).
 * La organización y el proyecto de la ruta solo son selectores: el servicio
 * comprueba que el proyecto sea de esa organización y que el usuario sea
 * miembro.
 */
@Controller('organizations/:organizationId/projects/:projectId')
@UseGuards(DescopeSessionGuard)
export class WorksheetsController {
  constructor(
    private readonly worksheetsService: WorksheetsService,
    private readonly rowsService: WorksheetRowsService,
  ) {}

  @Post('workbooks')
  async createWorkbook(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Body() body: CreateWorkbookDto,
  ) {
    const workbook = await this.worksheetsService.createWorkbook(
      identity,
      { organizationId, projectId },
      body.name,
    );
    return { workbook };
  }

  @Get('workbooks')
  async findWorkbooks(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Query() query: PaginationQueryDto,
  ) {
    const scope: ProjectScope = { organizationId, projectId };
    const { items, page } = await this.worksheetsService.findWorkbooks(
      identity,
      scope,
      query,
    );
    return { workbooks: items, page };
  }

  @Post('workbooks/:workbookId/worksheets')
  createWorksheet(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('workbookId', uuidParamPipe('workbookId')) workbookId: string,
    @Body() body: CreateWorksheetDto,
  ) {
    return this.worksheetsService.createWorksheet(
      identity,
      { organizationId, projectId },
      workbookId,
      body,
    );
  }

  @Get('workbooks/:workbookId/worksheets')
  async findWorksheets(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('workbookId', uuidParamPipe('workbookId')) workbookId: string,
    @Query() query: PaginationQueryDto,
  ) {
    const { items, page } = await this.worksheetsService.findWorksheets(
      identity,
      { organizationId, projectId },
      workbookId,
      query,
    );
    return { worksheets: items, page };
  }

  @Get('worksheets/:worksheetId')
  findWorksheet(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('worksheetId', uuidParamPipe('worksheetId')) worksheetId: string,
  ) {
    return this.worksheetsService.findWorksheet(
      identity,
      { organizationId, projectId },
      worksheetId,
    );
  }

  /**
   * Solo lectura: `POST` porque el filtro es un árbol que no cabe bien en la
   * URL (plan worksheets 02, R10).
   */
  @Post('worksheets/:worksheetId/rows/query')
  @HttpCode(200)
  queryRows(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('worksheetId', uuidParamPipe('worksheetId')) worksheetId: string,
    @Body() body: QueryRowsDto,
  ) {
    return this.rowsService.query(
      identity,
      { organizationId, projectId },
      worksheetId,
      body,
    );
  }
}
