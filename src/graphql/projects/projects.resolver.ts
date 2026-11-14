import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import type { AuthenticatedIdentity } from '../../auth/authenticated-request.js';
import { CurrentIdentity } from '../../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../../auth/descope-session.guard.js';
import { CatalogImportService } from '../../catalog-import/catalog-import.service.js';
import { PaginationArgs } from '../common/pagination.args.js';
import { uuidParamPipe } from '../../common/http/validation-errors.js';
import {
  CreateProjectInput,
  OrganizationPageArgs,
  ProjectPageType,
  ProjectType,
  UpdateProjectInput,
} from './projects.graphql.js';
import { ProjectMembershipService } from '../../projects/project-membership.service.js';
import { ProjectsService } from '../../projects/projects.service.js';

@Resolver(() => ProjectType)
@UseGuards(DescopeSessionGuard)
export class ProjectsResolver {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly imports: CatalogImportService,
    private readonly membership: ProjectMembershipService,
  ) {}

  @Query(() => [ProjectType], { name: 'projects' })
  async findAll(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Args() page: PaginationArgs,
  ) {
    return (await this.projectsService.findAll(identity, page)).items;
  }

  /** Los proyectos de una organización que ve quien pregunta. */
  @Query(() => ProjectPageType, { name: 'organizationProjects' })
  organizationProjects(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Args('organizationId', { type: () => ID }, uuidParamPipe('organizationId'))
    organizationId: string,
    @Args() page: OrganizationPageArgs,
  ) {
    return this.membership.findAllInOrganization(
      identity,
      organizationId,
      page,
    );
  }

  @Query(() => ProjectType, { name: 'project' })
  findOne(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Args('id', { type: () => ID }, uuidParamPipe('id')) id: string,
  ) {
    return this.projectsService.findVisible(identity, id);
  }

  @Mutation(() => ProjectType, { name: 'createProject' })
  create(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Args('input', { type: () => CreateProjectInput })
    input: CreateProjectInput,
  ) {
    return this.projectsService.create(identity, input);
  }

  @Mutation(() => ProjectType, { name: 'updateProject' })
  update(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Args('id', { type: () => ID }, uuidParamPipe('id')) id: string,
    @Args('input', { type: () => UpdateProjectInput })
    input: UpdateProjectInput,
  ) {
    return this.projectsService.update(identity, id, input);
  }

  /**
   * Borra el proyecto con todas sus importaciones y archivos, igual que
   * `DELETE /projects/:id`. Por eso usa `CatalogImportService`.
   */
  @Mutation(() => Boolean, { name: 'deleteProject' })
  async delete(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Args('id', { type: () => ID }, uuidParamPipe('id')) id: string,
  ) {
    await this.imports.deleteProject(identity, id);
    return true;
  }
}
