import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { CurrentIdentity } from '../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../auth/descope-session.guard.js';
import { PaginationQueryDto } from '../common/http/pagination.js';
import { uuidParamPipe } from '../common/http/validation-errors.js';
import { CreateProjectDto, UpdateProjectDto } from './projects.dto.js';
import { ProjectsService } from './projects.service.js';

/**
 * `DELETE /projects/:id` está en `CatalogImportController`: borrar un proyecto
 * también borra sus importaciones y sus archivos, que son de ese módulo.
 */
@Controller('projects')
@UseGuards(DescopeSessionGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  async findAll(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Query() query: PaginationQueryDto,
  ) {
    const { items, page } = await this.projectsService.findAll(identity, query);
    return { projects: items, page };
  }

  /** `Idempotency-Key` opcional: con ella, repetir la petición no crea otro proyecto. */
  @Post()
  async create(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreateProjectDto,
  ) {
    const project = await this.projectsService.create(
      identity,
      body,
      idempotencyKey,
    );
    return { project };
  }

  @Get(':id')
  async findOne(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('id', uuidParamPipe('id')) id: string,
  ) {
    return { project: await this.projectsService.findOwned(identity, id) };
  }

  @Patch(':id')
  async update(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('id', uuidParamPipe('id')) id: string,
    @Body() body: UpdateProjectDto,
  ) {
    return { project: await this.projectsService.update(identity, id, body) };
  }
}
