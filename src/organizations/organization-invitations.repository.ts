import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import type { PageRequest } from '../common/http/pagination.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { hasFreeSeat } from './organization-limits.js';
import { assertNotArchived, lockOrganization } from './organization-lock.js';
import {
  can,
  canManageRole,
  type OrganizationRole,
} from './organization-roles.js';
import type { OrganizationInvitation } from './organizations.types.js';

export type NewInvitation = Readonly<{
  actorId: string;
  organizationId: string;
  email: string;
  role: OrganizationRole;
  tokenHash: string;
  now: string;
  expiresAt: string;
}>;

export type InvitationAcceptance = Readonly<{
  userId: string;
  /** Correo de la sesión, ya normalizado; `null` si la sesión no trae ninguno. */
  sessionEmail: string | null;
  tokenHash: string;
  now: string;
}>;

type PendingInvitationRow = Readonly<{
  id: string;
  organizationId: string;
  email: string;
  role: OrganizationRole;
}>;

/** Columnas públicas de `organization_invitations i`; nunca el hash del token. */
const INVITATION_COLUMNS = Prisma.sql`
  i.id,
  i.email_normalized AS "email",
  i.role,
  i.created_at AS "createdAt",
  i.expires_at AS "expiresAt"
`;

/**
 * Pendiente = ni aceptada ni revocada ni caducada. Todas las fechas son texto
 * ISO-8601 UTC del mismo formato, así que se comparan como texto.
 */
function isPendingAt(now: string) {
  return Prisma.sql`
    i.accepted_at IS NULL
    AND i.revoked_at IS NULL
    AND i.expires_at > ${now}
  `;
}

