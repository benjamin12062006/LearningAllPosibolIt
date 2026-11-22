import 'reflect-metadata';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// La suite nueva no utiliza destinos o credenciales de desarrollo.
for (const key of [
  'DATABASE_URL',
  'DESCOPE_PROJECT_ID',
  'DESCOPE_MANAGEMENT_KEY',
  // Despliegue en Cloud Run (deploys, plan 06): nada de bucket, identidad de
  // Google ni orígenes reales en las pruebas.
  'ARTIFACT_BUCKET',
  'AI_SERVICE_ID_TOKEN_AUDIENCE',
  'CORS_ALLOWED_ORIGINS',
]) {
  delete process.env[key];
}
process.env.NODE_ENV = 'test';
// Producción aplica siempre al momento (plan 05 de cli). La suite parte del
// flujo con propuesta pendiente; las pruebas de la aplicación inmediata
// sobrescriben `AI_AUTO_CONFIRM` a `true`.
process.env.AI_AUTO_CONFIRM = 'false';

// Si una prueba monta `ArtifactsModule` sin sobrescribir `ARTIFACT_STORE_OPTIONS`,
// escribe en una carpeta temporal y no en `.data/catalog-import`.
process.env.CATALOG_IMPORT_ROOT = join(
  tmpdir(),
  'estadistica-forms-test-artifacts',
);
