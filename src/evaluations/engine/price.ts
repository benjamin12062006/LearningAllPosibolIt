/**
 * Precio como texto decimal, nunca como `number` (RNF04): se admite `1234.50`
 * o `1234.50 USD`, con punto decimal, hasta dos decimales y sin separador de
 * miles ni símbolo. Cualquier otro formato se rechaza en lugar de adivinarlo:
 * `1.234` podría ser mil doscientos treinta y cuatro o uno con dos (plan D6).
 * `\d` sin la bandera `u` solo acepta los dígitos ASCII 0–9.
 */
const PRICE_PATTERN =
  /^(?<units>\d{1,9})(?:\.(?<cents>\d{1,2}))?(?: (?<currency>[A-Z]{3}))?$/;

const ZERO_AMOUNT = '0.00';

export type PriceProblemCode =
  'PRICE_FORMAT_INVALID' | 'PRICE_CURRENCY_MISMATCH' | 'PRICE_ZERO';

export type PriceResult =
  | Readonly<{ ok: true; value: string }>
  | Readonly<{ ok: false; code: PriceProblemCode }>;

/**
 * Devuelve el precio en el formato del canal (`15.00 USD`) usando la moneda del
 * proyecto, o el motivo por el que no se puede aceptar.
 */
export function normalizePrice(raw: string, currency: string): PriceResult {
  // Los espacios alrededor no cambian el valor; los de dentro sí se rechazan.
  const match = PRICE_PATTERN.exec(raw.trim());
  if (!match?.groups) {
    return { ok: false, code: 'PRICE_FORMAT_INVALID' };
  }

  const { units, cents = '', currency: writtenCurrency } = match.groups;
  if (writtenCurrency !== undefined && writtenCurrency !== currency) {
    return { ok: false, code: 'PRICE_CURRENCY_MISMATCH' };
  }

  const amount = `${withoutLeadingZeros(units)}.${cents.padEnd(2, '0')}`;
  if (amount === ZERO_AMOUNT) {
    return { ok: false, code: 'PRICE_ZERO' };
  }
  return { ok: true, value: `${amount} ${currency}` };
}

/** `0015` → `15`, pero `0` se queda como `0`. */
function withoutLeadingZeros(units: string) {
  return units.replace(/^0+(?=\d)/, '');
}
