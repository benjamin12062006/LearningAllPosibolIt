import { Inject, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { DescopeService } from '../auth/descope.service.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { UsersService } from '../users/users.service.js';
import {
  CLI_OAUTH_CONFIG,
  CLI_PREPARE_SCOPE,
  CLI_READ_SCOPE,
  requireCliOAuth,
  type CliOAuthConfig,
} from './cli-oauth-config.js';
import { IntegrationsRepository } from './integrations.repository.js';
import type { Delegation } from './integrations.types.js';

const OAUTH_BEARER = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/i;
const MAX_ACCESS_SECONDS = 3600;

@Injectable()
export class CliOAuthAccess {
  constructor(
    private readonly descope: DescopeService,
    private readonly users: UsersService,
    private readonly repository: IntegrationsRepository,
    @Inject(CLI_OAUTH_CONFIG) private readonly config: CliOAuthConfig | null,
  ) {}

  metadata() {
    return {
      ...requireCliOAuth(this.config),
      scopes: [CLI_READ_SCOPE, CLI_PREPARE_SCOPE],
    };
  }

  async authenticate(
    header: string | undefined,
    projectId: string,
    now: Date,
  ): Promise<Delegation> {
    const config = requireCliOAuth(this.config);
    if (!isUUID(projectId))
      throw apiError(ErrorCodes.INTEGRATION_CREDENTIAL_INVALID);
    const claims = await this.verify(header, config);
    const { iss, sub, azp, aud, iat, exp, scope } = claims;
    const nowSeconds = now.getTime() / 1000;
    const audiences = Array.isArray(aud) ? aud : [aud];
    if (
      azp !== config.clientId ||
      !audiences.includes(config.resource) ||
      typeof iss !== 'string' ||
      !iss ||
      typeof sub !== 'string' ||
      !sub ||
      typeof iat !== 'number' ||
      !Number.isSafeInteger(iat) ||
      iat <= 0 ||
      iat > nowSeconds ||
      typeof exp !== 'number' ||
      !Number.isSafeInteger(exp) ||
      exp <= nowSeconds ||
      exp - iat > MAX_ACCESS_SECONDS
    ) {
      throw apiError(ErrorCodes.INTEGRATION_CREDENTIAL_INVALID);
    }

    const scopes = typeof scope === 'string' ? scope.split(/\s+/u) : [];
    if (!scopes.includes(CLI_READ_SCOPE)) {
      throw apiError(ErrorCodes.INTEGRATION_OAUTH_SCOPE_REQUIRED);
    }

    const identity = { issuer: iss, subject: sub };
    const actor = await this.users.findCurrent(identity);
    const grant = await this.repository.cliGrant(
      projectId,
      actor.id,
      config.resource,
      now,
    );
    if (!grant) throw apiError(ErrorCodes.INTEGRATION_OAUTH_GRANT_REQUIRED);
    if (iat < Math.floor(Date.parse(grant.createdAt) / 1000)) {
      throw apiError(ErrorCodes.INTEGRATION_CREDENTIAL_INVALID);
    }
    return {
      credentialId: grant.id,
      identity,
      actorId: actor.id,
      scope: { organizationId: grant.organizationId, projectId },
      canPrepare: grant.canPrepare && scopes.includes(CLI_PREPARE_SCOPE),
      expiresAt: new Date(
        Math.min(exp * 1000, Date.parse(grant.expiresAt)),
      ).toISOString(),
      grantExpiresAt: grant.expiresAt,
    };
  }

  private async verify(header: string | undefined, config: CliOAuthConfig) {
    const jwt =
      header && header.length <= 8192
        ? OAUTH_BEARER.exec(header)?.[1]
        : undefined;
    if (!jwt) throw apiError(ErrorCodes.INTEGRATION_CREDENTIAL_INVALID);
    try {
      return await this.descope.validateIntegrationAccess(
        jwt,
        config.resource,
        config.issuer,
      );
    } catch {
      throw apiError(ErrorCodes.INTEGRATION_CREDENTIAL_INVALID);
    }
  }
}
