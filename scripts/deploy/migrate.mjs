// Aplica las migraciones de Prisma dentro de la imagen `migrate` (deploys,
// plan 06, D6). Es lo que ejecuta el job de migración.
//
// - Con `CLOUD_SQL_INSTANCE` (Cloud Run o GKE): arranca Cloud SQL Auth Proxy, espera a
//   que esté listo, migra y lo para. La base queda en 127.0.0.1:5432 y se entra
//   con la cuenta de servicio del job (IAM), sin contraseña.
// - Sin ella (Compose y Kubernetes): migra directamente contra `DATABASE_URL`.
//
// Con `APP_DATABASE_ROLE`, después de migrar da a ese rol permiso para leer y
// escribir datos, y nada más: la API no puede cambiar el esquema (plan 06, D5).
//
// En todos los casos el proceso termina con el código de salida de Prisma.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PROXY_PORT = '5432';
/** Puerto de salud del proxy (`--health-check`; deploys, fuentes 07, F3). */
const PROXY_HEALTH_URL = 'http://127.0.0.1:9090/startup';
const PROXY_START_TIMEOUT_MS = 30_000;
const PROXY_POLL_INTERVAL_MS = 500;

const DATABASE_SCHEMA = 'estadistica_forms';
/** Un rol de PostgreSQL o un usuario IAM (`ktsu-api@proyecto.iam`). */
const ROLE_NAME = /^[a-z0-9_][a-z0-9_.@-]*$/;

const exitCode = await migrate();
process.exit(exitCode);

async function migrate() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error('Falta DATABASE_URL para migrar.');
    return 1;
  }

  const applicationRole = process.env.APP_DATABASE_ROLE?.trim();
  if (applicationRole && !ROLE_NAME.test(applicationRole)) {
    console.error('APP_DATABASE_ROLE no es un nombre de rol válido.');
    return 1;
  }

  const instance = process.env.CLOUD_SQL_INSTANCE?.trim();
  if (!instance) {
    return migrateAndGrant(applicationRole);
  }

  const proxy = startProxy(instance);
  try {
    await waitUntilProxyIsReady(proxy);
    return await migrateAndGrant(applicationRole);
  } catch (error) {
    console.error(error.message);
    return 1;
  } finally {
    await stopProxy(proxy);
  }
}

async function migrateAndGrant(applicationRole) {
  const migrationExitCode = await runPrisma(['migrate', 'deploy']);
  if (migrationExitCode !== 0 || !applicationRole) {
    return migrationExitCode;
  }
  return runPrisma(
    ['db', 'execute', '--stdin'],
    dataAccessGrants(applicationRole),
  );
}

/**
 * Permisos de datos para el rol de la API. Las tablas las crea quien migra, y
 * `ALTER DEFAULT PRIVILEGES` cubre también las de migraciones futuras. Repetir
 * estos `GRANT` no cambia nada.
 */
function dataAccessGrants(role) {
  const schema = `"${DATABASE_SCHEMA}"`;
  const grantee = `"${role}"`;
  return [
    `GRANT USAGE ON SCHEMA ${schema} TO ${grantee};`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${grantee};`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${grantee};`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${grantee};`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT USAGE, SELECT ON SEQUENCES TO ${grantee};`,
  ].join('\n');
}

function startProxy(instance) {
  return spawn(
    'cloud-sql-proxy',
    [
      '--address=127.0.0.1',
      `--port=${PROXY_PORT}`,
      '--auto-iam-authn',
      '--health-check',
      // Con SIGTERM el proxy acaba con 0: así no tapa el resultado de Prisma.
      '--exit-zero-on-sigterm',
      instance,
    ],
    { stdio: 'inherit' },
  );
}

async function waitUntilProxyIsReady(proxy) {
  const deadline = Date.now() + PROXY_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (proxy.exitCode !== null) {
      throw new Error(
        `El proxy terminó al arrancar (código ${proxy.exitCode}).`,
      );
    }
    if (await proxyAnswersStartup()) {
      return;
    }
    await sleep(PROXY_POLL_INTERVAL_MS);
  }
  throw new Error('El proxy de Cloud SQL no estuvo listo a tiempo.');
}

async function proxyAnswersStartup() {
  try {
    const response = await fetch(PROXY_HEALTH_URL, {
      signal: AbortSignal.timeout(PROXY_POLL_INTERVAL_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function stopProxy(proxy) {
  if (proxy.exitCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    proxy.once('exit', resolve);
    proxy.kill('SIGTERM');
  });
}

/** Ejecuta Prisma CLI y devuelve su código de salida. `input` va por la entrada estándar. */
function runPrisma(args, input) {
  return new Promise((resolve) => {
    const prisma = spawn(
      'node',
      ['node_modules/prisma/build/index.js', ...args],
      {
        stdio: [input === undefined ? 'ignore' : 'pipe', 'inherit', 'inherit'],
      },
    );
    prisma.once('error', (error) => {
      console.error(`No se pudo ejecutar Prisma: ${error.message}`);
      resolve(1);
    });
    prisma.once('exit', (code) => resolve(code ?? 1));
    if (input !== undefined) {
      prisma.stdin.end(input);
    }
  });
}