@Injectable()
export class OrganizationInvitationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Peticiones de quien gestiona miembros ──

  /**
   * Invitar otra vez el mismo correo revoca la pendiente anterior y crea otra
   * con token nuevo (T3). La invitación reserva una plaza (Q3); la que se
   * sustituye no cuenta. El permiso se comprueba con la fila del actor
   * bloqueada, igual que al cambiar roles.
   */
  async create(input: NewInvitation): Promise<OrganizationInvitation> {
    return this.prisma.$transaction(async (tx) => {
      const actorRole = await lockWritableOrganization(
        tx,
        input.actorId,
        input.organizationId,
      );
      assertCanManage(actorRole, input.role);
      await assertNotMember(tx, input.organizationId, input.email);
      await assertSeatForInvitation(tx, input);

      await tx.$executeRaw(Prisma.sql`
        UPDATE estadistica_forms.organization_invitations
        SET revoked_at = ${input.now}
        WHERE organization_id = ${input.organizationId}
          AND email_normalized = ${input.email}
          AND accepted_at IS NULL
          AND revoked_at IS NULL
      `);
      const rows = await tx.$queryRaw<OrganizationInvitation[]>(Prisma.sql`
        INSERT INTO estadistica_forms.organization_invitations AS i
          (id, organization_id, email_normalized, role, token_hash, invited_by, created_at, expires_at)
        VALUES (
          ${randomUUID()},
          ${input.organizationId},
          ${input.email},
          ${input.role},
          ${input.tokenHash},
          ${input.actorId},
          ${input.now},
          ${input.expiresAt}
        )
        RETURNING ${INVITATION_COLUMNS}
      `);
      return rows[0];
    });
  }

  async findPending(
    organizationId: string,
    now: string,
    page: PageRequest,
  ): Promise<OrganizationInvitation[]> {
    return this.prisma.$queryRaw<OrganizationInvitation[]>(Prisma.sql`
      SELECT ${INVITATION_COLUMNS}
      FROM estadistica_forms.organization_invitations i
      WHERE i.organization_id = ${organizationId}
        AND ${isPendingAt(now)}
      ORDER BY i.created_at DESC, i.id DESC
      LIMIT ${page.limit} OFFSET ${page.offset}
    `);
  }

  async revoke(
    actorId: string,
    organizationId: string,
    invitationId: string,
    now: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const actorRole = await lockWritableOrganization(
        tx,
        actorId,
        organizationId,
      );
      if (!can(actorRole, 'members.manage')) {
        throw apiError(ErrorCodes.FORBIDDEN);
      }

      const pending = await findPendingForUpdate(
        tx,
        Prisma.sql`i.id = ${invitationId} AND i.organization_id = ${organizationId}`,
        now,
      );
      if (!pending) {
        throw apiError(ErrorCodes.INVITATION_NOT_FOUND);
      }
      assertCanManage(actorRole, pending.role);

      await tx.$executeRaw(Prisma.sql`
        UPDATE estadistica_forms.organization_invitations
        SET revoked_at = ${now}
        WHERE id = ${invitationId}
      `);
    });
  }

  // ── Petición de la persona invitada ──

  /**
   * Consume la invitación y crea la membresía en la misma transacción. Si la
   * persona ya es miembro, la invitación no se consume.
   *
   * Primero se averigua de qué organización es, sin bloquear; después se
   * bloquea la organización y solo entonces la invitación. Es el mismo orden
   * que al invitar (que revoca invitaciones con la organización bloqueada):
   * con el orden contrario, las dos transacciones podrían esperarse entre sí.
   *
   * @returns el ID de la organización a la que se unió.
   */
  async accept(acceptance: InvitationAcceptance): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const organizationId = await findOrganizationOfToken(
        tx,
        acceptance.tokenHash,
      );
      const organization = organizationId
        ? await lockOrganization(tx, organizationId)
        : null;
      const invitation = await findPendingForUpdate(
        tx,
        Prisma.sql`i.token_hash = ${acceptance.tokenHash}`,
        acceptance.now,
      );
      if (!organization || !invitation) {
        throw apiError(ErrorCodes.INVITATION_NOT_FOUND);
      }
      if (invitation.email !== acceptance.sessionEmail) {
        throw apiError(ErrorCodes.INVITATION_EMAIL_MISMATCH);
      }
      assertNotArchived(organization);
      await assertSeatForMember(tx, invitation.organizationId);

      const inserted = await tx.$executeRaw(Prisma.sql`
        INSERT INTO estadistica_forms.organization_members
          (organization_id, user_id, role, created_at)
        VALUES (
          ${invitation.organizationId},
          ${acceptance.userId},
          ${invitation.role},
          ${acceptance.now}
        )
        ON CONFLICT (organization_id, user_id) DO NOTHING
      `);
      if (inserted === 0) {
        throw apiError(ErrorCodes.MEMBER_ALREADY_EXISTS);
      }

      await tx.$executeRaw(Prisma.sql`
        UPDATE estadistica_forms.organization_invitations
        SET accepted_at = ${acceptance.now},
          accepted_by = ${acceptance.userId}
        WHERE id = ${invitation.id}
      `);
      return invitation.organizationId;
    });
  }
}

/**
 * Bloquea la invitación pendiente que cumple `match`. `FOR UPDATE`: dos
 * aceptaciones del mismo token se esperan y la segunda ya no la ve pendiente.
 */
