import 'reflect-metadata';

// La suite nueva no utiliza destinos o credenciales de desarrollo.
for (const key of [
  'INSTANCE_CONNECTION_NAME',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'POSTGRES_MIGRATION_DATABASE_URL',
  'DESCOPE_PROJECT_ID',
  'DESCOPE_MANAGEMENT_KEY',
]) {
  delete process.env[key];
}
process.env.NODE_ENV = 'test';
