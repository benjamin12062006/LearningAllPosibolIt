import type { ConfigService } from '@nestjs/config';

export type DatabaseConnection = Readonly<{
  url: string;
}>;

export const DATABASE_SCHEMA = 'estadistica_forms';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

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
  if (
    !LOCAL_HOSTS.has(parsed.hostname) &&
    !['require', 'verify-ca', 'verify-full'].includes(
      parsed.searchParams.get('sslmode') ?? '',
    )
  ) {
    throw new Error('DATABASE_URL debe incluir sslmode=require.');
  }

  return { url };
}
