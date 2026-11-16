#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
const OPERATION = /^[a-z][a-z0-9_]{1,63}$/u;
const MAX_INPUT = 32 * 1024;
const MAX_TOKEN = 512;
const HELP = `ktsu config set --api-url <URL> [--web-url <URL>]
ktsu config show
ktsu auth status
ktsu operations list
ktsu operations describe <name>
ktsu read <name> [--input <file.json>]
ktsu prepare <name> --input <file.json> [--call-id <uuid>]
ktsu proposals confirm <proposalId>

Usa KTSU_TOKEN o --token-stdin. --json devuelve JSON compacto. `.trim();

class CliError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.details = details;
  }
}

let json = process.argv.includes('--json');
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'api-url': { type: 'string' },
      'web-url': { type: 'string' },
      'token-stdin': { type: 'boolean' },
      'call-id': { type: 'string' },
      input: { type: 'string' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  json = values.json ?? false;
  if (values.help || positionals.length === 0) {
    print(HELP);
  } else {
    print(await run(positionals, values));
  }
} catch (error) {
  const provided = error instanceof CliError;
  const message = provided
    ? error.message
    : 'Revisa las opciones, los archivos y la conexión. Consulta ktsu --help.';
  const details = provided ? error.details : {};
  const failure = { code: 'KTSU_CLI_ERROR', ...details, message };
  console.error(
    json
      ? JSON.stringify(failure)
      : `${failure.code}: ${message}${failure.callId ? ` (callId ${failure.callId})` : ''}`,
  );
  process.exitCode = 1;
}

async function run(args, values) {
  const [command, action, argument] = args;
  const profile = await readProfile();
  if (command === 'config' && action === 'set' && args.length === 2) {
    if (!values['api-url'])
      throw new CliError('Indica --api-url para guardar el destino.');
    const next = { apiUrl: apiRoot(values['api-url']) };
    const webUrl = values['web-url'] ?? profile.webUrl;
    if (webUrl) next.webUrl = trustedUrl(webUrl);
    await saveProfile(next);
    return next;
  }
  if (command === 'config' && action === 'show' && args.length === 2)
    return profile;

  if (command === 'read' || command === 'prepare') {
    if (args.length !== 2 || !OPERATION.test(action))
      throw new CliError('Indica el nombre de una operación.');
    return invoke(await openClient(values, profile), command, action, values);
  }

  if (command === 'auth' && action === 'status' && args.length === 2) {
    return (await openClient(values, profile))('/session');
  }
  if (command === 'operations' && action === 'list' && args.length === 2) {
    return (await openClient(values, profile))('/operations');
  }
  if (
    command === 'operations' &&
    action === 'describe' &&
    args.length === 3 &&
    OPERATION.test(argument)
  ) {
    const { operations } = await (
      await openClient(values, profile)
    )('/operations');
    const operation = operations.find((item) => item.name === argument);
    if (!operation)
      throw new CliError('La operación no está disponible para tu credencial.');
    return operation;
  }
  if (
    command === 'proposals' &&
    action === 'confirm' &&
    args.length === 3 &&
    UUID.test(argument)
  ) {
    const webUrl =
      values['web-url'] ?? process.env.KTSU_WEB_URL ?? profile.webUrl;
    if (!webUrl)
      throw new CliError('Indica --web-url o configura la URL de la web.');
    const base = trustedUrl(webUrl);
    const { projectId } = await (await openClient(values, profile))('/session');
    if (typeof projectId !== 'string' || !UUID.test(projectId))
      throw new CliError('La sesión no devolvió un proyecto válido.');
    return {
      url: new URL(
        `/projects/${projectId}/integrations/proposals/${argument}`,
        base,
      ).href,
    };
  }
  throw new CliError('Comando inválido. Consulta ktsu --help.');
}

async function invoke(request, command, operation, values) {
  const callId = values['call-id'] ?? randomUUID();
  if (!UUID.test(callId))
    throw new CliError('Usa un UUID válido para --call-id.');
  const args = values.input ? await readInput(values.input) : {};
  const mode = command === 'read' ? 'execute' : 'prepare';
  const result = await request(`/operations/${operation}`, {
    callId,
    mode,
    arguments: args,
  });
  return command === 'prepare' ? { ...result, callId } : result;
}

