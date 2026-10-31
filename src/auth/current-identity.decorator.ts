import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import type { AuthenticatedIdentity } from './authenticated-request.js';
import { requestOf } from './request-context.js';

/** Identidad validada por `DescopeSessionGuard`; solo para resolvers GraphQL. */
export const CurrentIdentity = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedIdentity => {
    const identity = requestOf(context).authenticatedIdentity;
    if (!identity) throw apiError(ErrorCodes.INTERNAL_ERROR);
    return identity;
  },
);
