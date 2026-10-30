import { ErrorCodes } from './error-codes.js';
import type { ErrorRequestHandler } from 'express';
import { apiError } from './api-error.js';

/** Conserva el tipo del error antes de que el adaptador de Express lo simplifique. */
export const transportErrors: ErrorRequestHandler = (
  error: unknown,
  _request,
  _response,
  next,
) => {
  if (typeof error !== 'object' || error === null || !('type' in error)) {
    next(error);
    return;
  }

  // Estos tipos pertenecen al parser de Express; aquí se traducen al contrato público.
  switch (error.type) {
    case 'entity.parse.failed':
      return next(apiError(ErrorCodes.INVALID_JSON));
    case 'entity.too.large':
      return next(apiError(ErrorCodes.PAYLOAD_TOO_LARGE));
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return next(apiError(ErrorCodes.UNSUPPORTED_MEDIA_TYPE));
    default:
      return next(error);
  }
};
