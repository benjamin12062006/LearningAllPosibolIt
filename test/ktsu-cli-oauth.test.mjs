import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { oauthSession } from '../skills/ktsu-cli/scripts/ktsu-cli/lib/oauth.mjs';

const api = 'https://ktsu.example';
const projectId = 'e1705025-6466-4bef-abd8-5cb39d11e936';
const issuer = 'https://descope.example/v1/apps/ktsu';
const resource = 'https://ktsu.example/api/v1/integrations';
const realFetch = globalThis.fetch;
const previousConfigHome = process.env.XDG_CONFIG_HOME;
const configHome = await mkdtemp(join(tmpdir(), 'ktsu-cli-oauth-test-'));
process.env.XDG_CONFIG_HOME = configHome;

after(async () => {
  if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousConfigHome;
  await rm(configHome, { force: true, recursive: true });
});

test('usa PKCE S256, ignora un state incorrecto, renueva una sola vez y revoca al salir', async (context) => {
  let saved;
  const store = {
    read: async () => saved,
    write: async (value) => {
      saved = value;
    },
    remove: async () => {
      saved = undefined;
    },
  };
  const posted = [];
  let redirect;
  let loginQuery;
  context.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (url === `${api}/api/v1/integrations/oauth`) {
      return Response.json({ clientId: 'public-cli', issuer, resource });
    }
    if (url === `${issuer}/.well-known/openid-configuration`) {
      return Response.json({
        issuer,
        authorization_endpoint: 'https://descope.example/authorize',
        token_endpoint: 'https://descope.example/token',
        revocation_endpoint: 'https://descope.example/revoke',
      });
    }
    if (url === 'https://descope.example/token') {
      const fields = Object.fromEntries(options.body);
      posted.push(fields);
      assert.equal(fields.resource, resource);
      assert.equal(fields.client_id, 'public-cli');
      if (fields.grant_type === 'authorization_code') {
        assert.equal(fields.code, 'test-code');
        assert.equal(fields.redirect_uri, redirect);
        assert.equal(
          createHash('sha256').update(fields.code_verifier).digest('base64url'),
          loginQuery.get('code_challenge'),
        );
        return Response.json({
          expires_in: 600,
          access_token: 'access.one',
          refresh_token: 'refresh.one',
          token_type: 'Bearer',
        });
      }
      assert.equal(fields.refresh_token, 'refresh.one');
      return Response.json({
        expires_in: 600,
        access_token: 'access.two',
        refresh_token: 'refresh.two',
        token_type: 'Bearer',
      });
    }
    if (url === `${api}/api/v1/integrations/session`) {
      assert.equal(options.headers.Authorization, 'Bearer access.one');
      assert.equal(options.headers['X-Ktsu-Cli-Project'], projectId);
      return Response.json({ projectId, authentication: 'oauth' });
    }
    if (url === 'https://descope.example/revoke') {
      posted.push(Object.fromEntries(options.body));
      return new Response(null, { status: 200 });
    }
    throw new Error('Destino inesperado');
  });

  const session = oauthSession(api, projectId, {
    store,
    async openBrowser(url) {
      loginQuery = new URL(url).searchParams;
      redirect = loginQuery.get('redirect_uri');
      assert.match(redirect, /^http:\/\/127\.0\.0\.1:\d+\/callback$/u);
      assert.equal(loginQuery.get('scope'), 'ktsu:cli:read');
      assert.equal(loginQuery.get('code_challenge_method'), 'S256');
      const invalid = await realFetch(
        `${redirect}?state=incorrect&code=test-code`,
      );
      assert.equal(invalid.status, 400);
      const valid = await realFetch(
        `${redirect}?state=${loginQuery.get('state')}&code=test-code`,
      );
      assert.equal(valid.status, 200);
    },
  });

  assert.deepEqual(await session.login(true), {
    projectId,
    authentication: 'oauth',
  });
  assert.equal(await session.token(), 'access.one');
  saved.expiresAt = Date.now();
  assert.deepEqual(await Promise.all([session.token(), session.token()]), [
    'access.two',
    'access.two',
  ]);
  assert.equal(
    posted.filter((call) => call.grant_type === 'refresh_token').length,
    1,
  );
  assert.deepEqual(await session.logout(), {
    signedOut: true,
    remoteRevoked: true,
  });
  assert.deepEqual(
    posted
      .slice(-2)
      .map(({ token }) => token)
      .sort(),
    ['access.two', 'refresh.two'],
  );
  assert.equal(saved, undefined);
});
