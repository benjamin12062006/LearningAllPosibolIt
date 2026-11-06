import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import type { PageRequest } from '../common/http/pagination.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  membershipChangeError,
  type MembershipChange,
} from './membership-rules.js';
import { canOwnAnotherTeam } from './organization-limits.js';
import { assertNotArchived, lockOrganization } from './organization-lock.js';
import { can, type OrganizationRole } from './organization-roles.js';
import type {
  OrganizationMember,
  OrganizationMembership,
} from './organizations.types.js';

/** Fila tal como sale de SQL; `kind` se calcula después. */
type MembershipRow = Readonly<{
  id: string;
  name: string;
  isPersonal: boolean;
  role: OrganizationRole;
  createdAt: string;
  archivedAt: string | null;
}>;

/** Mismo nombre que pone la migración a las organizaciones heredadas. */
const PERSONAL_ORGANIZATION_NAME = 'Personal';

/** Columnas de `organizations o JOIN organization_members m`. */
const MEMBERSHIP_COLUMNS = Prisma.sql`
  o.id,
  o.name,
  o.personal_owner_id IS NOT NULL AS "isPersonal",
  m.role,
  o.created_at AS "createdAt",
  o.archived_at AS "archivedAt"
`;

/** Columnas de `organization_members m JOIN app_users u`. */
const MEMBER_COLUMNS = Prisma.sql`
  m.user_id AS "userId",
  u.display_name AS "displayName",
  u.email,
  m.role,
  m.created_at AS "joinedAt"
`;

/**
 * Toda lectura parte de la membresía del usuario: una organización donde no es
 * miembro no aparece aunque se conozca su ID.
 */
