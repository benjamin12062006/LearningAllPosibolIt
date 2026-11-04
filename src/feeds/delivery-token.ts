import { createHash, randomBytes } from 'node:crypto';

/** 256 bits: imposible de adivinar probando (plan feeds&publications, D7). */
const DELIVERY_TOKEN_BYTES = 32;

/** 32 bytes en `base64url` son 43 caracteres sin relleno (F25). */
export const DELIVERY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type DeliveryToken = Readonly<{
  /** Se muestra una sola vez, en `deliveryUrl`; nunca se guarda. */
  token: string;
  /** Lo único que se guarda: así una copia de la base no revela la URL. */
  hash: string;
}>;

export function createDeliveryToken(): DeliveryToken {
  const token = randomBytes(DELIVERY_TOKEN_BYTES).toString('base64url');
  return { token, hash: hashDeliveryToken(token) };
}

/**
 * La URL pública busca el feed por este hash: la comparación la hace el índice
 * único de la base, no el código.
 */
export function hashDeliveryToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

/** La ruta pública se sirve fuera de `/api/v1` (D7); llega en E2. */
export function deliveryUrlOf(token: string) {
  return `/feeds/${token}.tsv`;
}
