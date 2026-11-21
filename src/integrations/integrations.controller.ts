import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ProposalDecisionDto } from '../agent-runs/agent-runs.dto.js';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { CurrentIdentity } from '../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../auth/descope-session.guard.js';
import type { RequestWithId } from '../common/http/request-id.js';
import { uuidParamPipe } from '../common/http/validation-errors.js';
import { CredentialPageDto, IssueCredentialDto } from './integrations.dto.js';
import { IntegrationsService } from './integrations.service.js';

/**
 * La pantalla Integraciones (plan 07, D3). `P` es
 * `/organizations/:organizationId/projects/:projectId`.
 */
@Controller('organizations/:organizationId/projects/:projectId/integrations')
@UseGuards(DescopeSessionGuard)
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get('cli-skill')
  @Header('Cache-Control', 'no-store')
  cliSkill(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
  ) {
    return this.integrations.cliSkill(identity, { organizationId, projectId });
  }

  @Get('credentials')
  list(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Query() query: CredentialPageDto,
  ) {
    return this.integrations.list(
      identity,
      { organizationId, projectId },
      query,
    );
  }

  /** El token solo sale en esta respuesta, que no se debe guardar en caché. */
  @Post('credentials')
  @Header('Cache-Control', 'no-store')
  issue(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: IssueCredentialDto,
    @Req() request: RequestWithId,
  ) {
    return this.integrations.issue(
      identity,
      { organizationId, projectId },
      body,
      idempotencyKey,
      request.requestId,
    );
  }

  @Post('credentials/:credentialId/revoke')
  @HttpCode(204)
  async revoke(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('credentialId', uuidParamPipe('credentialId')) credentialId: string,
    @Req() request: RequestWithId,
  ) {
    await this.integrations.revoke(
      identity,
      { organizationId, projectId },
      credentialId,
      request.requestId,
    );
  }

  @Get('proposals/:proposalId')
  async findProposal(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('proposalId', uuidParamPipe('proposalId')) proposalId: string,
  ) {
    const proposal = await this.integrations.findProposal(
      identity,
      { organizationId, projectId },
      proposalId,
    );
    return { proposal };
  }

  @Post('proposals/:proposalId/confirm')
  @HttpCode(200)
  async confirm(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('proposalId', uuidParamPipe('proposalId')) proposalId: string,
    @Body() body: ProposalDecisionDto,
  ) {
    const proposal = await this.integrations.confirm(
      identity,
      { organizationId, projectId },
      proposalId,
      body.proposalHash,
    );
    return { proposal };
  }

  @Post('proposals/:proposalId/reject')
  @HttpCode(200)
  async reject(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('proposalId', uuidParamPipe('proposalId')) proposalId: string,
    @Body() body: ProposalDecisionDto,
  ) {
    const proposal = await this.integrations.reject(
      identity,
      { organizationId, projectId },
      proposalId,
      body.proposalHash,
    );
    return { proposal };
  }
}
