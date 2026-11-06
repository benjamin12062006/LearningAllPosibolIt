import { ErrorCodes, type ErrorCode } from '../common/http/error-codes.js';
import { canManageRole, type OrganizationRole } from './organization-roles.js';

export type MembershipChange =
  | Readonly<{ kind: 'change-role'; role: OrganizationRole }>
  | Readonly<{ kind: 'remove' }>;

/** Lo que el repositorio leyó, con las filas ya bloqueadas, para decidir. */
export type MembershipChangeContext = Readonly<{
  actor: Readonly<{ userId: string; role: OrganizationRole }>;
  target: Readonly<{
    userId: string;
    role: OrganizationRole;
    isPersonalOwner: boolean;
  }>;
  ownerCount: number;
  change: MembershipChange;
}>;

/**
 * Decide si se permite cambiar el rol de un miembro o quitarlo (plan
 * organizations&access 02, T4–T6). Devuelve el código de error o `null`.
 *
 * El orden importa: primero el permiso (403); después las dos reglas que
 * protegen a la organización (409), que valen también para uno mismo.
 */
export function membershipChangeError(
  context: MembershipChangeContext,
): ErrorCode | null {
  if (!isAllowedToChange(context)) {
    return ErrorCodes.FORBIDDEN;
  }
  if (!keepsOwnerRole(context)) {
    if (context.target.isPersonalOwner) {
      return ErrorCodes.ORGANIZATION_PERSONAL_OWNER;
    }
    if (isLastOwner(context)) {
      return ErrorCodes.ORGANIZATION_LAST_OWNER;
    }
  }
  return null;
}

/** Salir por sí mismo no requiere permiso; todo lo demás, gestionar ambos roles. */
function isAllowedToChange({ actor, target, change }: MembershipChangeContext) {
  const leavesByThemselves =
    change.kind === 'remove' && actor.userId === target.userId;
  if (leavesByThemselves) {
    return true;
  }
  if (!canManageRole(actor.role, target.role)) {
    return false;
  }
  if (change.kind === 'change-role') {
    return canManageRole(actor.role, change.role);
  }
  return true;
}

/** Un owner sigue siéndolo tras el cambio, o no era owner. */
function keepsOwnerRole({ target, change }: MembershipChangeContext) {
  if (target.role !== 'owner') {
    return true;
  }
  return change.kind === 'change-role' && change.role === 'owner';
}

function isLastOwner({ target, ownerCount }: MembershipChangeContext) {
  return target.role === 'owner' && ownerCount <= 1;
}