async function findPendingForUpdate(
  tx: Prisma.TransactionClient,
  match: Prisma.Sql,
  now: string,
): Promise<PendingInvitationRow | null> {
  const rows = await tx.$queryRaw<PendingInvitationRow[]>(Prisma.sql`
    SELECT
      i.id,
      i.organization_id AS "organizationId",
      i.email_normalized AS "email",
      i.role
    FROM estadistica_forms.organization_invitations i
    WHERE ${match}
      AND ${isPendingAt(now)}
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

/**
 * Primer paso de quien gestiona invitaciones: bloquea la organización (A5) y la
 * membresía del actor. Si no es miembro, 404; si está archivada, 409, en ese
 * orden para no revelar nada a quien no es miembro.
 */
async function lockWritableOrganization(
  tx: Prisma.TransactionClient,
  actorId: string,
  organizationId: string,
): Promise<OrganizationRole> {
  const organization = await lockOrganization(tx, organizationId);
  const actorRole = await lockActorRole(tx, actorId, organizationId);
  if (!organization) {
    throw apiError(ErrorCodes.ORGANIZATION_NOT_FOUND);
  }
  assertNotArchived(organization);
  return actorRole;
}

/**
 * Rol del actor con su membresía bloqueada: una revocación o degradación
 * confirmada antes ya se ve aquí, y ninguna puede confirmarse mientras dura
 * esta transacción. Si no es miembro, 404.
 */
async function lockActorRole(
  tx: Prisma.TransactionClient,
  actorId: string,
  organizationId: string,
): Promise<OrganizationRole> {
  const rows = await tx.$queryRaw<{ role: OrganizationRole }[]>(Prisma.sql`
    SELECT role
    FROM estadistica_forms.organization_members
    WHERE organization_id = ${organizationId}
      AND user_id = ${actorId}
    FOR UPDATE
  `);
  if (!rows[0]) {
    throw apiError(ErrorCodes.ORGANIZATION_NOT_FOUND);
  }
  return rows[0].role;
}

function assertCanManage(actorRole: OrganizationRole, role: OrganizationRole) {
  if (!canManageRole(actorRole, role)) {
    throw apiError(ErrorCodes.FORBIDDEN);
  }
}

async function findOrganizationOfToken(
  tx: Prisma.TransactionClient,
  tokenHash: string,
): Promise<string | null> {
  const rows = await tx.$queryRaw<{ organizationId: string }[]>(Prisma.sql`
    SELECT organization_id AS "organizationId"
    FROM estadistica_forms.organization_invitations
    WHERE token_hash = ${tokenHash}
  `);
  return rows[0]?.organizationId ?? null;
}

/**
 * Plazas ocupadas = miembros + invitaciones pendientes, sin contar la del mismo
 * correo, que esta invitación sustituye.
 */
async function assertSeatForInvitation(
  tx: Prisma.TransactionClient,
  invitation: NewInvitation,
) {
  const rows = await tx.$queryRaw<{ occupied: number }[]>(Prisma.sql`
    SELECT
      (
        SELECT count(*)
        FROM estadistica_forms.organization_members
        WHERE organization_id = ${invitation.organizationId}
      )::int
      + (
        SELECT count(*)
        FROM estadistica_forms.organization_invitations i
        WHERE i.organization_id = ${invitation.organizationId}
          AND i.email_normalized <> ${invitation.email}
          AND ${isPendingAt(invitation.now)}
      )::int AS occupied
  `);
  if (!hasFreeSeat(rows[0]?.occupied ?? 0)) {
    throw apiError(ErrorCodes.ORGANIZATION_SEATS_LIMIT);
  }
}

/**
 * La invitación ya reservó su plaza; al aceptar solo se comprueba que los
 * miembros no hayan llegado al límite (por ejemplo, si se redujo después).
 */
async function assertSeatForMember(
  tx: Prisma.TransactionClient,
  organizationId: string,
) {
  const rows = await tx.$queryRaw<{ members: number }[]>(Prisma.sql`
    SELECT count(*)::int AS members
    FROM estadistica_forms.organization_members
    WHERE organization_id = ${organizationId}
  `);
  if (!hasFreeSeat(rows[0]?.members ?? 0)) {
    throw apiError(ErrorCodes.ORGANIZATION_SEATS_LIMIT);
  }
}

/** Invitar a quien ya es miembro no sirve de nada: se avisa en lugar de crearla. */
async function assertNotMember(
  tx: Prisma.TransactionClient,
  organizationId: string,
  email: string,
) {
  const rows = await tx.$queryRaw<{ found: boolean }[]>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1
      FROM estadistica_forms.organization_members m
      JOIN estadistica_forms.app_users u ON u.id = m.user_id
      WHERE m.organization_id = ${organizationId}
        AND lower(btrim(u.email)) = ${email}
    ) AS found
  `);
  if (rows[0]?.found) {
    throw apiError(ErrorCodes.MEMBER_ALREADY_EXISTS);
  }
}
