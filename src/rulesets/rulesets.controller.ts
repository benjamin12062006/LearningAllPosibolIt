import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { CurrentIdentity } from '../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../auth/descope-session.guard.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { PaginationQueryDto } from '../common/http/pagination.js';
import { uuidParamPipe } from '../common/http/validation-errors.js';
import { CreateRulesetDto } from './rulesets.dto.js';
import { RulesetsService } from './rulesets.service.js';

/** Una revisión que no es un número entero no puede existir: 404 como cualquier otra. */
const revisionParamPipe = new ParseIntPipe({
  exceptionFactory: () => apiError(ErrorCodes.RULESET_NOT_FOUND),
});

@Controller('projects/:projectId/rulesets')
@UseGuards(DescopeSessionGuard)
export class RulesetsController {
  constructor(private readonly rulesets: RulesetsService) {}

  @Post()
  async create(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Body() body: CreateRulesetDto,
  ) {
    return { ruleset: await this.rulesets.create(identity, projectId, body) };
  }

  @Get()
  async findAll(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Query() query: PaginationQueryDto,
  ) {
    const { items, page } = await this.rulesets.findAll(
      identity,
      projectId,
      query,
    );
    return { rulesets: items, page };
  }

  @Get(':revision')
  async findRevision(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('revision', revisionParamPipe) revision: number,
  ) {
    return {
      ruleset: await this.rulesets.findRevision(identity, projectId, revision),
    };
  }
}
