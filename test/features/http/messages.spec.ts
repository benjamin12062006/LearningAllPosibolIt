import { describe, expect, it } from '@jest/globals';
import { API_MESSAGES } from '../../../src/common/http/messages.js';
import {
  ErrorCodes,
  isErrorCode,
} from '../../../src/common/http/error-codes.js';
import {
  localizeStoredError,
  publicError,
} from '../../../src/common/http/public-error.js';
import { validationIssues } from '../../../src/common/http/validation-errors.js';

describe('Catálogo bilingüe y errores guardados', () => {
  it('reconoce solo valores públicos y conserva la cobertura del catálogo', () => {
    expect(Object.values(ErrorCodes).sort()).toEqual(
      Object.keys(API_MESSAGES).sort(),
    );
    expect(new Set(Object.values(ErrorCodes)).size).toBe(
      Object.keys(ErrorCodes).length,
    );
    for (const code of Object.values(ErrorCodes)) {
      expect(isErrorCode(code)).toBe(true);
      expect(publicError(code).code).toBe(code);
    }
    for (const value of [
      'PROJECT_NOT_FOND',
      'toString',
      'constructor',
      '__proto__',
      null,
      undefined,
      500,
      {},
      ['INTERNAL_ERROR'],
    ]) {
      expect(isErrorCode(value)).toBe(false);
    }
  });

  it.each(Object.entries(API_MESSAGES))(
    '%s conserva código, estado y las dos traducciones',
    (code, entry) => {
      expect(code).toMatch(/^[A-Z][A-Z_]+$/);
      expect(entry.status).toBeGreaterThanOrEqual(400);
      expect(entry.status).toBeLessThan(600);
      expect(Object.keys(entry.message).sort()).toEqual(['en', 'es']);
      expect(entry.message.es.trim()).not.toBe('');
      expect(entry.message.en.trim()).not.toBe('');
    },
  );

  it('las respuestas no comparten un objeto de traducción mutable', () => {
    const first = publicError('INTERNAL_ERROR');
    first.message.es = 'Modificado';
    expect(publicError('INTERNAL_ERROR').message.es).not.toBe('Modificado');
  });

  it('recompone mensajes históricos por código y descarta diagnóstico y datos desconocidos', () => {
    expect(
      localizeStoredError({
        code: 'CSV_DUPLICATE_ID',
        message: 'SQL secreto',
        sourceRow: 3,
        field: 'id',
        secret: 'token',
      }),
    ).toEqual(publicError('CSV_DUPLICATE_ID', { sourceRow: 3, field: 'id' }));
    expect(
      localizeStoredError({ code: 'ANTERIOR', message: 'SQL secreto' }),
    ).toEqual(publicError('IMPORT_PROCESSING_FAILED'));
    expect(localizeStoredError(null)).toBeNull();
    expect(localizeStoredError('diagnóstico')).toEqual(
      publicError('IMPORT_PROCESSING_FAILED'),
    );
  });

  it('ordena, deduplica y traduce reglas sin publicar sus valores ni textos originales', () => {
    expect(
      validationIssues([
        {
          property: 'z',
          value: 'secreto',
          constraints: { isString: 'texto secreto' },
        },
        { property: 'country', constraints: { isISO31661Alpha2: 'texto' } },
        { property: 'z', constraints: { isString: 'duplicado' } },
        {
          property: 'nested',
          children: [
            { property: 'id', constraints: { unknownRule: 'secreto' } },
          ],
        },
      ]),
    ).toEqual([
      { field: 'country', ...publicError('COUNTRY_INVALID') },
      { field: 'nested.id', ...publicError('FIELD_INVALID') },
      { field: 'z', ...publicError('FIELD_NOT_STRING') },
    ]);
  });
});
