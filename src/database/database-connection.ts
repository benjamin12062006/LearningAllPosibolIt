import type { ConfigService } from '@nestjs/config';

export type DatabaseConnection = Readonly<{
  url: string;
}>;

export const DATABASE_SCHEMA = 'estadistica_forms';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const SECURE_SSL_MODES = ['require', 'verify-ca', 'verify-full'];

export function resolveDatabaseConnection(
  configService: Pick<ConfigService, 'get'>,
): DatabaseConnection {
  const url = configService.get<string>('DATABASE_URL')?.trim();
  if (!url) throw new Error('Falta DATABASE_URL para conectar con Neon.');

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('DATABASE_URL no es una URL válida.');
  }
  if (!['postgresql:', 'postgres:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL debe usar el protocolo postgresql://.');
  }
  if (requiresTls(parsed) && !usesTls(parsed)) {
    throw new Error('DATABASE_URL debe incluir sslmode=require.');
  }

  return { url };
}

/** Fuera de la máquina local, la conexión debe ir cifrada. */
function requiresTls(url: URL) {
  return !LOCAL_HOSTS.has(url.hostname);
}

function usesTls(url: URL) {
  return SECURE_SSL_MODES.includes(url.searchParams.get('sslmode') ?? '');
}
