import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  can,
  type OrganizationPermission,
  type OrganizationRole,
} from '../organizations/organization-roles.js';

/**
 * Acceso a un proyecto por la membresía en su organización (C6, E1.2): quien
 * lo creó deja de ser la llave; `owner_id` queda como procedencia ([11]).
 */

/** Rol de quien pregunta en la organización del proyecto y si está archivada. */
export type ProjectMemberAccess = Readonly<{
  organizationId: string;
  role: OrganizationRole;
  isArchived: boolean;
}>;

/**
 * Predicado SQL «quien pregunta es miembro de la organización del proyecto»,
 * para el `WHERE` de cada consulta (O8): un proyecto ajeno no devuelve filas.
 * `project` es la tabla o el alias de `projects` en la consulta.
 */
export function isProjectMember(
  actorId: string,
  project: Prisma.Sql = Prisma.raw('p'),
): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1
    FROM estadistica_forms.organization_members project_member
    WHERE project_member.organization_id = ${project}.organization_id
      AND project_member.user_id = ${actorId}
  )`;
}

/**
 * Columnas de acceso (`ProjectMemberAccess`) para una consulta sobre
 * `projects p` unida con `joinProjectAccess`.
 */
export const PROJECT_ACCESS_COLUMNS = Prisma.sql`
  p.organization_id AS "organizationId",
  m.role,
  o.archived_at IS NOT NULL AS "isArchived"
`;

/**
 * `projects p` con su organización `o` y la membresía `m` de quien actúa: sin
 * membresía no hay fila. Sirve para bloquear el proyecto (`FOR UPDATE OF p`) y
 * comprobar el permiso en la misma transacción que escribe.
 */
export function joinProjectAccess(actorId: string): Prisma.Sql {
  return Prisma.sql`
    JOIN estadistica_forms.organizations o ON o.id = p.organization_id
    JOIN estadistica_forms.organization_members m
      ON m.organization_id = p.organization_id AND m.user_id = ${actorId}
  `;
}

/**
 * En este orden ([11]): miembro (si no, 404, como si no existiera), organización
 * activa para escribir (409: archivada se lee, no cambia) y permiso (403).
 */
export function assertProjectPermission(
  access: ProjectMemberAccess | null,
  permission: OrganizationPermission,
): asserts access is ProjectMemberAccess {
  if (!access) {
    throw apiError(ErrorCodes.PROJECT_NOT_FOUND);
  }
  const isWrite = permission !== 'organization.read';
  if (isWrite && access.isArchived) {
    throw apiError(ErrorCodes.ORGANIZATION_ARCHIVED);
  }
  if (!can(access.role, permission)) {
    throw apiError(ErrorCodes.FORBIDDEN);
  }
}
