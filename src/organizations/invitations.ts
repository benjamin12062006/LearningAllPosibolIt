import { createHash, randomBytes } from 'node:crypto';

/**
 * Mismo mecanismo que el token de entrega de feeds (F25, F35). Se replica en
 * lugar de importarlo: organizaciones no puede depender de feeds.
 */
const INVITATION_TOKEN_BYTES = 32;

/** 32 bytes en `base64url` son 43 caracteres sin relleno. */
export const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Una invitación sin aceptar caduca a los 7 días (decisión propia; F35 no fija duración). */
export const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export type InvitationToken = Readonly<{
  /** Se devuelve una sola vez, al invitar; nunca se guarda. */
  token: string;
  /** Lo único que se guarda: la aceptación busca por este hash. */
  hash: string;
}>;

export function createInvitationToken(): InvitationToken {
  const token = randomBytes(INVITATION_TOKEN_BYTES).toString('base64url');
  return { token, hash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

/** «Ana@X.com » y «ana@x.com» son el mismo destinatario. */
export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function expiresAtFrom(now: Date) {
  return new Date(now.getTime() + INVITATION_LIFETIME_MS).toISOString();
}
