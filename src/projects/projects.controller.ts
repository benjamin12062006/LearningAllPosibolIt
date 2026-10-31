import { ErrorCodes } from '../common/http/error-codes.js';
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/authenticated-request.js';
import { DescopeSessionGuard } from '../auth/descope-session.guard.js';
import { CreateProjectDto, UpdateProjectDto } from './projects.dto.js';
import { ProjectsService } from './projects.service.js';
import { apiError } from '../common/http/api-error.js';
import { PaginationQueryDto } from '../common/http/pagination.js';
import { uuidParamPipe } from '../common/http/validation-errors.js';

@Controller('projects')
@UseGuards(DescopeSessionGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  async findAll(
    @Req() request: AuthenticatedRequest,
    @Query() query: PaginationQueryDto,
  ) {
    const { items, page } = await this.projectsService.findAll(
      identityOf(request),
      query,
    );
    return { projects: items, page };
  }

  @Post()
  async create(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreateProjectDto,
  ) {
    return {
      project: await this.projectsService.create(identityOf(request), body),
    };
  }

  @Get(':id')
  async findOne(
    @Req() request: AuthenticatedRequest,
    @Param('id', uuidParamPipe('id')) id: string,
  ) {
    return {
      project: await this.projectsService.findOwned(identityOf(request), id),
    };
  }

  @Patch(':id')
  async update(
    @Req() request: AuthenticatedRequest,
    @Param('id', uuidParamPipe('id')) id: string,
    @Body() body: UpdateProjectDto,
  ) {
    return {
      project: await this.projectsService.update(identityOf(request), id, body),
    };
  }
}

function identityOf(request: AuthenticatedRequest) {
  if (!request.authenticatedIdentity) {
    throw apiError(ErrorCodes.INTERNAL_ERROR);
  }
  return request.authenticatedIdentity;
}
