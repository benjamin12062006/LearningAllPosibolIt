import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import type { AuthenticatedIdentity } from './authenticated-request.js';
import { requestOf } from './request-context.js';

/**
 * Identidad que `DescopeSessionGuard` dejó en la request, en rutas HTTP y en
 * resolvers GraphQL. Si falta, el guard no se aplicó: es un error del backend
 * (500), no del cliente.
 */
export const CurrentIdentity = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedIdentity => {
    const identity = requestOf(context).authenticatedIdentity;
    if (!identity) {
      throw apiError(ErrorCodes.INTERNAL_ERROR);
    }
    return identity;
  },
);
