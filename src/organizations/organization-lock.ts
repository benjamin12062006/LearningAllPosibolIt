import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { Prisma } from '../generated/prisma/client.js';

export type LockedOrganization = Readonly<{
  isPersonal: boolean;
  isArchived: boolean;
}>;

/**
 * Toda escritura de membresías e invitaciones empieza aquí (plan 03, A5):
 * bloquea la fila de la organización con `FOR UPDATE` (F39). Así archivar,
 * invitar, aceptar y cambiar roles se ordenan, y contar plazas no tiene
 * carreras. Devuelve `null` si la organización no existe.
 */
export async function lockOrganization(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<LockedOrganization | null> {
  const rows = await tx.$queryRaw<LockedOrganization[]>(Prisma.sql`
    SELECT
      personal_owner_id IS NOT NULL AS "isPersonal",
      archived_at IS NOT NULL AS "isArchived"
    FROM estadistica_forms.organizations
    WHERE id = ${organizationId}
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

/**
 * Archivada se lee, pero no cambia. Se llama después de comprobar que el actor
 * es miembro: a quien no lo es no se le dice si está archivada.
 */
export function assertNotArchived(organization: LockedOrganization) {
  if (organization.isArchived) {
    throw apiError(ErrorCodes.ORGANIZATION_ARCHIVED);
  }
}
