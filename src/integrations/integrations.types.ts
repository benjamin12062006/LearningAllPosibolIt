import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import type { ProjectScope } from '../worksheets/worksheets.types.js';

/** El token que acredita al servidor MCP ante Nest; `null` si no hay. */
export const MCP_ADAPTER_TOKEN = Symbol('MCP_ADAPTER_TOKEN');

/** Límites de las credenciales delegadas (plan 07, D1). */
export const INTEGRATION_LIMITS = {
  /** Vigencia si no se pide otra, y la máxima que se concede. */
  defaultHours: 24,
  maxHours: 7 * 24,
  /** Credenciales activas por persona y proyecto. */
  activePerOwner: 10,
  /** Propuestas sin decidir por credencial. */
  pendingProposals: 20,
  requestsPerActorMinute: 60,
  requestsPerProjectMinute: 240,
  argumentsBytes: 32 * 1024,
  /** Cada cuánto se anota el último uso, para no escribir en cada llamada. */
  lastUsedEveryMs: 60_000,
} as const;

export type CredentialAudience = 'mcp' | 'mcp_oauth' | 'cli';

export type CredentialCapability = 'read' | 'prepare';

/** La credencial tal como la ve la persona: nunca lleva el secreto. */
export type CredentialView = Readonly<{
  id: string;
  ownerId: string;
  label: string;
  audience: CredentialAudience;
  capabilities: CredentialCapability[];
  status: 'active' | 'expired' | 'revoked';
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}>;

/**
 * Una credencial ya comprobada en una llamada externa: para quién actúa, en
 * qué proyecto y con qué alcance.
 */
export type Delegation = Readonly<{
  credentialId: string;
  scope: ProjectScope;
  actorId: string;
  identity: AuthenticatedIdentity;
  canPrepare: boolean;
  expiresAt: string;
}>;

/**
 * Un cliente externo no viene de una conversación: no hay hoja ni selección
 * fijadas, y cada operación recibe sus IDs en los argumentos.
 */
export const EXTERNAL_CONTEXT = {
  workbookId: null,
  worksheetId: null,
  revisionId: null,
  selectionId: null,
} as const;
