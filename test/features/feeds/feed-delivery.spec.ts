import { describe, expect, it } from '@jest/globals';
import { createDeliveryToken } from '../../../src/feeds/delivery-token.js';
import {
  entityTagOf,
  isNotModified,
  tokenFromFileName,
} from '../../../src/feeds/feed-delivery.js';

const CHECKSUM = 'a'.repeat(64);
const TAG = `"${CHECKSUM}"`;

describe('Nombre del archivo público', () => {
  it('extrae el token de <token>.tsv', () => {
    const { token } = createDeliveryToken();

    expect(tokenFromFileName(`${token}.tsv`)).toBe(token);
  });

  it('rechaza otra extensión, nada antes del punto o un token mal formado', () => {
    const { token } = createDeliveryToken();

    for (const name of [
      token,
      `${token}.csv`,
      `${token}.TSV`,
      `${token}.tsv.tsv`,
      '.tsv',
      `${token.slice(1)}.tsv`,
      `${token}x.tsv`,
      `../${token.slice(3)}.tsv`,
    ]) {
      expect(tokenFromFileName(name)).toBeNull();
    }
  });
});

describe('ETag e If-None-Match (comparación débil, F23)', () => {
  it('la etiqueta es fuerte y lleva la suma del TSV', () => {
    expect(entityTagOf(CHECKSUM)).toBe(TAG);
  });

  it('sin cabecera, o con otra etiqueta, el archivo se envía', () => {
    expect(isNotModified(undefined, TAG)).toBe(false);
    expect(isNotModified('', TAG)).toBe(false);
    expect(isNotModified(`"${'b'.repeat(64)}"`, TAG)).toBe(false);
    expect(isNotModified(CHECKSUM, TAG)).toBe(false);
  });

  it('la misma etiqueta, débil o en una lista, responde 304', () => {
    expect(isNotModified(TAG, TAG)).toBe(true);
    expect(isNotModified(`W/${TAG}`, TAG)).toBe(true);
    expect(isNotModified(`"otro", ${TAG}`, TAG)).toBe(true);
    expect(isNotModified(` W/"otro" ,W/${TAG} `, TAG)).toBe(true);
  });

  it('* coincide con cualquier versión', () => {
    expect(isNotModified('*', TAG)).toBe(true);
    expect(isNotModified(' * ', TAG)).toBe(true);
  });
});
