import type {
  OrganizationPermission,
  OrganizationRole,
} from './organization-roles.js';

/** `personal`: la organización propia de un usuario; `team`: una compartida (E1.3). */
export type OrganizationKind = 'personal' | 'team';

export type Organization = Readonly<{
  id: string;
  name: string;
  kind: OrganizationKind;
  createdAt: string;
}>;

/** Una organización vista por uno de sus miembros. */
export type OrganizationMembership = Organization &
  Readonly<{ role: OrganizationRole }>;

export type OrganizationAccess = Readonly<{
  role: OrganizationRole;
  permissions: readonly OrganizationPermission[];
}>;

export type OrganizationMember = Readonly<{
  userId: string;
  displayName: string | null;
  email: string | null;
  role: OrganizationRole;
  joinedAt: string;
}>;

/** Invitación pendiente; nunca incluye el token. */
export type OrganizationInvitation = Readonly<{
  id: string;
  email: string;
  role: OrganizationRole;
  createdAt: string;
  expiresAt: string;
}>;
