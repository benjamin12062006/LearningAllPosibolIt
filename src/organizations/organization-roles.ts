/** Roles cerrados; la migración los limita con un `CHECK` en `organization_members.role`. */
export const ORGANIZATION_ROLES = [
  'owner',
  'admin',
  'manager',
  'editor',
  'viewer',
] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

/** Permisos por acción. Un caso de uso pide un permiso, nunca un rol concreto. */
export type OrganizationPermission =
  | 'organization.read'
  | 'worksheet.write'
  | 'ai.use'
  | 'changeset.approve'
  | 'inventory.adjust'
  | 'members.manage'
  | 'organization.own';

/**
 * Tabla «Modelo de acceso» de docs-diagrams/11. Cada rol lista todos sus
 * permisos, aunque repita los del anterior: así se lee qué puede hacer sin
 * reconstruir una herencia.
 *
 * - Editor prepara trabajo (borradores, importaciones, propuestas de IA), pero
 *   no lo aprueba.
 * - Manager aprueba y aplica cambios de datos. Ajustar stock requiere además un
 *   permiso operativo explícito que todavía no existe, por eso no lo tiene.
 * - Gastar en campañas no sale de ningún rol: aprobar no implica gastar (E10).
 */
const PERMISSIONS_BY_ROLE: Record<
  OrganizationRole,
  readonly OrganizationPermission[]
> = {
  viewer: ['organization.read'],
  editor: ['organization.read', 'worksheet.write', 'ai.use'],
  manager: [
    'organization.read',
    'worksheet.write',
    'ai.use',
    'changeset.approve',
  ],
  admin: [
    'organization.read',
    'worksheet.write',
    'ai.use',
    'changeset.approve',
    'inventory.adjust',
    'members.manage',
  ],
  owner: [
    'organization.read',
    'worksheet.write',
    'ai.use',
    'changeset.approve',
    'inventory.adjust',
    'members.manage',
    'organization.own',
  ],
};

export function permissionsFor(
  role: OrganizationRole,
): readonly OrganizationPermission[] {
  return PERMISSIONS_BY_ROLE[role];
}

export function can(
  role: OrganizationRole,
  permission: OrganizationPermission,
): boolean {
  return permissionsFor(role).includes(permission);
}

/**
 * Qué hace falta para dar o quitar `role` a otra persona: gestionar miembros
 * y, si el rol es `owner`, además ser `owner` (plan organizations&access 02,
 * T4). Así un admin no puede crear owners ni quitarlos.
 */
export function canManageRole(
  actorRole: OrganizationRole,
  role: OrganizationRole,
): boolean {
  if (!can(actorRole, 'members.manage')) {
    return false;
  }
  if (role === 'owner') {
    return can(actorRole, 'organization.own');
  }
  return true;
}
