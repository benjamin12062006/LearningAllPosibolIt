import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';

export const CLI_OAUTH_CONFIG = Symbol('CLI_OAUTH_CONFIG');
export const CLI_READ_SCOPE = 'ktsu:cli:read';
export const CLI_PREPARE_SCOPE = 'ktsu:cli:prepare';

export type CliOAuthConfig = Readonly<{
  clientId: string;
  issuer: string;
  resource: string;
}>;

export function cliOAuthConfigFrom(
  env: NodeJS.ProcessEnv,
): CliOAuthConfig | null {
  const clientId = env.CLI_OAUTH_CLIENT_ID?.trim();
  const issuer = env.CLI_OAUTH_ISSUER?.trim();
  const resource = env.CLI_OAUTH_RESOURCE_URL?.trim();
  if (!clientId && !issuer && !resource) return null;
  if (
    !clientId ||
    !/^[A-Za-z0-9_-]{1,128}$/u.test(clientId) ||
    !issuer ||
    !isHttpsIdentifier(issuer) ||
    issuer.endsWith('/') ||
    !resource ||
    !isHttpsIdentifier(resource) ||
    resource === env.MCP_OAUTH_RESOURCE_URL
  ) {
    throw new Error(
      'Configura el Client ID, issuer HTTPS y Resource HTTPS propios de la CLI.',
    );
  }
  return { clientId, issuer, resource };
}

export function requireCliOAuth(config: CliOAuthConfig | null): CliOAuthConfig {
  if (!config) throw apiError(ErrorCodes.INTEGRATIONS_UNAVAILABLE);
  return config;
}

function isHttpsIdentifier(value: string): boolean {
  const url = URL.parse(value);
  return Boolean(
    url &&
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.href === value,
  );
}
