import {
  type INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ApiExceptionFilter } from './common/http/api-exception.filter.js';
import { validationException } from './common/http/validation-errors.js';
import { transportErrors } from './common/http/transport-errors.js';

/** Misma configuración para el servidor y las pruebas HTTP de las features. */
export function configureHttp(app: INestApplication) {
  // Mismos parsers del adaptador, antes del normalizador de errores de transporte.
  app.getHttpAdapter().registerParserMiddleware();
  app.use(transportErrors);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      validationError: { target: false, value: false },
      exceptionFactory: validationException,
    }),
  );
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableCors({
    origin: [
      'http://localhost:4321',
      'http://127.0.0.1:4321',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Accept', 'Authorization', 'Content-Type'],
  });
}
