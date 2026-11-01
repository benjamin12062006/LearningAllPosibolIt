import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { PrismaService } from '../database/prisma.service.js';
import { isRuleset, type Ruleset } from '../evaluations/engine/ruleset.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  hasCompleteConfiguration,
  type ChannelProfile,
} from '../projects/projects.types.js';
import type { RulesetVersion } from './rulesets.types.js';

type ProjectConfigurationRow = {
  country: string | null;
  currency: string | null;
  channelProfile: ChannelProfile | null;
};

type NextRevisionRow = { revision: number };

/** `mapping` y `rules` llegan sin tipo desde `jsonb`; se comprueban al leer. */
type RulesetVersionRow = {
  id: string;
  revision: number;
  mapping: unknown;
  rules: unknown;
  createdAt: string;
};

const RULESET_COLUMNS = Prisma.sql`
  id,
  revision,
  mapping,
  rules,
  created_at AS "createdAt"
`;

@Injectable()
export class RulesetsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Guarda el ruleset como la revisión siguiente del proyecto. Si a pesar del
   * bloqueo otra versión ocupa ese número, responde 409 en lugar de 500.
   */
  async create(
    ownerId: string,
    projectId: string,
    ruleset: Ruleset,
  ): Promise<RulesetVersion> {
    try {
      return await this.insertNextRevision(ownerId, projectId, ruleset);
    } catch (error) {
      throw asRevisionConflict(error);
    }
  }

  /** De la más reciente a la más antigua, siempre acotado por el llamador. */
  async findAllByProject(
    projectId: string,
    page: { limit: number; offset: number },
  ): Promise<RulesetVersion[]> {
    const rows = await this.prisma.$queryRaw<RulesetVersionRow[]>(Prisma.sql`
      SELECT ${RULESET_COLUMNS}
      FROM estadistica_forms.ruleset_versions
      WHERE project_id = ${projectId}
      ORDER BY revision DESC
      LIMIT ${page.limit} OFFSET ${page.offset}
    `);
    return rows.map(toRulesetVersion);
  }

  async findByRevision(
    projectId: string,
    revision: number,
  ): Promise<RulesetVersion | null> {
    const rows = await this.prisma.$queryRaw<RulesetVersionRow[]>(Prisma.sql`
      SELECT ${RULESET_COLUMNS}
      FROM estadistica_forms.ruleset_versions
      WHERE project_id = ${projectId} AND revision = ${revision}
    `);
    return rows[0] ? toRulesetVersion(rows[0]) : null;
  }

  private insertNextRevision(
    ownerId: string,
    projectId: string,
    ruleset: Ruleset,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await lockConfiguredProject(tx, ownerId, projectId);
      const revision = await this.nextRevision(tx, projectId);

      // Con la API del modelo, una clave repetida llega como P2002; con
      // `$queryRaw` llegaría como P2010 (experimento 04 de la ficha de fuentes).
      const row = await tx.rulesetVersion.create({
        data: {
          id: randomUUID(),
          projectId,
          revision,
          mapping: ruleset.mapping,
          rules: ruleset.rules,
          createdAt: new Date().toISOString(),
        },
        select: {
          id: true,
          revision: true,
          mapping: true,
          rules: true,
          createdAt: true,
        },
      });
      return toRulesetVersion(row);
    });
  }

  /** Método propio para que una prueba pueda forzar una colisión de revisión. */
  private async nextRevision(tx: Prisma.TransactionClient, projectId: string) {
    const rows = await tx.$queryRaw<NextRevisionRow[]>`
      SELECT (COALESCE(MAX(revision), 0) + 1)::int AS "revision"
      FROM estadistica_forms.ruleset_versions
      WHERE project_id = ${projectId}`;
    return rows[0].revision;
  }
}

/**
 * FOR UPDATE bloquea la fila del proyecto hasta el final de la transacción: dos
 * guardados simultáneos no pueden leer el mismo máximo de revisión. Es el mismo
 * bloqueo que usan aceptar y borrar importaciones.
 */
async function lockConfiguredProject(
  tx: Prisma.TransactionClient,
  ownerId: string,
  projectId: string,
) {
  const projects = await tx.$queryRaw<ProjectConfigurationRow[]>`
    SELECT
      country,
      currency,
      channel_profile AS "channelProfile"
    FROM estadistica_forms.projects
    WHERE id = ${projectId} AND owner_id = ${ownerId}
    FOR UPDATE`;
  const project = projects[0];
  if (!project) {
    throw apiError(ErrorCodes.PROJECT_NOT_FOUND);
  }
  // El mapeo se valida contra el perfil del canal: sin configuración no hay perfil.
  if (!hasCompleteConfiguration(project)) {
    throw apiError(ErrorCodes.PROJECT_CONFIGURATION_REQUIRED);
  }
}

/**
 * Dentro del alta, la única clave única que puede repetirse es
 * `(project_id, revision)`: el ID es un UUID nuevo.
 */
function asRevisionConflict(error: unknown) {
  const isUniqueViolation =
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002';
  return isUniqueViolation
    ? apiError(ErrorCodes.RULESET_REVISION_CONFLICT)
    : error;
}

function toRulesetVersion(row: RulesetVersionRow): RulesetVersion {
  const stored = { mapping: row.mapping, rules: row.rules };
  if (!isRuleset(stored)) {
    // Solo la API escribe esta tabla; una forma distinta es un error del backend.
    throw new Error(`La versión de reglas ${row.id} tiene una forma inválida.`);
  }
  return {
    id: row.id,
    revision: row.revision,
    mapping: stored.mapping,
    rules: stored.rules,
    createdAt: row.createdAt,
  };
}
