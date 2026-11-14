import { Storage } from '@google-cloud/storage';
import { Module } from '@nestjs/common';
import { resolve } from 'node:path';
import { ArtifactStore } from './artifact.store.js';
import {
  ARTIFACT_STORE_OPTIONS,
  type ArtifactStoreOptions,
} from './artifacts.types.js';
import { CloudStorageArtifactStore } from './cloud-storage.artifact-store.js';

/**
 * Archivos privados compartidos por las features que los guardan (RC3: lo
 * reutilizable vive en un módulo que exporta su servicio). Cada feature conserva
 * su limpieza, porque solo ella sabe qué archivos siguen referenciados.
 */
@Module({
  providers: [
    {
      provide: ARTIFACT_STORE_OPTIONS,
      // La variable conserva el nombre de cuando solo había importaciones, para
      // no mover los archivos ya guardados.
      useFactory: (): ArtifactStoreOptions => ({
        root: resolve(
          process.env.CATALOG_IMPORT_ROOT?.trim() || '.data/catalog-import',
        ),
      }),
    },
    {
      provide: ArtifactStore,
      inject: [ARTIFACT_STORE_OPTIONS],
      useFactory: (options: ArtifactStoreOptions) =>
        createArtifactStore(process.env.ARTIFACT_BUCKET, options),
    },
  ],
  exports: [ArtifactStore],
})
export class ArtifactsModule {}

/**
 * Con `ARTIFACT_BUCKET`, los archivos van a ese bucket de Cloud Storage: Cloud
 * Run no tiene disco persistente (deploys, plan 06, D7). Sin ella, a la carpeta
 * local de siempre. Las features usan los dos igual.
 */
export function createArtifactStore(
  bucketName: string | undefined,
  localOptions: ArtifactStoreOptions,
) {
  const bucket = bucketName?.trim();
  if (bucket) {
    // Credenciales de la cuenta de servicio de Cloud Run (o ADC en local).
    return new CloudStorageArtifactStore(new Storage().bucket(bucket));
  }
  return new ArtifactStore(localOptions);
}