@Injectable()
export class OrganizationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Siempre acotado: el llamador decide la ventana (`limit`/`offset`). */
  async findMemberships(
    userId: string,
    page: PageRequest,
  ): Promise<OrganizationMembership[]> {
    const rows = await this.prisma.$queryRaw<MembershipRow[]>(Prisma.sql`
      SELECT ${MEMBERSHIP_COLUMNS}
      FROM estadistica_forms.organization_members m
      JOIN estadistica_forms.organizations o ON o.id = m.organization_id
      WHERE m.user_id = ${userId}
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT ${page.limit} OFFSET ${page.offset}
    `);
    return rows.map(toMembership);
  }

  findMembership(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationMembership | null> {
    return findMembershipIn(this.prisma, userId, organizationId);
  }

  /**
   * Organización de equipo: quien la crea es su primer `owner`. La fila del
   * usuario se bloquea para contar sus equipos sin carreras (Q2, F39).
   */
  async createTeam(
    userId: string,
    name: string,
  ): Promise<OrganizationMembership> {
    const organizationId = randomUUID();
    const now = new Date().toISOString();

    await this.prisma.$transaction(async (tx) => {
      const ownedTeams = await lockUserAndCountOwnedTeams(tx, userId);
      if (!canOwnAnotherTeam(ownedTeams)) {
        throw apiError(ErrorCodes.TEAM_ORGANIZATIONS_LIMIT);
      }

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO estadistica_forms.organizations
          (id, name, personal_owner_id, created_at)
        VALUES (${organizationId}, ${name}, NULL, ${now})
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO estadistica_forms.organization_members
          (organization_id, user_id, role, created_at)
        VALUES (${organizationId}, ${userId}, 'owner', ${now})
      `);
    });

    return {
      id: organizationId,
      name,
      kind: 'team',
      role: 'owner',
      createdAt: now,
      archivedAt: null,
    };
  }

  /** Miembros de una organización, solo si quien pregunta es uno de ellos. */
  async findMembers(
    viewerId: string,
    organizationId: string,
    page: PageRequest,
  ): Promise<OrganizationMember[]> {
    return this.prisma.$queryRaw<OrganizationMember[]>(Prisma.sql`
      SELECT ${MEMBER_COLUMNS}
      FROM estadistica_forms.organization_members m
      JOIN estadistica_forms.app_users u ON u.id = m.user_id
      WHERE m.organization_id = ${organizationId}
        AND EXISTS (
          SELECT 1
          FROM estadistica_forms.organization_members viewer
          WHERE viewer.organization_id = m.organization_id
            AND viewer.user_id = ${viewerId}
        )
      ORDER BY m.created_at, m.user_id
      LIMIT ${page.limit} OFFSET ${page.offset}
    `);
  }

  async changeRole(
    actorId: string,
    organizationId: string,
    targetUserId: string,
    role: OrganizationRole,
  ): Promise<OrganizationMember> {
    return this.prisma.$transaction(async (tx) => {
      await lockAndCheckChange(tx, {
        actorId,
        organizationId,
        targetUserId,
        change: { kind: 'change-role', role },
      });
      await tx.$executeRaw(Prisma.sql`
        UPDATE estadistica_forms.organization_members
        SET role = ${role}
        WHERE organization_id = ${organizationId}
          AND user_id = ${targetUserId}
      `);
      const rows = await tx.$queryRaw<OrganizationMember[]>(Prisma.sql`
        SELECT ${MEMBER_COLUMNS}
        FROM estadistica_forms.organization_members m
        JOIN estadistica_forms.app_users u ON u.id = m.user_id
        WHERE m.organization_id = ${organizationId}
          AND m.user_id = ${targetUserId}
      `);
      return rows[0];
    });
  }

  async removeMember(
    actorId: string,
    organizationId: string,
    targetUserId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockAndCheckChange(tx, {
        actorId,
        organizationId,
        targetUserId,
        change: { kind: 'remove' },
      });
      await tx.$executeRaw(Prisma.sql`
        DELETE FROM estadistica_forms.organization_members
        WHERE organization_id = ${organizationId}
          AND user_id = ${targetUserId}
      `);
    });
  }

  /**
   * Archivar (`true`) o restaurar (`false`). Solo un owner (`organization.own`)
   * y nunca una organización personal. Repetir la misma operación no cambia
   * la fecha de archivado.
   */
  async setArchived(
    actorId: string,
    organizationId: string,
    archived: boolean,
  ): Promise<OrganizationMembership> {
    const now = new Date().toISOString();

    return this.prisma.$transaction(async (tx) => {
      const organization = await lockOrganization(tx, organizationId);
      const actor = await findMembershipIn(tx, actorId, organizationId);
      if (!organization || !actor) {
        throw apiError(ErrorCodes.ORGANIZATION_NOT_FOUND);
      }
      if (!can(actor.role, 'organization.own')) {
        throw apiError(ErrorCodes.FORBIDDEN);
      }
      if (organization.isPersonal) {
        throw apiError(ErrorCodes.ORGANIZATION_PERSONAL_NOT_ARCHIVABLE);
      }

      await tx.$executeRaw(Prisma.sql`
        UPDATE estadistica_forms.organizations
        SET archived_at = CASE
          WHEN ${archived} THEN COALESCE(archived_at, ${now})
          ELSE NULL
        END
        WHERE id = ${organizationId}
      `);
      const updated = await findMembershipIn(tx, actorId, organizationId);
      return updated ?? actor;
    });
  }
}

/** Lectura de una membresía con el cliente normal o dentro de una transacción. */
async function findMembershipIn(
  client: Prisma.TransactionClient,
  userId: string,
  organizationId: string,
): Promise<OrganizationMembership | null> {
  const rows = await client.$queryRaw<MembershipRow[]>(Prisma.sql`
    SELECT ${MEMBERSHIP_COLUMNS}
    FROM estadistica_forms.organization_members m
    JOIN estadistica_forms.organizations o ON o.id = m.organization_id
    WHERE m.user_id = ${userId}
      AND m.organization_id = ${organizationId}
  `);
  return rows[0] ? toMembership(rows[0]) : null;
}

/** Equipos (no personales) donde el usuario es owner, archivados incluidos. */
async function lockUserAndCountOwnedTeams(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<number> {
  await tx.$queryRaw(Prisma.sql`
    SELECT id
    FROM estadistica_forms.app_users
    WHERE id = ${userId}
    FOR UPDATE
  `);
  const rows = await tx.$queryRaw<{ total: number }[]>(Prisma.sql`
    SELECT count(*)::int AS total
    FROM estadistica_forms.organization_members m
    JOIN estadistica_forms.organizations o ON o.id = m.organization_id
    WHERE m.user_id = ${userId}
      AND m.role = 'owner'
      AND o.personal_owner_id IS NULL
  `);
  return rows[0]?.total ?? 0;
}

type LockedMemberRow = Readonly<{
  userId: string;
  role: OrganizationRole;
  isPersonalOwner: boolean;
}>;

/**
 * Bloquea la organización (A5) y las membresías que deciden el cambio (todos
 * los owners, el actor y el destino) y aplica las reglas sobre esas filas ya
 * bloqueadas.
 *
 * `FOR UPDATE` en orden de usuario: dos cambios simultáneos en la misma
 * organización se esperan, y el segundo vuelve a evaluar el `WHERE` sobre la
 * versión confirmada (F36). Si dos owners se degradan a la vez, el segundo ve
 * un solo owner y se rechaza. El permiso del actor también se lee aquí: una
 * degradación confirmada antes le quita el permiso.
 */
async function lockAndCheckChange(
  tx: Prisma.TransactionClient,
  request: Readonly<{
    actorId: string;
    organizationId: string;
    targetUserId: string;
    change: MembershipChange;
  }>,
) {
  const organization = await lockOrganization(tx, request.organizationId);
  const rows = await tx.$queryRaw<LockedMemberRow[]>(Prisma.sql`
    SELECT
      m.user_id AS "userId",
      m.role,
      o.personal_owner_id IS NOT DISTINCT FROM m.user_id AS "isPersonalOwner"
    FROM estadistica_forms.organization_members m
    JOIN estadistica_forms.organizations o ON o.id = m.organization_id
    WHERE m.organization_id = ${request.organizationId}
      AND (
        m.role = 'owner'
        OR m.user_id IN (${request.actorId}, ${request.targetUserId})
      )
    ORDER BY m.user_id
    FOR UPDATE OF m
  `);

  const actor = rows.find(({ userId }) => userId === request.actorId);
  if (!organization || !actor) {
    throw apiError(ErrorCodes.ORGANIZATION_NOT_FOUND);
  }
  assertNotArchived(organization);

  const target = rows.find(({ userId }) => userId === request.targetUserId);
  if (!target) {
    throw apiError(ErrorCodes.MEMBER_NOT_FOUND);
  }

  const error = membershipChangeError({
    actor,
    target,
    ownerCount: rows.filter(({ role }) => role === 'owner').length,
    change: request.change,
  });
  if (error) {
    throw apiError(error);
  }
}

/**
 * Devuelve la organización personal del usuario y la crea, con él como
 * `owner`, si todavía no existe. Es la doble escritura de la transición: un
 * proyecto nuevo nunca nace sin organización. Recibe la transacción de quien
 * crea el proyecto para que ambas cosas se confirmen juntas.
 *
 * Devuelve `null` si el usuario no existe.
 */
export async function ensurePersonalOrganization(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<string | null> {
  const now = new Date().toISOString();

  // `personal_owner_id` es único: si otra petición del mismo usuario la está
  // creando, esta espera a que confirme y no inserta otra.
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO estadistica_forms.organizations
      (id, name, personal_owner_id, created_at)
    SELECT ${randomUUID()}, ${PERSONAL_ORGANIZATION_NAME}, id, ${now}
    FROM estadistica_forms.app_users
    WHERE id = ${userId}
    ON CONFLICT (personal_owner_id) DO NOTHING
  `);

  // Si la membresía ya existe, se conserva su rol tal como esté.
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO estadistica_forms.organization_members
      (organization_id, user_id, role, created_at)
    SELECT id, personal_owner_id, 'owner', ${now}
    FROM estadistica_forms.organizations
    WHERE personal_owner_id = ${userId}
    ON CONFLICT (organization_id, user_id) DO NOTHING
  `);

  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id
    FROM estadistica_forms.organizations
    WHERE personal_owner_id = ${userId}
  `);
  return rows[0]?.id ?? null;
}

function toMembership(row: MembershipRow): OrganizationMembership {
  return {
    id: row.id,
    name: row.name,
    kind: row.isPersonal ? 'personal' : 'team',
    role: row.role,
    createdAt: row.createdAt,
    archivedAt: row.archivedAt,
  };
}
