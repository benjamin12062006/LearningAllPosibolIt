#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import {
  link,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';

import { CliError, integrationRequest, trustedUrl } from '../lib/http.mjs';
import { oauthSession } from '../lib/oauth.mjs';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
const OPERATION = /^[a-z][a-z0-9_]{1,63}$/u;
const MAX_INPUT = 32 * 1024;
const MAX_TOKEN = 512;
const HELP =
  `ktsu config set --api-url <URL> [--web-url <URL>] [--project-id <uuid>]
ktsu config show
ktsu auth login [--read-only]
ktsu auth status
ktsu auth logout
ktsu operations list
ktsu operations describe <name>
ktsu read <name> [--input <file.json>]
ktsu prepare <name> [--input <file.json>] [--call-id <uuid>]
ktsu proposals status <proposalId>
ktsu proposals download <proposalId> --output <file>
ktsu exports download <exportId> --output <file.tsv>
ktsu feed download <versionId> --feed-id <uuid> --output <file.tsv>
ktsu feed delivery

Usa OAuth o una credencial CLI por KTSU_TOKEN o --token-stdin. --json devuelve JSON compacto. `.trim();

let json = process.argv.includes('--json');
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'api-url': { type: 'string' },
      'web-url': { type: 'string' },
      'project-id': { type: 'string' },
      'read-only': { type: 'boolean' },
      'feed-id': { type: 'string' },
      output: { type: 'string' },
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
    const sameDestination = next.apiUrl === profile.apiUrl;
    const webUrl =
      values['web-url'] ?? (sameDestination ? profile.webUrl : undefined);
    const project =
      values['project-id'] ?? (sameDestination ? profile.projectId : undefined);
    if (webUrl) next.webUrl = trustedUrl(webUrl);
    if (project !== undefined) next.projectId = projectUuid(project);
    await saveProfile(next);
    return next;
  }
  if (command === 'config' && action === 'show' && args.length === 2)
    return profile;

  if (command === 'read' || command === 'prepare') {
    if (args.length !== 2 || !OPERATION.test(action))
      throw new CliError('Indica el nombre de una operación.');
    return invoke(
      await openClient(values, profile),
      command,
      action,
      values,
      profile,
    );
  }

  if (command === 'auth' && args.length === 2) {
    if (action === 'login' || action === 'logout') {
      const project = projectUuid(targetProject(values, profile));
      const session = oauthSession(targetApi(values, profile), project);
      return action === 'login'
        ? session.login(values['read-only'])
        : session.logout();
    }
    if (action === 'status')
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
  if (command === 'proposals' && args.length === 3 && UUID.test(argument)) {
    const request = await openClient(values, profile);
    const path = `/proposals/${argument}`;
    if (action === 'status') return request(path);
    if (action === 'download')
      return download(request, `${path}/file`, values.output);
  }
  if (
    command === 'exports' &&
    action === 'download' &&
    args.length === 3 &&
    UUID.test(argument)
  ) {
    return download(
      await openClient(values, profile),
      `/exports/${argument}/file`,
      values.output,
    );
  }
  if (
    command === 'feed' &&
    action === 'download' &&
    args.length === 3 &&
    UUID.test(argument)
  ) {
    const feedId = values['feed-id'];
    if (!feedId || !UUID.test(feedId))
      throw new CliError('Indica --feed-id con el ID del feed.');
    return download(
      await openClient(values, profile),
      `/feeds/${feedId}/versions/${argument}/file`,
      values.output,
    );
  }
  if (command === 'feed' && action === 'delivery' && args.length === 2) {
    return projectLink(
      await openClient(values, profile),
      webOrigin(values, profile),
      '/feed#feed-delivery',
    );
  }
  throw new CliError('Comando inválido. Consulta ktsu --help.');
}

async function invoke(request, command, operation, values, profile) {
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
  if (command === 'read') return result;
  // KTSU aplica la escritura en la misma llamada: la respuesta ya trae
  // `status: confirmed` y su resultado (plan 05 de cli).
  return { ...result, callId };
}

async function openClient(values, profile) {
  const base = targetApi(values, profile);
  const explicit =
    values['token-stdin'] || process.env.KTSU_TOKEN !== undefined;
  if (explicit) {
    const token = await readToken(values['token-stdin']);
    return (path, body, raw) =>
      integrationRequest(base, path, { token, body, raw });
  }
  const project = projectUuid(targetProject(values, profile));
  const token = await oauthSession(base, project).token();
  return (path, body, raw) =>
    integrationRequest(base, path, { token, project, body, raw });
}

function targetApi(values, profile) {
  const base = values['api-url'] ?? process.env.KTSU_API_URL ?? profile.apiUrl;
  if (!base)
    throw new CliError('Configura el destino con ktsu config set --api-url.');
  return apiRoot(base);
}

function targetProject(values, profile) {
  const useSavedProject = targetApi(values, profile) === profile.apiUrl;
  return (
    values['project-id'] ??
    process.env.KTSU_PROJECT_ID ??
    (useSavedProject ? profile.projectId : undefined)
  );
}

function projectUuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new CliError(
      'Para OAuth indica --project-id o configúralo. Si tienes una credencial CLI, usa KTSU_TOKEN o --token-stdin.',
    );
  }
  return value.toLowerCase();
}

function webOrigin(values, profile, required = true) {
  const sameDestination = targetApi(values, profile) === profile.apiUrl;
  const url =
    values['web-url'] ??
    process.env.KTSU_WEB_URL ??
    (sameDestination ? profile.webUrl : undefined);
  if (!url && required)
    throw new CliError('Indica --web-url o configura la URL de la web.');
  return url ? trustedUrl(url) : undefined;
}

async function projectLink(request, web, path) {
  const { projectId } = await request('/session');
  return {
    url: new URL(`/projects/${projectUuid(projectId)}${path}`, web).href,
  };
}

async function download(request, route, output) {
  if (!output) throw new CliError('Indica --output con el nombre del archivo.');
  const path = resolve(output);
  const temporary = join(dirname(path), `.ktsu-download-${randomUUID()}`);
  const response = await request(route, undefined, true);
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
    );
    // Publica el archivo completo sin reemplazar un destino existente.
    await link(temporary, path);
    return { path };
  } catch (error) {
    const message =
      error?.code === 'EEXIST'
        ? 'El archivo de destino ya existe.'
        : 'No se pudo guardar el archivo completo. Comprueba el destino y vuelve a intentarlo.';
    throw new CliError(message);
  } finally {
    await rm(temporary, { force: true });
  }
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
      ...(typeof data.projectId === 'string' && {
        projectId: projectUuid(data.projectId),
      }),
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
