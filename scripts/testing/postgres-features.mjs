// Pruebas que necesitan PostgreSQL real (C3 del plan de cierre): arranca un
// contenedor local, ejecuta solo esas pruebas y lo para siempre al terminar.
// Sin argumentos ejecuta las de concurrencia; los argumentos son patrones de Jest.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = fileURLToPath(new URL('../../', import.meta.url));

/**
 * La imagen ya está descargada en la máquina de desarrollo. Límites para no
 * saturar el portátil (P8): un contenedor, 2 CPU y 1 GiB, solo en 127.0.0.1.
 */
const CONTAINER = {
  name: 'estadistica-forms-test-postgres',
  image: 'postgres:15.2',
  port: 55432,
  cpus: '2',
  memory: '1g',
};
const ADMIN_URL = `postgresql://postgres:postgres@127.0.0.1:${CONTAINER.port}/postgres`;
const READY_TIMEOUT_MS = 60_000;
const DEFAULT_PATTERNS = ['postgres-concurrency'];

run('docker', [
  'run',
  '--detach',
  '--rm',
  '--name',
  CONTAINER.name,
  '--cpus',
  CONTAINER.cpus,
  '--memory',
  CONTAINER.memory,
  '--env',
  'POSTGRES_PASSWORD=postgres',
  '--publish',
  `127.0.0.1:${CONTAINER.port}:5432`,
  CONTAINER.image,
]);
let status = 1;
try {
  await waitUntilReady();
  run(process.execPath, ['scripts/testing/compile-features.mjs']);
  const patterns = process.argv.slice(2);
  status = spawnSync(
    process.execPath,
    [
      '--experimental-vm-modules',
      'node_modules/jest/bin/jest.js',
      '--config',
      'jest.features.config.mjs',
      '--runInBand',
      ...(patterns.length > 0 ? patterns : DEFAULT_PATTERNS),
    ],
    {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, TEST_POSTGRES_URL: ADMIN_URL },
    },
  ).status;
} finally {
  spawnSync('docker', ['stop', CONTAINER.name], { stdio: 'ignore' });
}
process.exit(status ?? 1);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`Falló: ${command} ${args.join(' ')}`);
  }
}

/**
 * Por TCP desde fuera del contenedor: mientras la imagen inicializa la base,
 * PostgreSQL solo escucha en su socket interno y después se reinicia, así que
 * preguntar desde dentro daría «listo» demasiado pronto.
 */
async function waitUntilReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const client = new pg.Client({ connectionString: ADMIN_URL });
    try {
      await client.connect();
      await client.query('SELECT 1');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      await client.end().catch(() => undefined);
    }
  }
  throw new Error('PostgreSQL de pruebas no respondió a tiempo.');
}
