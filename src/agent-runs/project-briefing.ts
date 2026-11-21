import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { ProjectsService } from '../projects/projects.service.js';
import type { RunningRun } from './agent-runs.types.js';
import type { OperationContext } from './operations/agent-operation.js';
import { AgentOperationCatalog } from './operations/agent-operation-catalog.js';

type SheetRow = Readonly<{
  id: string;
  workbookId: string;
  workbook: string;
  name: string;
  revision: number;
  revisionId: string;
  rowCount: number;
  openDrafts: number;
}>;

type ColumnRow = Readonly<{
  sheetId: string;
  id: string;
  name: string;
  type: string;
  required: boolean;
}>;

type ActionRow = Readonly<{
  operation: string;
  summary: string;
  confirmedAt: string;
}>;

/**
 * Topes de la ficha (plan 10, D5): lo justo para empezar sin llamar a nada.
 * Si hay más, la ficha lo dice y el agente usa `list_worksheets` o
 * `get_sheet_schema`.
 */
export const BRIEFING_LIMITS = {
  sheets: 40,
  columns: 600,
  recentActions: 10,
  summaryLength: 300,
} as const;

/** La ficha tal como la recibe el agente: tablas planas, que en TOON son baratas. */
export type Briefing = Readonly<{
  overview: unknown;
  sheets: readonly SheetRow[];
  columns: readonly ColumnRow[];
  omitted: Readonly<{ sheets: boolean; columns: boolean }>;
  recentActions: readonly ActionRow[];
}>;

/**
 * La ficha del proyecto que acompaña a cada ejecución (plan 10, D5). Se arma
 * con los servicios y permisos de siempre y con dos consultas acotadas a hojas
 * activas. No sustituye a las herramientas: les ahorra a todas el primer paso.
 */
@Injectable()
export class ProjectBriefing {
  private readonly logger = new Logger(ProjectBriefing.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly catalog: AgentOperationCatalog,
  ) {}

  /** La ficha, o `null` si no se pudo armar: el agente sigue sin ella. */
  async of(run: RunningRun): Promise<Briefing | null> {
    try {
      return await this.build(run);
    } catch {
      this.logger.warn({ code: 'AGENT_BRIEFING_FAILED', runId: run.id });
      return null;
    }
  }

  private async build(run: RunningRun): Promise<Briefing> {
    // Lo mismo que leería el agente con `get_project_overview`, con sus permisos.
    const overview = await this.overview(run);
    const sheets = await this.activeSheets(run);
    const columns = await this.columnsOf(
      sheets.slice(0, BRIEFING_LIMITS.sheets),
    );
    return {
      overview,
      sheets: sheets.slice(0, BRIEFING_LIMITS.sheets),
      columns: columns.slice(0, BRIEFING_LIMITS.columns),
      omitted: {
        sheets: sheets.length > BRIEFING_LIMITS.sheets,
        columns: columns.length > BRIEFING_LIMITS.columns,
      },
      recentActions: await this.recentActions(run),
    };
  }

  private async overview(run: RunningRun) {
    const operation = this.catalog.find('get_project_overview');
    if (operation?.level !== 'read') {
      throw new Error('El catálogo perdió get_project_overview.');
    }
    const context: OperationContext = {
      identity: run.identity,
      actorId: run.actorId,
      scope: run.scope,
      context: run.context,
    };
    return operation.execute(context, {});
  }

  /** Hojas activas de libros activos, con su revisión vigente y borradores abiertos. */
  private async activeSheets(run: RunningRun): Promise<SheetRow[]> {
    // El acceso ya lo comprobó la vista general; esto lo repite por si cambia.
    await this.projects.requireAccess(
      run.identity,
      run.scope.projectId,
      'organization.read',
    );
    return this.prisma.$queryRaw<SheetRow[]>`
      SELECT
        w.id,
        b.id AS "workbookId",
        b.name AS workbook,
        w.name,
        r.sequence AS revision,
        r.id AS "revisionId",
        r.row_count AS "rowCount",
        (
          SELECT count(*)::int
          FROM estadistica_forms.worksheet_changesets c
          WHERE c.worksheet_id = w.id
            AND c.status NOT IN ('applied', 'cancelled')
        ) AS "openDrafts"
      FROM estadistica_forms.worksheets w
      JOIN estadistica_forms.workbooks b ON b.id = w.workbook_id
      JOIN estadistica_forms.worksheet_revisions r ON r.id = w.head_revision_id
      WHERE w.organization_id = ${run.scope.organizationId}
        AND w.project_id = ${run.scope.projectId}
        AND w.archived_at IS NULL
        AND b.archived_at IS NULL
      ORDER BY b.created_at, b.id, w.created_at, w.id
      LIMIT ${BRIEFING_LIMITS.sheets + 1}`;
  }

  /** Las columnas del esquema vigente de cada hoja, en su orden. */
  private async columnsOf(sheets: readonly SheetRow[]): Promise<ColumnRow[]> {
    if (sheets.length === 0) {
      return [];
    }
    return this.prisma.$queryRaw<ColumnRow[]>`
      SELECT
        v.worksheet_id AS "sheetId",
        v.column_id AS id,
        v.name,
        v.type,
        v.required
      FROM estadistica_forms.worksheet_column_versions v
      JOIN estadistica_forms.worksheets w
        ON w.id = v.worksheet_id AND v.schema_version = w.schema_version
      WHERE w.id IN (${Prisma.join(sheets.map((sheet) => sheet.id))})
      ORDER BY w.created_at, w.id, v.position
      LIMIT ${BRIEFING_LIMITS.columns + 1}`;
  }

  /**
   * Lo último que la propia persona confirmó al asistente en este proyecto,
   * en cualquier chat: así un chat nuevo sabe qué se hizo antes. Solo lo suyo:
   * las conversaciones son privadas.
   */
  private recentActions(run: RunningRun) {
    return this.prisma.$queryRaw<ActionRow[]>`
      SELECT
        p.operation,
        left(p.summary, ${BRIEFING_LIMITS.summaryLength}) AS summary,
        p.decided_at AS "confirmedAt"
      FROM estadistica_forms.ai_proposals p
      WHERE p.organization_id = ${run.scope.organizationId}
        AND p.project_id = ${run.scope.projectId}
        AND p.actor_id = ${run.actorId}
        AND p.status = 'confirmed'
      ORDER BY p.decided_at DESC
      LIMIT ${BRIEFING_LIMITS.recentActions}`;
  }
}
