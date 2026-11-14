import { Args, ID } from '@nestjs/graphql';
import { uuidParamPipe } from '../../common/http/validation-errors.js';

/**
 * Un id como argumento GraphQL, validado como el parámetro de ruta REST:
 * `INVALID_UUID` con el nombre del campo. Así cada resolver dice solo qué ids
 * lleva: `@IdArg('worksheetId') worksheetId: string`.
 */
export function IdArg(name: string) {
  return Args(name, { type: () => ID }, uuidParamPipe(name));
}
