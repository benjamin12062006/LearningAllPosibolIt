import { randomBytes } from 'node:crypto';

/**
 * El token de una credencial delegada (plan 07, D1): versión, ID público de la
 * credencial y 32 bytes aleatorios. Nest solo guarda el SHA-256 del secreto.
 */
const TOKEN =
  /^ktsu1\.([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\.([A-Za-z0-9_-]{43})$/;
const BEARER = /^Bearer (\S{1,512})$/i;

export function newIntegrationSecret() {
  return randomBytes(32).toString('base64url');
}

export function integrationToken(credentialId: string, secret: string) {
  return `ktsu1.${credentialId}.${secret}`;
}

/** Lee `Bearer <token>`; `null` si la cabecera o el token no tienen la forma. */
export function parseIntegrationToken(
  header: string | undefined,
): { credentialId: string; secret: string } | null {
  const token = BEARER.exec(header ?? '')?.[1];
  const parts = token ? TOKEN.exec(token) : null;
  return parts ? { credentialId: parts[1], secret: parts[2] } : null;
}

export function bearerOf(header: string | undefined): string | null {
  return BEARER.exec(header ?? '')?.[1] ?? null;
}
