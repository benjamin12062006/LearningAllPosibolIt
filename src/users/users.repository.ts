import { ErrorCodes } from '../common/http/error-codes.js';
import { Injectable } from '@nestjs/common';
import { apiError } from '../common/http/api-error.js';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';

export type LocalUser = Readonly<{
  id: string;
  email: string | null;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
}>;

type UserProjection = Readonly<{
  id: string;
  email: string | null;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
}>;

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async provision(identity: AuthenticatedIdentity): Promise<LocalUser> {
    const now = new Date().toISOString();
    const rows = await this.prisma.$queryRaw<UserProjection[]>(Prisma.sql`
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
        ON CONFLICT(identity_issuer, identity_subject) DO UPDATE SET
          email = COALESCE(excluded.email, app_users.email),
          updated_at = CASE
            WHEN excluded.email IS NOT NULL AND excluded.email IS DISTINCT FROM app_users.email
            THEN excluded.updated_at
            ELSE app_users.updated_at
          END
        RETURNING
          id,
          email,
          display_name AS "displayName",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
    `);

    const row = rows[0];
    if (!row) {
      throw apiError(ErrorCodes.INTERNAL_ERROR);
    }

    return this.toLocalUser(row);
  }

  async findByIdentity(
    identity: AuthenticatedIdentity,
  ): Promise<LocalUser | null> {
    const rows = await this.prisma.$queryRaw<UserProjection[]>(Prisma.sql`
      SELECT
        id,
        email,
        display_name AS "displayName",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM estadistica_forms.app_users
      WHERE identity_issuer = ${identity.issuer}
        AND identity_subject = ${identity.subject}
    `);

    const row = rows[0];
    return row ? this.toLocalUser(row) : null;
  }

  async updateDisplayName(
    identity: AuthenticatedIdentity,
    displayName: string | null,
  ): Promise<LocalUser | null> {
    const rows = await this.prisma.$queryRaw<UserProjection[]>(Prisma.sql`
      UPDATE estadistica_forms.app_users SET
        display_name = ${displayName},
        updated_at = CASE
          WHEN display_name IS DISTINCT FROM ${displayName} THEN ${new Date().toISOString()}
          ELSE updated_at
        END
      WHERE identity_issuer = ${identity.issuer}
        AND identity_subject = ${identity.subject}
      RETURNING
        id,
        email,
        display_name AS "displayName",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `);

    const row = rows[0];
    return row ? this.toLocalUser(row) : null;
  }

  private toLocalUser(row: UserProjection): LocalUser {
    return {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
