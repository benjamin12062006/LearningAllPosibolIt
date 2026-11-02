import 'reflect-metadata';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// La suite nueva no utiliza destinos o credenciales de desarrollo.
for (const key of [
  'DATABASE_URL',
  'DESCOPE_PROJECT_ID',
  'DESCOPE_MANAGEMENT_KEY',
]) {
  delete process.env[key];
}
process.env.NODE_ENV = 'test';

// Si una prueba monta `ArtifactsModule` sin sobrescribir `ARTIFACT_STORE_OPTIONS`,
// escribe en una carpeta temporal y no en `.data/catalog-import`.
process.env.CATALOG_IMPORT_ROOT = join(
  tmpdir(),
  'estadistica-forms-test-artifacts',
);
