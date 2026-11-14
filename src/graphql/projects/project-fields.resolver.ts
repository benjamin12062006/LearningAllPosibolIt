import { UseGuards } from '@nestjs/common';
import { Args, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import type { AuthenticatedIdentity } from '../../auth/authenticated-request.js';
import { CurrentIdentity } from '../../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../../auth/descope-session.guard.js';
import { CatalogImportService } from '../../catalog-import/catalog-import.service.js';
import { EvaluationsService } from '../../evaluations/evaluations.service.js';
import { FeedsService } from '../../feeds/feeds.service.js';
import { KnowledgeService } from '../../knowledge/knowledge.service.js';
import { ProjectMembershipService } from '../../projects/project-membership.service.js';
import type { Project } from '../../projects/projects.types.js';
import { RulesetsService } from '../../rulesets/rulesets.service.js';
import { WorksheetsService } from '../../worksheets/worksheets.service.js';
import { ImportPageType } from '../catalog-import/catalog-import.graphql.js';
import { PaginationArgs } from '../common/pagination.args.js';
import { EvaluationPageType } from '../evaluations/evaluations.graphql.js';
import { FeedType } from '../feeds/feeds.graphql.js';
import { KnowledgeStatusType } from '../knowledge/knowledge.graphql.js';
import { RulesetPageType } from '../rulesets/rulesets.graphql.js';
import {
  ArchivableListArgs,
  WorkbookPageType,
} from '../worksheets/worksheets.graphql.js';
import { ProjectAccessType, ProjectType } from './projects.graphql.js';

/**
 * Lo que cuelga de un proyecto (plan C7, G8): el resumen del proyecto en una
 * llamada en lugar de seis. Cada campo llama al servicio de su ruta REST, que
 * vuelve a comprobar el acceso; la caché por petición (G2) evita repetir esa
 * lectura en la base.
 */
@Resolver(() => ProjectType)
@UseGuards(DescopeSessionGuard)
export class ProjectFieldsResolver {
  constructor(
    private readonly membership: ProjectMembershipService,
    private readonly imports: CatalogImportService,
    private readonly rulesets: RulesetsService,
    private readonly evaluations: EvaluationsService,
    private readonly feeds: FeedsService,
    private readonly knowledge: KnowledgeService,
    private readonly worksheets: WorksheetsService,
  ) {}

  @ResolveField(() => ProjectAccessType, { name: 'access' })
  access(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Parent() project: Project,
  ) {
    return this.membership.resolveAccess(identity, project.id);
  }

  @ResolveField(() => ImportPageType, { name: 'imports' })
  async importList(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Parent() project: Project,
    @Args() page: PaginationArgs,
  ) {
    const { imports, page: info } = await this.imports.list(
      identity,
      project.id,
      page,
    );
    return { items: imports, page: info };
  }

  @ResolveField(() => RulesetPageType, { name: 'rulesets' })
  rulesetList(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Parent() project: Project,
    @Args() page: PaginationArgs,
  ) {
    return this.rulesets.findAll(identity, project.id, page);
  }

  /** Cada evaluación lleva el proyecto para sus campos (`attention`, `rows`). */
  @ResolveField(() => EvaluationPageType, { name: 'evaluations' })
  async evaluationList(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Parent() project: Project,
    @Args() page: PaginationArgs,
  ) {
    const { items, page: info } = await this.evaluations.findAll(
      identity,
      project.id,
      page,
    );
    const projectId = project.id;
    return { items: items.map((item) => ({ ...item, projectId })), page: info };
  }

  @ResolveField(() => [FeedType], { name: 'feeds' })
  async feedList(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Parent() project: Project,
  ) {
    const feeds = await this.feeds.findAll(identity, project.id);
    return feeds.map((feed) => ({ ...feed, projectId: project.id }));
  }

  @ResolveField(() => KnowledgeStatusType, { name: 'knowledge' })
  knowledgeStatus(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Parent() project: Project,
  ) {
    return this.knowledge.status(identity, project.id);
  }

  /** Las hojas viven bajo la organización: se toma de la membresía. */
  @ResolveField(() => WorkbookPageType, { name: 'workbooks' })
  async workbookList(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Parent() project: Project,
    @Args() query: ArchivableListArgs,
  ) {
    const { organizationId } = await this.membership.resolveAccess(
      identity,
      project.id,
    );
    // Cada libro lleva su ámbito para su campo `worksheets`.
    const scope = { organizationId, projectId: project.id };
    const { items, page } = await this.worksheets.findWorkbooks(
      identity,
      scope,
      query,
    );
    return { items: items.map((workbook) => ({ ...workbook, scope })), page };
  }
}
