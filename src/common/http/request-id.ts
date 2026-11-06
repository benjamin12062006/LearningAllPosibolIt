import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Cabecera de correlación (plan jobs&files, D12). */
export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * Un id que llega del cliente o de un proxy solo se acepta si es corto y sin
 * caracteres raros: va a los registros y a la respuesta.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export type RequestWithId = Request & { requestId?: string };

/**
 * Da a cada petición su `requestId` antes que nada: el que trae `X-Request-Id`
 * si es válido, o uno nuevo. Se devuelve en la misma cabecera y lo usan el
 * filtro de errores y la importación, para seguir una petición en los registros.
 */
export function assignRequestId(
  request: RequestWithId,
  response: Response,
  next: NextFunction,
) {
  const incoming = request.get(REQUEST_ID_HEADER);
  request.requestId =
    incoming !== undefined && REQUEST_ID_PATTERN.test(incoming)
      ? incoming
      : randomUUID();
  response.setHeader(REQUEST_ID_HEADER, request.requestId);
  next();
}
