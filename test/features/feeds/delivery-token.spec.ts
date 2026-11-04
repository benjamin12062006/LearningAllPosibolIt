import { describe, expect, it } from '@jest/globals';
import { createHash } from 'node:crypto';
import {
  createDeliveryToken,
  DELIVERY_TOKEN_PATTERN,
  deliveryUrlOf,
  hashDeliveryToken,
} from '../../../src/feeds/delivery-token.js';

describe('Token de entrega del feed', () => {
  it('son 32 bytes aleatorios en base64url: 43 caracteres sin relleno', () => {
    const { token } = createDeliveryToken();

    expect(token).toMatch(DELIVERY_TOKEN_PATTERN);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('cada token es distinto', () => {
    const tokens = new Set(
      Array.from({ length: 50 }, () => createDeliveryToken().token),
    );

    expect(tokens.size).toBe(50);
  });

  it('se guarda el SHA-256 en hexadecimal, nunca el token', () => {
    const { token, hash } = createDeliveryToken();

    expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(token);
  });

  it('el mismo token da siempre el mismo hash', () => {
    const { token, hash } = createDeliveryToken();

    expect(hashDeliveryToken(token)).toBe(hash);
    expect(hashDeliveryToken(`${token}x`)).not.toBe(hash);
  });

  it('el patrón rechaza otras longitudes y caracteres fuera de base64url', () => {
    const { token } = createDeliveryToken();

    expect(DELIVERY_TOKEN_PATTERN.test(token.slice(1))).toBe(false);
    expect(DELIVERY_TOKEN_PATTERN.test(`${token}A`)).toBe(false);
    expect(DELIVERY_TOKEN_PATTERN.test(`${token.slice(1)}=`)).toBe(false);
    expect(DELIVERY_TOKEN_PATTERN.test(`${token.slice(1)}/`)).toBe(false);
  });

  it('la URL pública queda fuera de /api/v1', () => {
    expect(deliveryUrlOf('abc')).toBe('/feeds/abc.tsv');
  });
});
