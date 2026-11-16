import { expect, it, jest } from '@jest/globals';
import { generateKeyPairSync, sign } from 'node:crypto';
import { DescopeService } from '../../../src/auth/descope.service.js';

it('valida firma, audiencia e issuer exactos y reserva la sesión web para Descope web', async () => {
  const project = 'P' + '1'.repeat(27);
  const issuer = `https://api.descope.com/v1/apps/agentic/${project}/MStest`;
  const resource = 'https://mcp.ktsu.example/mcp';
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const key = {
    ...publicKey.export({ format: 'jwk' }),
    kid: 'mcp-test',
    alg: 'RS256',
    use: 'sig',
  };
  const env = jest.replaceProperty(process, 'env', {
    ...process.env,
    DESCOPE_PROJECT_ID: project,
    MCP_OAUTH_RESOURCE_URL: resource,
  });
  const fetch = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => Response.json({ keys: [key] }));
  const now = Math.floor(Date.now() / 1000);

  function jwt(iss: string, aud: string | string[], scope?: string) {
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'RS256', kid: key.kid })}.${encode({ iss, aud, sub: 'U-demo', iat: now, exp: now + 60, scope })}`;
    return `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')}`;
  }

  try {
    const service = new DescopeService();
    const delegated = jwt(issuer, [project, resource], 'ktsu:mcp:read');
    await expect(
      service.validateMcpAccess(delegated, resource, issuer),
    ).resolves.toMatchObject({ iss: project, sub: 'U-demo' });
    await expect(
      service.validateMcpAccess(
        delegated,
        'https://another.example/mcp',
        issuer,
      ),
    ).rejects.toThrow();
    await expect(
      service.validateMcpAccess(jwt(project, resource), resource, issuer),
    ).rejects.toThrow();
    await expect(
      service.validateMcpAccess(delegated + 'x', resource, issuer),
    ).rejects.toThrow();
    await expect(service.validateSession(delegated)).rejects.toThrow();
    await expect(
      service.validateSession(jwt(project, project)),
    ).resolves.toBeDefined();
    expect(fetch).toHaveBeenCalled();
  } finally {
    env.restore();
    fetch.mockRestore();
  }
});
