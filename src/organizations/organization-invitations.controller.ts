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
import { OrganizationInvitationsService } from './organization-invitations.service.js';
import { AcceptInvitationDto, InviteMemberDto } from './organizations.dto.js';

@Controller()
@UseGuards(DescopeSessionGuard)
export class OrganizationInvitationsController {
  constructor(
    private readonly invitationsService: OrganizationInvitationsService,
  ) {}

  /** El token solo aparece en esta respuesta. */
  @Post('organizations/:organizationId/invitations')
  invite(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Body() body: InviteMemberDto,
  ) {
    return this.invitationsService.invite(identity, organizationId, body);
  }

  @Get('organizations/:organizationId/invitations')
  async findPending(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Query() query: PaginationQueryDto,
  ) {
    const { items, page } = await this.invitationsService.findPending(
      identity,
      organizationId,
      query,
    );
    return { invitations: items, page };
  }

  @Delete('organizations/:organizationId/invitations/:invitationId')
  @HttpCode(204)
  async revoke(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('invitationId', uuidParamPipe('invitationId'))
    invitationId: string,
  ) {
    await this.invitationsService.revoke(
      identity,
      organizationId,
      invitationId,
    );
  }

  @Post('invitations/accept')
  accept(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Body() body: AcceptInvitationDto,
  ) {
    return this.invitationsService.accept(identity, body.token);
  }
}
