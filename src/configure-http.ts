import {
  type INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { openRequestCache } from './common/http/request-cache.js';
import { ApiExceptionFilter } from './common/http/api-exception.filter.js';
import {
  assignRequestId,
  REQUEST_ID_HEADER,
} from './common/http/request-id.js';
import { VALIDATION_OPTIONS } from './common/http/validation-options.js';
import { transportErrors } from './common/http/transport-errors.js';

/** Misma configuración para el servidor y las pruebas HTTP de las features. */
export function configureHttp(app: INestApplication) {
  // El `requestId` va primero: también un cuerpo mal formado lo lleva (jobs&files, D12).
  app.use(assignRequestId);
  // Las lecturas de acceso se recuerdan durante la petición (plan C7, G2).
  app.use(openRequestCache);
  // Mismos parsers del adaptador, antes del normalizador de errores de transporte.
  app.getHttpAdapter().registerParserMiddleware();
  app.use(transportErrors);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalPipes(new ValidationPipe(VALIDATION_OPTIONS));
  // La URL pública del feed se sirve en `/feeds/<token>.tsv`, fuera de `/api`;
  // su controlador además es neutral a la versión (plan feeds&publications, D7).
  // Fuera de `/api`: el feed público y la pasarela interna del agente (A11).
  app.setGlobalPrefix('api', {
    exclude: ['feeds/:file', 'internal/v1/agent-runs/:runId/operations/:name'],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableCors({
    origin: [
      'http://localhost:4321',
      'http://127.0.0.1:4321',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // `If-Match` y `Idempotency-Key` los usan los borradores de hojas (E4):
    // guardar sin perder cambios y aplicar sin repetirlo. `ETag` lleva la
    // versión del borrador de vuelta al navegador.
    allowedHeaders: [
      'Accept',
      'Authorization',
      'Content-Type',
      'If-Match',
      'Idempotency-Key',
      REQUEST_ID_HEADER,
    ],
    exposedHeaders: ['ETag', REQUEST_ID_HEADER],
  });
}
