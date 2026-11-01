import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { AuthenticationInfo } from '@descope/node-sdk';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import type { AuthenticatedIdentity } from './authenticated-request.js';
import { DescopeService } from './descope.service.js';
import { requestOf } from './request-context.js';

@Injectable()
export class DescopeSessionGuard implements CanActivate {
  constructor(private readonly descopeService: DescopeService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = requestOf(context);
    const sessionToken = this.readBearerToken(request.headers.authorization);

    try {
      const { token } = await this.descopeService.validateSession(sessionToken);
      request.authenticatedIdentity = this.buildIdentity(token);
      return true;
    } catch {
      throw apiError(ErrorCodes.AUTH_SESSION_INVALID);
    }
  }

  private readBearerToken(authorization: string | undefined): string {
    const match = authorization?.match(/^Bearer ([^\s]+)$/i);
    if (!match) {
      throw apiError(ErrorCodes.AUTH_SESSION_REQUIRED);
    }
    return match[1];
  }

  private buildIdentity(
    token: AuthenticationInfo['token'],
  ): AuthenticatedIdentity {
    const identity = {
      subject: this.readRequiredClaim(token.sub),
      issuer: this.readRequiredClaim(token.iss),
    };

    const email = this.readOptionalClaim(token.email);
    if (email) {
      return Object.freeze({ ...identity, email });
    }
    return Object.freeze(identity);
  }

  private readRequiredClaim(value: unknown): string {
    if (typeof value !== 'string' || value.length === 0) {
      throw apiError(ErrorCodes.AUTH_SESSION_INVALID);
    }
    return value;
  }

  private readOptionalClaim(value: unknown): string | undefined {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
    return undefined;
  }
}
