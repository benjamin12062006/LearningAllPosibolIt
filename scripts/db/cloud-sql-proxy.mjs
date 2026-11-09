// Arranca Cloud SQL Auth Proxy para la base de la API (plan google-cloud/db 01,
// G3 y G4). La API y Prisma se conectan a 127.0.0.1:5433; el proxy cifra el
// tramo hasta Google y entra con la cuenta de Google (IAM), sin contraseña.
// Se queda en primer plano: se para con Ctrl+C.
import { spawn } from 'node:child_process';
import { loadEnvFile } from 'node:process';

/** El 5432 lo usa la conexión de DataGrip a otra instancia (expo-city-bol). */
const PROXY_PORT = '5433';

try {
  loadEnvFile();
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const instance = process.env.CLOUD_SQL_INSTANCE?.trim();
if (!instance) {
  console.error(
    'Falta CLOUD_SQL_INSTANCE en .env (proyecto:región:instancia).',
  );
  process.exit(1);
}

const proxy = spawn(
  'cloud-sql-proxy',
  ['--address=127.0.0.1', `--port=${PROXY_PORT}`, '--auto-iam-authn', instance],
  { stdio: 'inherit' },
);
proxy.on('error', () => {
  console.error('No se encontró cloud-sql-proxy en el PATH.');
  process.exit(1);
});
proxy.on('exit', (code) => process.exit(code ?? 0));
