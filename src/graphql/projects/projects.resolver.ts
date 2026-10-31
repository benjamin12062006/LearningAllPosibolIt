import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import type { AuthenticatedIdentity } from '../../auth/authenticated-request.js';
import { CurrentIdentity } from '../../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../../auth/descope-session.guard.js';
import { PaginationArgs } from '../common/pagination.args.js';
import { uuidParamPipe } from '../../common/http/validation-errors.js';
import {
  CreateProjectInput,
  ProjectType,
  UpdateProjectInput,
} from './projects.graphql.js';
import { ProjectsService } from '../../projects/projects.service.js';

@Resolver(() => ProjectType)
@UseGuards(DescopeSessionGuard)
export class ProjectsResolver {
  constructor(private readonly projectsService: ProjectsService) {}

  @Query(() => [ProjectType], { name: 'projects' })
  async findAll(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Args() page: PaginationArgs,
  ) {
    return (await this.projectsService.findAll(identity, page)).items;
  }

  @Query(() => ProjectType, { name: 'project' })
  findOne(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Args('id', { type: () => ID }, uuidParamPipe('id')) id: string,
  ) {
    return this.projectsService.findOwned(identity, id);
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
}
