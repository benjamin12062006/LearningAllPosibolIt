import { describe, expect, it } from '@jest/globals';
import { normalizePrice } from '../../../src/evaluations/engine/price.js';

describe('normalizePrice', () => {
  it.each([
    ['0.50', '0.50 USD'],
    ['15', '15.00 USD'],
    ['15.5 USD', '15.50 USD'],
    ['1234.50', '1234.50 USD'],
    [' 149.90 ', '149.90 USD'],
    ['0015', '15.00 USD'],
    ['999999999.99', '999999999.99 USD'],
  ])('acepta %j y lo devuelve como %j', (raw, expected) => {
    expect(normalizePrice(raw, 'USD')).toEqual({ ok: true, value: expected });
  });

  it.each([
    '1,50',
    '1.234,50',
    '1,234.50',
    '$15',
    '15 $',
    '1e3',
    '15.',
    '.5',
    '15.123',
    '15 usd',
    '15USD',
    '15  USD',
    '1 234',
    '-5',
    '+5',
    '１５',
    '1000000000',
    '',
  ])('rechaza %j sin adivinar el valor', (raw) => {
    expect(normalizePrice(raw, 'USD')).toEqual({
      ok: false,
      code: 'PRICE_FORMAT_INVALID',
    });
  });

  it('rechaza una moneda distinta de la del proyecto', () => {
    expect(normalizePrice('15.00 EUR', 'USD')).toEqual({
      ok: false,
      code: 'PRICE_CURRENCY_MISMATCH',
    });
  });

  it.each(['0', '0.0', '000.00 USD'])('rechaza el precio cero %j', (raw) => {
    expect(normalizePrice(raw, 'USD')).toEqual({
      ok: false,
      code: 'PRICE_ZERO',
    });
  });

  it('usa la moneda del proyecto cuando el valor no la escribe', () => {
    expect(normalizePrice('20', 'BOB')).toEqual({
      ok: true,
      value: '20.00 BOB',
    });
  });
});
