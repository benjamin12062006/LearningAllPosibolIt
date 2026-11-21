import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CliError, integrationRequest, trustedUrl } from './http.mjs';
import { keychainFor } from './keychain.mjs';

const HOST = '127.0.0.1';
const CALLBACK = '/callback';
const READ_SCOPE = 'ktsu:cli:read';
const PREPARE_SCOPE = 'ktsu:cli:prepare';
const LOGIN_TIMEOUT = 5 * 60_000;
const CLOCK_MARGIN = 30_000;
const MAX_CREDENTIAL = 8000;

export function oauthSession(
  base,
  project,
  { store = keychainFor(base, project), openBrowser = launchBrowser } = {},
) {
  let config;
  const getConfig = async () => (config ??= await oauthConfig(base));
  return {
    async login(readOnly) {
      const settings = await getConfig();
      const proof = createProof();
      const scope = readOnly ? READ_SCOPE : `${READ_SCOPE} ${PREPARE_SCOPE}`;
      const { code, redirectUri } = await authorize(
        settings,
        proof,
        scope,
        openBrowser,
      );
      const tokens = await exchange(settings, {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: proof.verifier,
      });
      const session = await integrationRequest(base, '/session', {
        project,
        token: tokens.accessToken,
      });
      if (
        session?.projectId !== project ||
        session.authentication !== 'oauth'
      ) {
        throw new CliError(
          'La API no confirmó la sesión OAuth del proyecto seleccionado.',
        );
      }
      try {
        await withSessionLock(base, project, () => store.write(tokens));
      } catch (error) {
        await revoke(settings, tokens);
        throw error;
      }
      return session;
    },

    async token() {
      const saved = await store.read();
      if (!saved) throw needLogin();
      if (hasLiveAccess(saved)) return saved.accessToken;

      return withSessionLock(base, project, async () => {
        const latest = await store.read();
        if (!latest) throw needLogin();
        if (hasLiveAccess(latest)) return latest.accessToken;
        if (!isToken(latest.refreshToken)) throw needLogin();
        const settings = await getConfig();
        const renewed = await exchange(
          settings,
          {
            grant_type: 'refresh_token',
            refresh_token: latest.refreshToken,
          },
          latest.refreshToken,
        );
        await store.write(renewed);
        return renewed.accessToken;
      });
    },

    async logout() {
      return withSessionLock(base, project, async () => {
        const saved = await store.read();
        if (!saved) return { signedOut: true, hadSession: false };
        await store.remove();
        const settings = await getConfig().catch(() => null);
        return {
          signedOut: true,
          remoteRevoked: settings ? await revoke(settings, saved) : false,
        };
      });
    },
  };
}

function createProof() {
  const verifier = randomBytes(32).toString('base64url');
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
    state: randomBytes(32).toString('base64url'),
  };
}

async function authorize(settings, proof, scope, openBrowser) {
  let finish;
  let fail;
  let redirectUri;
  const received = new Promise((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  // Registra el rechazo antes de abrir el navegador.
  received.catch(() => {});
  const server = createServer((request, response) => {
    const query = validateCallback(request, redirectUri, proof.state);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader('Connection', 'close');
    if (!query) {
      response.writeHead(400).end('Callback inválido.');
      return;
    }
    const [code] = query.getAll('code');
    if (
      !code ||
      query.getAll('code').length !== 1 ||
      query.has('error') ||
      code.length > MAX_CREDENTIAL
    ) {
      response
        .writeHead(400)
        .end('La autorización no se completó. Vuelve a la terminal.');
      fail(
        new CliError('La autorización en Descope se canceló o no se completó.'),
      );
      return;
    }
    response
      .writeHead(200)
      .end('KTSU recibió la autorización. Vuelve a la terminal.');
    finish({ code, redirectUri });
  });
  server.on('error', () =>
    fail(new CliError('No se pudo recibir la autorización local de la CLI.')),
  );
  server.listen(0, HOST);
  const timeout = setTimeout(
    () =>
      fail(
        new CliError(
          'La autorización caducó. Ejecuta ktsu auth login de nuevo.',
        ),
      ),
    LOGIN_TIMEOUT,
  );
  try {
    await once(server, 'listening');
    redirectUri = `http://${HOST}:${server.address().port}${CALLBACK}`;
    const url = new URL(settings.authorizationEndpoint);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: settings.clientId,
      redirect_uri: redirectUri,
      resource: settings.resource,
      scope,
      state: proof.state,
      code_challenge: proof.challenge,
      code_challenge_method: 'S256',
    });
    await openBrowser(url.href);
    return await received;
  } finally {
    clearTimeout(timeout);
    server.close();
    setTimeout(() => server.closeAllConnections(), 1_000).unref();
  }
}

function validateCallback(request, redirectUri, state) {
  const expected = redirectUri ? new URL(redirectUri) : null;
  if (
    !expected ||
    request.method !== 'GET' ||
    request.headers.host !== expected.host ||
    !request.url?.startsWith(`${CALLBACK}?`)
  )
    return null;
  const actual = URL.parse(request.url, expected);
  const matchesState = actual?.searchParams.getAll('state');
  if (
    actual?.pathname !== CALLBACK ||
    matchesState?.length !== 1 ||
    matchesState[0] !== state
  )
    return null;
  return actual.searchParams;
}

