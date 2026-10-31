import { ErrorCodes } from '../common/http/error-codes.js';
import { Injectable } from '@nestjs/common';
import { apiError } from '../common/http/api-error.js';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type {
  Project,
  ProjectConfiguration,
  ProjectUpdate,
} from './projects.types.js';

type ProjectRow = Omit<Project, 'configurationStatus'>;
const projection = Prisma.sql`
  id, name, country, currency, channel_profile AS "channelProfile",
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
      SELECT ${projection} FROM estadistica_forms.projects
      WHERE owner_id = ${ownerId}
      ORDER BY created_at DESC, id DESC
      LIMIT ${page.limit} OFFSET ${page.offset}
    `);
    return rows.map(toProject);
  }

  async findByOwner(ownerId: string, id: string): Promise<Project | null> {
    const rows = await this.prisma.$queryRaw<ProjectRow[]>(Prisma.sql`
      SELECT ${projection} FROM estadistica_forms.projects
      WHERE id = ${id} AND owner_id = ${ownerId}
    `);
    return rows[0] ? toProject(rows[0]) : null;
  }

  async create(
    ownerId: string,
    name: string,
    configuration: ProjectConfiguration,
  ): Promise<Project> {
    const rows = await this.prisma.$queryRaw<ProjectRow[]>(Prisma.sql`
      INSERT INTO estadistica_forms.projects
        (id, name, owner_id, created_at, country, currency, channel_profile)
      SELECT ${randomUUID()}, ${name}, id, ${new Date().toISOString()},
        ${configuration.country}, ${configuration.currency},
        ${configuration.channelProfile}
      FROM estadistica_forms.app_users WHERE id = ${ownerId}
      RETURNING ${projection}
    `);
    if (!rows[0]) {
      throw apiError(ErrorCodes.PROFILE_NOT_FOUND);
    }
    return toProject(rows[0]);
  }

  async update(
    ownerId: string,
    id: string,
    update: ProjectUpdate,
  ): Promise<Project | null> {
    const configure = update.country !== undefined;
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.$queryRaw<ProjectRow[]>(Prisma.sql`
        SELECT ${projection} FROM estadistica_forms.projects
        WHERE id=${id} AND owner_id=${ownerId} FOR UPDATE
      `);
      if (!current[0]) return null;
      if (
        configure &&
        (current[0].country !== update.country ||
          current[0].currency !== update.currency ||
          current[0].channelProfile !== update.channelProfile)
      ) {
        const snapshots = await tx.catalogSnapshot.count({
          where: { projectId: id },
        });
        if (snapshots > 0)
          throw apiError(ErrorCodes.PROJECT_CONFIGURATION_LOCKED);
      }
      const rows = await tx.$queryRaw<ProjectRow[]>(Prisma.sql`
      UPDATE estadistica_forms.projects SET
        name = COALESCE(${update.name ?? null}, name),
        country = CASE WHEN ${configure} THEN ${update.country ?? null} ELSE country END,
        currency = CASE WHEN ${configure} THEN ${update.currency ?? null} ELSE currency END,
        channel_profile = CASE WHEN ${configure}
          THEN ${update.channelProfile ?? null} ELSE channel_profile END
      WHERE id = ${id} AND owner_id = ${ownerId}
      RETURNING ${projection}
    `);
      return rows[0] ? toProject(rows[0]) : null;
    });
  }
}

function toProject(row: ProjectRow): Project {
  return {
    ...row,
    configurationStatus:
      row.country !== null &&
      row.currency !== null &&
      row.channelProfile !== null
        ? 'ready'
        : 'required',
  };
}
