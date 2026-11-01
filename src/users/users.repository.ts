import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';

export type LocalUser = Readonly<{
  id: string;
  email: string | null;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
}>;

/** Columnas de `app_users` con los nombres de `LocalUser`. */
const USER_COLUMNS = Prisma.sql`
  id,
  email,
  display_name AS "displayName",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crea el usuario local la primera vez que llega una identidad. Si ya existe,
   * solo actualiza el email cuando Descope envía uno distinto.
   */
  async provision(identity: AuthenticatedIdentity): Promise<LocalUser> {
    const now = new Date().toISOString();
    const rows = await this.prisma.$queryRaw<LocalUser[]>(Prisma.sql`
      INSERT INTO estadistica_forms.app_users
        (id, identity_issuer, identity_subject, email, display_name, created_at, updated_at)
      VALUES (
        ${randomUUID()},
        ${identity.issuer},
        ${identity.subject},
        ${identity.email ?? null},
        NULL,
        ${now},
        ${now}
      )
      ON CONFLICT (identity_issuer, identity_subject) DO UPDATE SET
        email = COALESCE(excluded.email, app_users.email),
        updated_at = CASE
          WHEN excluded.email IS NOT NULL AND excluded.email IS DISTINCT FROM app_users.email
          THEN excluded.updated_at
          ELSE app_users.updated_at
        END
      RETURNING ${USER_COLUMNS}
    `);

    const user = rows[0];
    if (!user) {
      throw apiError(ErrorCodes.INTERNAL_ERROR);
    }
    return user;
  }

  async findByIdentity(
    identity: AuthenticatedIdentity,
  ): Promise<LocalUser | null> {
    const rows = await this.prisma.$queryRaw<LocalUser[]>(Prisma.sql`
      SELECT ${USER_COLUMNS}
      FROM estadistica_forms.app_users
      WHERE identity_issuer = ${identity.issuer}
        AND identity_subject = ${identity.subject}
    `);
    return rows[0] ?? null;
  }

  /** `updated_at` solo cambia si el nombre visible cambia de verdad. */
  async updateDisplayName(
    identity: AuthenticatedIdentity,
    displayName: string | null,
  ): Promise<LocalUser | null> {
    const rows = await this.prisma.$queryRaw<LocalUser[]>(Prisma.sql`
      UPDATE estadistica_forms.app_users SET
        display_name = ${displayName},
        updated_at = CASE
          WHEN display_name IS DISTINCT FROM ${displayName} THEN ${new Date().toISOString()}
          ELSE updated_at
        END
      WHERE identity_issuer = ${identity.issuer}
        AND identity_subject = ${identity.subject}
      RETURNING ${USER_COLUMNS}
    `);
    return rows[0] ?? null;
  }
}
