import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import type { PageRequest } from '../common/http/pagination.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { OrganizationRole } from '../organizations/organization-roles.js';
import { ensurePersonalOrganization } from '../organizations/organizations.repository.js';
import {
  hasCompleteConfiguration,
  type Project,
  type ProjectConfiguration,
  type ProjectUpdate,
} from './projects.types.js';

/** Fila tal como sale de SQL; `configurationStatus` se calcula después. */
type ProjectRow = Omit<Project, 'configurationStatus'>;

type ProjectMemberRow = Readonly<{
  organizationId: string;
  role: OrganizationRole;
}>;

const PROJECT_COLUMNS = Prisma.sql`
  id,
  name,
  country,
  currency,
  channel_profile AS "channelProfile",
  created_at AS "createdAt"
`;

@Injectable()
export class ProjectsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Siempre acotado: el llamador decide la ventana (`limit`/`offset`). */
  async findAllByOwner(
    ownerId: string,
    page: { limit: number; offset: number },
  ): Promise<Project[]> {
    const rows = await this.prisma.$queryRaw<ProjectRow[]>(Prisma.sql`
      SELECT ${PROJECT_COLUMNS}
      FROM estadistica_forms.projects
      WHERE owner_id = ${ownerId}
      ORDER BY created_at DESC, id DESC
      LIMIT ${page.limit} OFFSET ${page.offset}
    `);
    return rows.map(toProject);
  }

  async findByOwner(ownerId: string, id: string): Promise<Project | null> {
    const rows = await this.prisma.$queryRaw<ProjectRow[]>(Prisma.sql`
      SELECT ${PROJECT_COLUMNS}
      FROM estadistica_forms.projects
      WHERE id = ${id} AND owner_id = ${ownerId}
    `);
    return rows[0] ? toProject(rows[0]) : null;
  }

  /**
   * Inserta desde `app_users`: si el propietario ya no existe, no se crea nada.
   * El proyecto nace dentro de la organización personal de quien lo crea, en la
   * misma transacción (doble escritura de la transición a organizaciones).
   */
  async create(
    ownerId: string,
    name: string,
    configuration: ProjectConfiguration,
  ): Promise<Project> {
    return this.prisma.$transaction(async (tx) => {
      const organizationId = await ensurePersonalOrganization(tx, ownerId);
      if (!organizationId) {
        throw apiError(ErrorCodes.PROFILE_NOT_FOUND);
      }

      const rows = await tx.$queryRaw<ProjectRow[]>(Prisma.sql`
        INSERT INTO estadistica_forms.projects
          (id, name, owner_id, organization_id, created_at, country, currency, channel_profile)
        SELECT
          ${randomUUID()},
          ${name},
          id,
          ${organizationId},
          ${new Date().toISOString()},
          ${configuration.country},
          ${configuration.currency},
          ${configuration.channelProfile}
        FROM estadistica_forms.app_users
        WHERE id = ${ownerId}
        RETURNING ${PROJECT_COLUMNS}
      `);
      if (!rows[0]) {
        throw apiError(ErrorCodes.PROFILE_NOT_FOUND);
      }
      return toProject(rows[0]);
    });
  }

  /**
   * Cambia el nombre y, si llega, la configuración completa. La configuración
   * queda bloqueada en cuanto el proyecto tiene una importación, porque cada
   * importación guarda la configuración con la que se hizo.
   */
  async update(
    ownerId: string,
    id: string,
    update: ProjectUpdate,
  ): Promise<Project | null> {
    const updatesConfiguration = update.country !== undefined;

    return this.prisma.$transaction(async (tx) => {
      // FOR UPDATE: ninguna importación puede aceptarse mientras se decide.
      const lockedRows = await tx.$queryRaw<ProjectRow[]>(Prisma.sql`
        SELECT ${PROJECT_COLUMNS}
        FROM estadistica_forms.projects
        WHERE id = ${id} AND owner_id = ${ownerId}
        FOR UPDATE
      `);
      const current = lockedRows[0];
      if (!current) {
        return null;
      }

      if (updatesConfiguration && changesConfiguration(current, update)) {
        const imports = await tx.catalogSnapshot.count({
          where: { projectId: id },
        });
        if (imports > 0) {
          throw apiError(ErrorCodes.PROJECT_CONFIGURATION_LOCKED);
        }
      }

      const rows = await tx.$queryRaw<ProjectRow[]>(Prisma.sql`
        UPDATE estadistica_forms.projects SET
          name = COALESCE(${update.name ?? null}, name),
          country = CASE WHEN ${updatesConfiguration}
            THEN ${update.country ?? null} ELSE country END,
          currency = CASE WHEN ${updatesConfiguration}
            THEN ${update.currency ?? null} ELSE currency END,
          channel_profile = CASE WHEN ${updatesConfiguration}
            THEN ${update.channelProfile ?? null} ELSE channel_profile END
        WHERE id = ${id} AND owner_id = ${ownerId}
        RETURNING ${PROJECT_COLUMNS}
      `);
      return rows[0] ? toProject(rows[0]) : null;
    });
  }

  // ── Lecturas por membresía (ampliación E1.1) ──
  // La membresía va en la consulta, no solo en la comprobación previa del
  // servicio: un ID de otra organización no devuelve filas.

  async findAllInOrganization(
    userId: string,
    organizationId: string,
    page: PageRequest,
  ): Promise<Project[]> {
    const rows = await this.prisma.$queryRaw<ProjectRow[]>(Prisma.sql`
      SELECT ${PROJECT_COLUMNS}
      FROM estadistica_forms.projects
      WHERE organization_id = ${organizationId}
        AND EXISTS (
          SELECT 1
          FROM estadistica_forms.organization_members m
          WHERE m.organization_id = projects.organization_id
            AND m.user_id = ${userId}
        )
      ORDER BY created_at DESC, id DESC
      LIMIT ${page.limit} OFFSET ${page.offset}
    `);
    return rows.map(toProject);
  }

  /** Organización del proyecto y rol del usuario en ella; `null` si no es miembro. */
  async findMemberAccess(
    userId: string,
    projectId: string,
  ): Promise<ProjectMemberRow | null> {
    const rows = await this.prisma.$queryRaw<ProjectMemberRow[]>(Prisma.sql`
      SELECT
        p.organization_id AS "organizationId",
        m.role
      FROM estadistica_forms.projects p
      JOIN estadistica_forms.organization_members m
        ON m.organization_id = p.organization_id AND m.user_id = ${userId}
      WHERE p.id = ${projectId}
    `);
    return rows[0] ?? null;
  }
}

function toProject(row: ProjectRow): Project {
  return {
    ...row,
    configurationStatus: hasCompleteConfiguration(row) ? 'ready' : 'required',
  };
}

function changesConfiguration(current: ProjectRow, update: ProjectUpdate) {
  return (
    current.country !== update.country ||
    current.currency !== update.currency ||
    current.channelProfile !== update.channelProfile
  );
}
