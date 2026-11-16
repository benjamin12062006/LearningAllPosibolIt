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

/** Orígenes de la web en desarrollo (Astro y Nuxt). */
const LOCAL_WEB_ORIGINS = [
  'http://localhost:4321',
  'http://127.0.0.1:4321',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

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
  // Fuera de `/api`: el feed público, la pasarela interna del agente (A11) y
  // la de los clientes MCP (plan 07).
  app.setGlobalPrefix('api', {
    exclude: [
      'feeds/:file',
      'internal/v1/agent-runs/:runId/operations/:name',
      'internal/v1/mcp-integrations/session',
      'internal/v1/mcp-integrations/operations',
      'internal/v1/mcp-integrations/operations/:name',
    ],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableCors({
    origin: allowedOrigins(process.env.CORS_ALLOWED_ORIGINS),
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

/**
 * Los orígenes locales más los de `CORS_ALLOWED_ORIGINS`, separados por comas:
 * en Cloud Run, la URL `run.app` de la web (deploys, plan 06, D8). Solo se
 * admiten orígenes `https://` exactos, sin ruta ni comodines; si hay otra cosa,
 * la API no arranca en lugar de abrirse a quien no debe.
 */
export function allowedOrigins(configured: string | undefined): string[] {
  const extraOrigins = (configured ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  for (const origin of extraOrigins) {
    if (!isExactHttpsOrigin(origin)) {
      throw new Error(
        `CORS_ALLOWED_ORIGINS solo admite orígenes https:// exactos: ${origin}`,
      );
    }
  }
  return [...LOCAL_WEB_ORIGINS, ...extraOrigins];
}

/** `https://web.example` sí; `https://web.example/`, `http://…` o `*` no. */
function isExactHttpsOrigin(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value;
  } catch {
    return false;
  }
}
