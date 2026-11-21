import { describe, expect, it } from '@jest/globals';
import { InternalServerErrorException } from '@nestjs/common';
import { apiError, rejectionOf } from '../../../src/common/http/api-error.js';
import { ErrorCodes } from '../../../src/common/http/error-codes.js';

describe('E4: qué fallo queda guardado en una propuesta', () => {
  it('un rechazo de los servicios (4xx con código) se guarda con su mensaje', () => {
    expect(rejectionOf(apiError(ErrorCodes.WORKSHEET_NAME_TAKEN))).toMatchObject({
      code: ErrorCodes.WORKSHEET_NAME_TAKEN,
      message: { es: expect.any(String), en: expect.any(String) },
    });
  });

  it('un 5xx o un error cualquiera no: se puede reintentar', () => {
    expect(rejectionOf(apiError(ErrorCodes.INTERNAL_ERROR))).toBeNull();
    expect(rejectionOf(new InternalServerErrorException())).toBeNull();
    expect(rejectionOf(new Error('se cayó la base'))).toBeNull();
  });
});
