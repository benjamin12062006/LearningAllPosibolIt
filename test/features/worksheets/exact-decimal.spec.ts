import { describe, expect, it } from '@jest/globals';
import {
  add,
  divide,
  formatRounded,
  multiply,
  parseDecimal,
  round,
  subtract,
  type Rational,
  type RoundingMode,
} from '../../../src/worksheets/exact-decimal.js';

function show(value: Rational, scale = 2, mode: RoundingMode = 'half_up') {
  return formatRounded(round(value, scale, mode), scale);
}

const d = parseDecimal;

describe('Aritmética decimal exacta', () => {
  it('suma sin el error de coma flotante: 0.1 + 0.2 = 0.30', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(show(add(d('0.1'), d('0.2')))).toBe('0.30');
  });

  it('resta, multiplica y divide con importes reales', () => {
    expect(show(subtract(d('19.99'), d('12.50')))).toBe('7.49');
    expect(show(multiply(d('19.99'), d('3')))).toBe('59.97');
    expect(show(divide(d('10'), d('3'))!, 4)).toBe('3.3333');
    expect(show(divide(d('-1'), d('8'))!, 3)).toBe('-0.125');
  });

  it('dividir entre cero no tiene resultado', () => {
    expect(divide(d('5'), d('0'))).toBeNull();
    expect(divide(d('5'), d('0.00'))).toBeNull();
  });

  it.each<[string, number, RoundingMode, string]>([
    ['2.5', 0, 'half_up', '3'],
    ['2.5', 0, 'half_even', '2'],
    ['3.5', 0, 'half_even', '4'],
    ['-2.5', 0, 'half_up', '-3'],
    ['-2.5', 0, 'half_even', '-2'],
    ['2.45', 1, 'half_up', '2.5'],
    ['2.45', 1, 'half_even', '2.4'],
    ['2.4499', 1, 'half_up', '2.4'],
    ['-0.004', 2, 'half_up', '0.00'],
    ['7', 2, 'half_up', '7.00'],
  ])('%s con %i decimales y %s → %s', (text, scale, mode, expected) => {
    expect(show(d(text), scale, mode)).toBe(expected);
  });

  it('el denominador no crece al sumar muchas filas (simplificación por MCD)', () => {
    let total = d('0');
    for (let index = 0; index < 5000; index++) {
      total = add(
        total,
        d(`${index % 997}.${String(index % 1000).padStart(3, '0')}`),
      );
    }

    expect(total.denominator.toString().length).toBeLessThanOrEqual(4);
    expect(show(total, 3)).toBe('2485132.500');
  });
});
