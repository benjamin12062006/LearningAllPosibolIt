import { Module } from '@nestjs/common';
import { ArtifactsModule } from '../artifacts/artifacts.module.js';
import { RemoteSourceService } from './remote-source.service.js';
import {
  REMOTE_SOURCE_OPTIONS,
  type RemoteSourceOptions,
} from './remote-source.types.js';

/**
 * Descarga segura de la fuente CSV de un feed (plan feeds&publications, D9).
 * La usará el worker de actualizaciones (E4).
 */
@Module({
  imports: [ArtifactsModule],
  providers: [
    RemoteSourceService,
    {
      provide: REMOTE_SOURCE_OPTIONS,
      // Fijas en producción: solo las pruebas admiten `http:` y `localhost`.
      useFactory: (): RemoteSourceOptions => ({
        timeoutMs: 30_000,
        allowHttp: false,
        allowPrivateNetworks: false,
      }),
    },
  ],
  exports: [RemoteSourceService],
})
export class RemoteSourceModule {}
