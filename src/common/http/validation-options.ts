import { ValidationPipe, type ValidationPipeOptions } from '@nestjs/common';
import { validationException } from './validation-errors.js';

/**
 * Las opciones del `ValidationPipe` global. Las usan `configureHttp` y
 * `validateAs`, para que validar un cuerpo fuera de un controlador (una
 * entrada GraphQL convertida al cuerpo REST) dé los mismos errores.
 */
export const VALIDATION_OPTIONS: ValidationPipeOptions = {
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  validationError: { target: false, value: false },
  exceptionFactory: validationException,
};

const bodyPipe = new ValidationPipe(VALIDATION_OPTIONS);

/**
 * Valida un cuerpo con el DTO de REST y devuelve la instancia (plan C7, G7).
 * Los errores son los de REST: `VALIDATION_FAILED` con un `issue` por campo.
 */
export function validateAs<T extends object>(
  metatype: new () => T,
  body: unknown,
): Promise<T> {
  return bodyPipe.transform(body, { type: 'body', metatype });
}
