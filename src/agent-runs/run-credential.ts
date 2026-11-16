import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * La credencial que recibe el agente para llamar a la pasarela (plan 05, D3):
 * 32 bytes aleatorios en base64url. Nest solo guarda su SHA-256.
 */
export function newRunCredential() {
  return randomBytes(32).toString('base64url');
}

export function credentialHash(credential: string) {
  return createHash('sha256').update(credential, 'utf8').digest('hex');
}

/** Compara dos huellas de la misma longitud sin dar pistas por el tiempo. */
export function sameHash(stored: string, presented: string) {
  const left = Buffer.from(stored, 'hex');
  const right = Buffer.from(presented, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Huella canónica de unos argumentos o de un plan: JSON con claves ordenadas. */
export function canonicalHash(value: unknown) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}
