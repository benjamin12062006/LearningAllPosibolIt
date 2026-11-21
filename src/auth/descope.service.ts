import { Injectable } from '@nestjs/common';
import DescopeClient, { type AuthenticationInfo } from '@descope/node-sdk';

@Injectable()
export class DescopeService {
  private readonly projectId: string;
  private readonly client: ReturnType<typeof DescopeClient>;

  constructor() {
    const projectId = process.env.DESCOPE_PROJECT_ID?.trim();
    if (!projectId) {
      throw new Error(
        'Falta DESCOPE_PROJECT_ID. Configura el Project ID de Descope en el entorno.',
      );
    }
    this.projectId = projectId;
    this.client = DescopeClient({ projectId });
  }

  async validateMcpAccess(
    jwt: string,
    audience: string,
    issuer: string,
  ): Promise<AuthenticationInfo['token']> {
    return this.validateIntegrationAccess(jwt, audience, issuer);
  }

  async validateIntegrationAccess(
    jwt: string,
    audience: string,
    issuer: string,
  ): Promise<AuthenticationInfo['token']> {
    const { token } = await this.client.validateJwt(jwt, { audience });
    // El SDK normaliza iss al ID del proyecto. Comprueba el issuer original
    // del JWT ya verificado antes de usar esa identidad normalizada.
    const claims: unknown = JSON.parse(
      Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'),
    );
    if (
      !claims ||
      typeof claims !== 'object' ||
      !('iss' in claims) ||
      claims.iss !== issuer
    ) {
      throw new Error('Issuer OAuth inválido.');
    }
    return token;
  }

  async validateSession(sessionToken: string): Promise<AuthenticationInfo> {
    const session = await this.client.validateSession(sessionToken, {
      audience: this.projectId,
    });
    const resource = process.env.MCP_OAUTH_RESOURCE_URL?.trim();
    const audiences = [session.token.aud].flat();
    const scope = session.token.scope;
    const isMcpScope =
      typeof scope === 'string' &&
      scope.split(/\s+/u).some((value) => value.startsWith('ktsu:mcp:'));
    const cliResource = process.env.CLI_OAUTH_RESOURCE_URL?.trim();
    const isCliScope =
      typeof scope === 'string' &&
      scope.split(/\s+/u).some((value) => value.startsWith('ktsu:cli:'));
    const isCliClient = Boolean(
      process.env.CLI_OAUTH_CLIENT_ID &&
      session.token.azp === process.env.CLI_OAUTH_CLIENT_ID.trim(),
    );
    if (
      isMcpScope ||
      isCliScope ||
      isCliClient ||
      (resource && audiences.includes(resource)) ||
      (cliResource && audiences.includes(cliResource))
    ) {
      throw new Error(
        'El token OAuth de una integración no es una sesión web.',
      );
    }
    return session;
  }
}
