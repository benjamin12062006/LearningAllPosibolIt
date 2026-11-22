import { Inject, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { DescopeService } from '../auth/descope.service.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { UsersService } from '../users/users.service.js';
import { IntegrationsRepository } from './integrations.repository.js';
import type { Delegation } from './integrations.types.js';
import {
  MCP_OAUTH_CONFIG,
  MCP_PREPARE_SCOPE,
  MCP_READ_SCOPE,
  requireMcpOAuth,
  type McpOAuthConfig,
} from './mcp-oauth-config.js';

const OAUTH_BEARER = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/i;

@Injectable()
export class McpOAuthAccess {
  constructor(
    private readonly descope: DescopeService,
    private readonly users: UsersService,
    private readonly repository: IntegrationsRepository,
    @Inject(MCP_OAUTH_CONFIG)
    private readonly configured: McpOAuthConfig | null,
  ) {}

  async authenticate(
    header: string,
    now: Date,
    project?: string,
  ): Promise<Delegation> {
    const config = requireMcpOAuth(this.configured);
    if (project !== undefined && !isUUID(project)) {
      throw apiError(ErrorCodes.VALIDATION_FAILED);
    }
    const projectId = project?.toLowerCase() ?? config.scope.projectId;
    const token = await this.verify(header, config);
    const { sub, iss, iat, exp, scope } = token;
    const nowSeconds = now.getTime() / 1000;
    if (
      typeof sub !== 'string' ||
      !sub ||
      typeof iss !== 'string' ||
      !iss ||
      typeof exp !== 'number' ||
      !Number.isSafeInteger(exp) ||
      exp <= nowSeconds ||
      typeof iat !== 'number' ||
      !Number.isSafeInteger(iat) ||
      iat > nowSeconds ||
      iat <= 0 ||
      exp - iat > 3600
    ) {
      throw apiError(ErrorCodes.INTEGRATION_CREDENTIAL_INVALID);
    }
    const scopes = typeof scope === 'string' ? scope.split(/\s+/u) : [];
    if (!scopes.includes(MCP_READ_SCOPE)) {
      throw apiError(ErrorCodes.INTEGRATION_OAUTH_SCOPE_REQUIRED);
    }

    const identity = { issuer: iss, subject: sub };
    const actor = await this.users.findCurrent(identity);
    const grant = await this.repository.oauthGrantForProject(
      projectId,
      actor.id,
      config.resource,
      now,
      'mcp_oauth',
    );
    const legacyOrganization =
      project === undefined ? config.scope.organizationId : undefined;
    if (
      !grant ||
      (legacyOrganization && grant.organizationId !== legacyOrganization)
    ) {
      throw apiError(ErrorCodes.INTEGRATION_OAUTH_GRANT_REQUIRED);
    }
    // Una nueva concesión requiere un JWT emitido después de conceder el acceso.
    if (iat * 1000 < Date.parse(grant.createdAt)) {
      throw apiError(ErrorCodes.INTEGRATION_CREDENTIAL_INVALID);
    }
    return {
      credentialId: grant.id,
      scope: { organizationId: grant.organizationId, projectId },
      actorId: actor.id,
      identity,
      canPrepare: grant.canPrepare && scopes.includes(MCP_PREPARE_SCOPE),
      expiresAt: new Date(
        Math.min(exp * 1000, Date.parse(grant.expiresAt)),
      ).toISOString(),
    };
  }

  private async verify(header: string, config: McpOAuthConfig) {
    const jwt =
      header.length <= 8192 ? OAUTH_BEARER.exec(header)?.[1] : undefined;
    if (!jwt) {
      throw apiError(ErrorCodes.INTEGRATION_CREDENTIAL_INVALID);
    }
    try {
      return await this.descope.validateMcpAccess(
        jwt,
        config.resource,
        config.issuer,
      );
    } catch {
      throw apiError(ErrorCodes.INTEGRATION_CREDENTIAL_INVALID);
    }
  }
}
