import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import {
  ChangeMemberRoleDto,
  CreateOrganizationDto,
} from './organizations.dto.js';
import { OrganizationsService } from './organizations.service.js';

/**
 * Organizaciones y sus miembros. Las invitaciones están en
 * `OrganizationInvitationsController`; `GET /organizations/:organizationId/projects`,
 * en `ProjectMembershipController`, porque lee proyectos.
 */
@Controller('organizations')
@UseGuards(DescopeSessionGuard)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get()
  async findAll(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Query() query: PaginationQueryDto,
  ) {
    const { items, page } = await this.organizationsService.findAll(
      identity,
      query,
    );
    return { organizations: items, page };
  }

  @Post()
  create(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Body() body: CreateOrganizationDto,
  ) {
    return this.organizationsService.create(identity, body.name);
  }

  @Get(':organizationId')
  findOne(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
  ) {
    return this.organizationsService.findOne(identity, organizationId);
  }

  /** Archivada se lee igual, pero no admite cambios de miembros ni invitaciones. */
  @Post(':organizationId/archive')
  @HttpCode(200)
  archive(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
  ) {
    return this.organizationsService.setArchived(
      identity,
      organizationId,
      true,
    );
  }

  @Post(':organizationId/restore')
  @HttpCode(200)
  restore(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
  ) {
    return this.organizationsService.setArchived(
      identity,
      organizationId,
      false,
    );
  }

  @Get(':organizationId/members')
  async findMembers(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Query() query: PaginationQueryDto,
  ) {
    const { items, page } = await this.organizationsService.findMembers(
      identity,
      organizationId,
      query,
    );
    return { members: items, page };
  }

  @Patch(':organizationId/members/:userId')
  async changeRole(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('userId', uuidParamPipe('userId')) userId: string,
    @Body() body: ChangeMemberRoleDto,
  ) {
    const member = await this.organizationsService.changeRole(
      identity,
      organizationId,
      userId,
      body.role,
    );
    return { member };
  }

  /** Quitar a otra persona o salir uno mismo (con su propio `userId`). */
  @Delete(':organizationId/members/:userId')
  @HttpCode(204)
  async removeMember(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('userId', uuidParamPipe('userId')) userId: string,
  ) {
    await this.organizationsService.removeMember(
      identity,
      organizationId,
      userId,
    );
  }
}
