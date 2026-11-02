import { Module } from '@nestjs/common';
import { resolve } from 'node:path';
import { ArtifactStore } from './artifact.store.js';
import {
  ARTIFACT_STORE_OPTIONS,
  type ArtifactStoreOptions,
} from './artifacts.types.js';

/**
 * Archivos privados compartidos por las features que los guardan (RC3: lo
 * reutilizable vive en un módulo que exporta su servicio). Cada feature conserva
 * su limpieza, porque solo ella sabe qué archivos siguen referenciados.
 */
@Module({
  providers: [
    ArtifactStore,
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
  ],
  exports: [ArtifactStore],
})
export class ArtifactsModule {}