async function openClient(values, profile) {
  const base = values['api-url'] ?? process.env.KTSU_API_URL ?? profile.apiUrl;
  if (!base)
    throw new CliError('Configura el destino con ktsu config set --api-url.');
  const url = apiRoot(base);
  const token = await readToken(values['token-stdin']);
  return (path, body) => apiRequest(url, token, path, body);
}

async function apiRequest(base, token, path, body) {
  let response;
  try {
    response = await fetch(`${base}/api/v1/integrations${path}`, {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body && { 'Content-Type': 'application/json' }),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new CliError(
      'No se pudo completar la petición a KTSU. Reutiliza --call-id si reintentas una preparación.',
      { callId: body?.callId },
    );
  }
  const result = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message =
      typeof result?.message?.es === 'string'
        ? result.message.es
        : `La API respondió HTTP ${response.status}.`;
    throw new CliError(message, {
      ...(typeof result?.code === 'string' && { code: result.code }),
      requestId: response.headers.get('X-Request-Id') ?? undefined,
      callId: body?.callId,
    });
  }
  if (result === undefined) {
    throw new CliError('KTSU devolvió una respuesta sin JSON válido.', {
      callId: body?.callId,
    });
  }
  return result;
}

async function readToken(fromStdin) {
  let value = process.env.KTSU_TOKEN?.trim();
  if (fromStdin) {
    if (process.stdin.isTTY)
      throw new CliError(
        'Envía el token mediante un pipe privado a --token-stdin.',
      );
    const chunks = [];
    let used = 0;
    for await (const chunk of process.stdin) {
      used += chunk.length;
      if (used > MAX_TOKEN + 2)
        throw new CliError('El token supera el límite permitido.');
      chunks.push(chunk);
    }
    value = Buffer.concat(chunks).toString('utf8').trim();
  }
  if (!value || value.length > MAX_TOKEN || /\s/u.test(value)) {
    throw new CliError(
      'Suministra una credencial CLI por KTSU_TOKEN o --token-stdin.',
    );
  }
  return value;
}

async function readInput(path) {
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_INPUT) {
      throw new CliError(
        'La entrada debe ser un archivo JSON de hasta 32 KiB.',
      );
    }
    const buffer = Buffer.alloc(MAX_INPUT + 1);
    const { bytesRead } = await file.read(buffer);
    if (bytesRead > MAX_INPUT) throw new CliError('La entrada supera 32 KiB.');
    const value = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new CliError('La entrada debe ser un objeto JSON.');
    }
    return value;
  } finally {
    await file.close();
  }
}

function trustedUrl(value) {
  const url = URL.parse(value);
  const protocolAllowed =
    url?.protocol === 'https:' ||
    (url?.protocol === 'http:' && LOOPBACK.has(url.hostname));
  if (
    !url ||
    !protocolAllowed ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new CliError(
      'Usa HTTPS o HTTP en loopback y una URL sin credenciales, query ni fragmento.',
    );
  }
  return url.href;
}

function apiRoot(value) {
  const url = new URL(trustedUrl(value));
  if (!['/', '/api/v1', '/api/v1/'].includes(url.pathname))
    throw new CliError('La ruta de la API debe ser / o /api/v1.');
  return url.origin;
}

function profilePath() {
  const root = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return process.env.KTSU_CONFIG_PATH || join(root, 'ktsu', 'config.json');
}

async function readProfile() {
  try {
    const data = JSON.parse(await readFile(profilePath(), 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new CliError('El perfil de KTSU no es válido.');
    return {
      ...(typeof data.apiUrl === 'string' && { apiUrl: apiRoot(data.apiUrl) }),
      ...(typeof data.webUrl === 'string' && {
        webUrl: trustedUrl(data.webUrl),
      }),
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    if (error instanceof CliError) throw error;
    throw new CliError('El perfil de KTSU no se pudo leer.');
  }
}

async function saveProfile(config) {
  const path = profilePath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(config, null, 2) + '\n', {
      mode: 0o600,
      flag: 'wx',
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function print(value) {
  if (typeof value === 'string') console.log(value);
  else console.log(JSON.stringify(value, null, json ? undefined : 2));
}
