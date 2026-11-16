import { isUUID } from 'class-validator';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import type { ProjectScope } from '../worksheets/worksheets.types.js';

export const MCP_OAUTH_CONFIG = Symbol('MCP_OAUTH_CONFIG');
export const MCP_READ_SCOPE = 'ktsu:mcp:read';
export const MCP_PREPARE_SCOPE = 'ktsu:mcp:prepare';

export type McpOAuthConfig = Readonly<{
  resource: string;
  issuer: string;
  scope: ProjectScope;
}>;

export function mcpOAuthConfigFrom(
  env: Readonly<Record<string, string | undefined>>,
): McpOAuthConfig | null {
  const resource = env.MCP_OAUTH_RESOURCE_URL?.trim();
  if (!resource) {
    return null;
  }
  const issuer = env.MCP_OAUTH_ISSUER?.trim();
  const organizationId = env.MCP_OAUTH_ORGANIZATION_ID?.trim();
  const projectId = env.MCP_OAUTH_PROJECT_ID?.trim();
  if (
    !httpsUrl(resource, '/mcp') ||
    !issuer ||
    !httpsUrl(issuer) ||
    !organizationId ||
    !isUUID(organizationId) ||
    !projectId ||
    !isUUID(projectId)
  ) {
    throw new Error(
      'Configura la URL HTTPS /mcp, issuer Descope y ámbito de MCP OAuth.',
    );
  }
  return { resource, issuer, scope: { organizationId, projectId } };
}

export function requireMcpOAuth(
  config: McpOAuthConfig | null,
  scope?: ProjectScope,
): McpOAuthConfig {
  if (!config) {
    throw apiError(ErrorCodes.INTEGRATIONS_UNAVAILABLE);
  }
  if (
    scope &&
    (scope.projectId !== config.scope.projectId ||
      scope.organizationId !== config.scope.organizationId)
  ) {
    throw apiError(ErrorCodes.PROJECT_NOT_FOUND);
  }
  return config;
}

function httpsUrl(value: string, path?: string): boolean {
  const url = URL.parse(value);
  return Boolean(
    url &&
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    (!path || url.pathname === path) &&
    url.href === value,
  );
}
