import type { ConfigService } from '@nestjs/config';

export type DatabaseConnection = Readonly<{
  instanceConnectionName: string;
  database: string;
  user: string;
  password: string;
}>;

export const DATABASE_SCHEMA = 'estadistica_forms';

export function resolveDatabaseConnection(
  configService: Pick<ConfigService, 'get'>,
): DatabaseConnection {
  const required = (name: string, trim = true): string => {
    const raw = configService.get<string>(name);
    const value = trim ? raw?.trim() : raw;
    if (!value) throw new Error(`Falta ${name} para conectar con Cloud SQL.`);
    return value;
  };
  const instanceConnectionName = required('INSTANCE_CONNECTION_NAME');
  if (!/^[^:\s]+:[^:\s]+:[^:\s]+$/.test(instanceConnectionName)) {
    throw new Error(
      'INSTANCE_CONNECTION_NAME debe usar proyecto:region:instancia.',
    );
  }

  return {
    instanceConnectionName,
    database: required('DB_NAME'),
    user: required('DB_USER'),
    password: required('DB_PASSWORD', false),
  };
}