async function oauthConfig(base) {
  const settings = await integrationRequest(base, '/oauth');
  const issuer = new URL(trustedUrl(settings?.issuer, false));
  trustedUrl(settings?.resource, false);
  if (typeof settings?.clientId !== 'string' || !settings.clientId) {
    throw new CliError(
      'La API no anunció un cliente OAuth válido para la CLI.',
    );
  }
  const discovery = await requestOAuth(
    `${issuer.href}/.well-known/openid-configuration`,
  );
  if (discovery?.issuer !== issuer.href)
    throw new CliError(
      'El emisor de Descope no coincide con la configuración de KTSU.',
    );
  return {
    clientId: settings.clientId,
    resource: settings.resource,
    authorizationEndpoint: endpoint(discovery.authorization_endpoint, issuer),
    tokenEndpoint: endpoint(discovery.token_endpoint, issuer),
    revocationEndpoint: endpoint(
      discovery.revocation_endpoint ??
        new URL('/oauth2/v1/apps/revoke', issuer).href,
      issuer,
    ),
  };
}

function endpoint(value, issuer) {
  const url = new URL(trustedUrl(value, false));
  if (url.origin !== issuer.origin)
    throw new CliError('El endpoint OAuth no pertenece al emisor configurado.');
  return url.href;
}

async function exchange(settings, fields, previousRefresh) {
  const response = await requestOAuth(settings.tokenEndpoint, {
    ...fields,
    client_id: settings.clientId,
    resource: settings.resource,
  });
  if (
    !isToken(response?.access_token) ||
    response?.token_type?.toLowerCase() !== 'bearer' ||
    !Number.isSafeInteger(response.expires_in) ||
    response.expires_in <= 0 ||
    response.expires_in > 3600 ||
    (response.refresh_token !== undefined && !isToken(response.refresh_token))
  ) {
    throw new CliError('Descope devolvió una respuesta de tokens inválida.');
  }
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? previousRefresh ?? null,
    expiresAt: Date.now() + response.expires_in * 1000,
  };
}

async function revoke(settings, tokens) {
  const credentials = [
    [tokens.refreshToken, 'refresh_token'],
    [tokens.accessToken, 'access_token'],
  ].filter(([token]) => isToken(token));
  const responses = await Promise.allSettled(
    credentials.map(([token, token_type_hint]) =>
      requestOAuth(
        settings.revocationEndpoint,
        { token, token_type_hint, client_id: settings.clientId },
        false,
      ),
    ),
  );
  return (
    responses.length > 0 &&
    responses.every((response) => response.status === 'fulfilled')
  );
}

async function requestOAuth(url, fields, expectJson = true) {
  let response;
  try {
    response = await fetch(url, {
      method: fields ? 'POST' : 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
      body: fields ? new URLSearchParams(fields) : undefined,
    });
  } catch {
    throw new CliError('No se pudo contactar con el servidor OAuth.');
  }
  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    if (failure?.error === 'invalid_grant') throw needLogin();
    throw new CliError(`Descope respondió HTTP ${response.status}.`);
  }
  if (expectJson) return response.json();
  await response.body?.cancel();
}

function isToken(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_CREDENTIAL &&
    !/\s/u.test(value)
  );
}

function hasLiveAccess(saved) {
  return (
    isToken(saved.accessToken) &&
    Number.isSafeInteger(saved.expiresAt) &&
    saved.expiresAt > Date.now() + CLOCK_MARGIN
  );
}

function needLogin() {
  return new CliError(
    'Autoriza un acceso CLI en Integraciones y ejecuta ktsu auth login. Para scripts usa KTSU_TOKEN o --token-stdin.',
  );
}

async function launchBrowser(url) {
  const command = process.platform === 'darwin' ? '/usr/bin/open' : 'xdg-open';
  const child = spawn(command, [url], { stdio: 'ignore', timeout: 10_000 });
  const launched = await once(child, 'close').then(
    ([code]) => code === 0,
    () => false,
  );
  if (launched)
    console.error('Completa la autorización de KTSU en tu navegador.');
  else
    console.error(
      `Abre esta dirección en el navegador de este equipo:\n${url}`,
    );
}

async function withSessionLock(base, project, task) {
  const root = join(
    process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
    'ktsu',
  );
  const hash = createHash('sha256').update(`${base}\n${project}`).digest('hex');
  const lock = join(root, `oauth-${hash}.lock`);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const handle = await acquireLock(lock);
  try {
    await handle.writeFile(String(process.pid));
    return await task();
  } finally {
    try {
      await handle.close();
    } finally {
      await rm(lock, { force: true });
    }
  }
}

async function acquireLock(path) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      return await open(path, 'wx', 0o600);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const owner = await readFile(path, 'utf8').catch(() => '');
      if (/^[1-9]\d*$/u.test(owner) && processExited(Number(owner))) {
        // Un archivo de un proceso terminado solo se borra si sigue vigente.
        if ((await readFile(path, 'utf8').catch(() => '')) === owner)
          await rm(path, { force: true });
      }
      await delay(250);
    }
  }
  throw new CliError(
    'Hay otra operación de sesión en curso. Vuelve a intentarlo.',
  );
}

function processExited(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error?.code === 'ESRCH';
  }
}
