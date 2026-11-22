import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProposalDecisions } from '../agent-runs/proposal-decisions.js';
import { toProposalView } from '../agent-runs/agent-runs.repository.js';
import {
  AGENT_RUN_OPTIONS,
  type AgentRunOptions,
  type ProposalView,
} from '../agent-runs/agent-runs.types.js';
import { credentialHash } from '../agent-runs/run-credential.js';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { parseIdempotencyKey } from '../common/http/idempotency-key.js';
import { PAGINATION } from '../common/http/pagination.js';
import { can } from '../organizations/organization-roles.js';
import { assertProjectPermission } from '../projects/project-access.js';
import { UsersService } from '../users/users.service.js';
import type { ProjectScope } from '../worksheets/worksheets.types.js';
import {
  readPublishedSkill,
  type PublishedSkillName,
} from './published-skills.js';
import { integrationToken, newIntegrationSecret } from './integration-token.js';
import type {
  CredentialPageDto,
  IssueCredentialDto,
} from './integrations.dto.js';
import { IntegrationsRepository } from './integrations.repository.js';
import {
  EXTERNAL_CONTEXT,
  INTEGRATION_LIMITS,
  type CredentialView,
} from './integrations.types.js';

import {
  MCP_OAUTH_CONFIG,
  requireMcpOAuth,
  type McpOAuthConfig,
} from './mcp-oauth-config.js';

import {
  CLI_OAUTH_CONFIG,
  requireCliOAuth,
  type CliOAuthConfig,
} from './cli-oauth-config.js';

const HOUR_MS = 60 * 60_000;

/** Administración de Integraciones mediante la sesión humana de Descope. */
@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly repository: IntegrationsRepository,
    private readonly users: UsersService,
    private readonly decisions: ProposalDecisions,
    @Inject(AGENT_RUN_OPTIONS)
    private readonly options: AgentRunOptions,
    @Inject(MCP_OAUTH_CONFIG) private readonly oauth: McpOAuthConfig | null,
    @Inject(CLI_OAUTH_CONFIG) private readonly cliOAuth: CliOAuthConfig | null,
  ) {}

  /** Los archivos exactos de una skill publicada, para un miembro del proyecto. */
  async publishedSkill(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    name: PublishedSkillName,
  ) {
    const actor = await this.users.findCurrent(identity);
    await this.repository.requireMember(scope, actor.id);
    return readPublishedSkill(name);
  }

  async list(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    query: CredentialPageDto,
  ) {
    const actor = await this.users.findCurrent(identity);
    const access = await this.repository.requireMember(scope, actor.id);
    const ownerId = can(access.role, 'members.manage') ? null : actor.id;
    const page = await this.repository.list(
      scope,
      ownerId,
      {
        limit: query.limit ?? PAGINATION.defaultLimit,
        cursor: query.cursor,
      },
      this.options.clock(),
    );
    const oauthMatchesProject =
      this.oauth?.scope.organizationId === scope.organizationId &&
      this.oauth.scope.projectId === scope.projectId;
    const resource = this.oauth?.resource;
    const oauthResourceUrl =
      resource && !access.isArchived
        ? oauthMatchesProject
          ? resource
          : mcpProjectUrl(resource, scope.projectId)
        : null;
    return {
      ...page,
      oauthResourceUrl,
      ...(this.cliOAuth && !access.isArchived && { cliOAuthAvailable: true }),
    };
  }

  /** El secreto completo se devuelve una vez. La repetición devuelve 409. */
  async issue(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    input: IssueCredentialDto,
    idempotencyKey: string | undefined,
    requestId: string | undefined,
  ): Promise<{ credential: CredentialView; token?: string }> {
    const actor = await this.users.findCurrent(identity);
    const now = this.options.clock();
    let resource: string | null = null;
    if (input.audience === 'mcp_oauth')
      resource = requireMcpOAuth(this.oauth).resource;
    if (input.audience === 'cli_oauth')
      resource = requireCliOAuth(this.cliOAuth).resource;
    const secret = newIntegrationSecret();
    const credential = await this.repository.insert(
      scope,
      actor.id,
      {
        label: input.label,
        audience: input.audience,
        resourceUrl: resource,
        canPrepare: input.capabilities.includes('prepare'),
        secretHash: credentialHash(secret),
        expiresAt: expiryOf(input.expiresAt, now),
        issueKey: parseIdempotencyKey(idempotencyKey),
      },
      now,
    );
    this.audit('issued', credential.id, actor.id, scope, requestId);
    if (resource) return { credential };
    return { credential, token: integrationToken(credential.id, secret) };
  }

  async revoke(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    credentialId: string,
    requestId: string | undefined,
  ): Promise<void> {
    const actor = await this.users.findCurrent(identity);
    await this.repository.revoke(
      scope,
      credentialId,
      actor.id,
      this.options.clock(),
    );
    this.audit('revoked', credentialId, actor.id, scope, requestId);
  }

  async findProposal(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    proposalId: string,
  ): Promise<ProposalView> {
    const actor = await this.users.findCurrent(identity);
    await this.repository.requireMember(scope, actor.id);
    return toProposalView(
      await this.repository.findOwnerProposal(scope, actor.id, proposalId),
    );
  }

  async confirm(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    proposalId: string,
    proposalHash: string,
  ): Promise<ProposalView> {
    const actor = await this.users.findCurrent(identity);
    const access = await this.repository.requireMember(scope, actor.id);
    assertProjectPermission(access, 'ai.use');
    const load = () =>
      this.repository.findOwnerProposal(scope, actor.id, proposalId);
    const { audience } = await load();
    const fromCli = audience === 'cli' || audience === 'cli_oauth';
    return this.decisions.confirm(
      { identity, actorId: actor.id, scope, context: EXTERNAL_CONTEXT },
      load,
      proposalHash,
      (proposal, permission) =>
        this.repository.beginConfirm(
          scope,
          actor.id,
          proposal,
          permission,
          this.options.clock,
        ),
      fromCli ? 'record' : 'retry',
    );
  }

  async reject(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    proposalId: string,
    proposalHash: string,
  ): Promise<ProposalView> {
    const actor = await this.users.findCurrent(identity);
    await this.repository.requireMember(scope, actor.id);
    return this.decisions.reject(
      () => this.repository.findOwnerProposal(scope, actor.id, proposalId),
      proposalHash,
    );
  }

  private audit(
    action: 'issued' | 'revoked',
    credentialId: string,
    actorId: string,
    scope: ProjectScope,
    requestId: string | undefined,
  ) {
    this.logger.log({
      code: 'INTEGRATION_CREDENTIAL',
      action,
      credentialId,
      actorId,
      ...scope,
      requestId,
    });
  }
}

function expiryOf(expiresAt: string | undefined, now: Date): Date {
  if (!expiresAt) {
    return new Date(now.getTime() + INTEGRATION_LIMITS.defaultHours * HOUR_MS);
  }
  const expiryMs = Date.parse(expiresAt);
  const validExpiry =
    expiryMs > now.getTime() &&
    expiryMs <= now.getTime() + INTEGRATION_LIMITS.maxHours * HOUR_MS;
  if (!validExpiry) {
    throw apiError(ErrorCodes.INTEGRATION_EXPIRY_INVALID);
  }
  return new Date(expiryMs);
}

function mcpProjectUrl(resource: string, projectId: string) {
  const url = new URL(resource);
  url.searchParams.set('project', projectId);
  return url.href;
}
