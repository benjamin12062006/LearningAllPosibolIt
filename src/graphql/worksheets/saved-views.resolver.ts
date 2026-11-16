import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import type { AuthenticatedIdentity } from '../../auth/authenticated-request.js';
import { CurrentIdentity } from '../../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../../auth/descope-session.guard.js';
import { SavedViewsService } from '../../worksheets/saved-views.service.js';
import { IdArg } from '../common/id-args.js';
import { SavedViewType, SaveViewInput } from './saved-views.graphql.js';

/** Vistas guardadas por GraphQL (C7.4); se usan con `Worksheet.rows(viewId:)`. */
@Resolver(() => SavedViewType)
@UseGuards(DescopeSessionGuard)
export class SavedViewsResolver {
  constructor(private readonly views: SavedViewsService) {}

  @Query(() => SavedViewType, { name: 'savedView' })
  find(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('id') id: string,
  ) {
    return this.views.find(identity, { organizationId, projectId }, id);
  }

  @Mutation(() => SavedViewType, { name: 'saveView' })
  save(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('worksheetId') worksheetId: string,
    @Args('input', { type: () => SaveViewInput }) input: SaveViewInput,
  ) {
    return this.views.create(
      identity,
      { organizationId, projectId },
      worksheetId,
      input,
    );
  }

  @Mutation(() => SavedViewType, { name: 'replaceSavedView' })
  replace(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('id') id: string,
    @Args('input', { type: () => SaveViewInput }) input: SaveViewInput,
  ) {
    return this.views.replace(
      identity,
      { organizationId, projectId },
      id,
      input,
    );
  }

  @Mutation(() => Boolean, { name: 'deleteSavedView' })
  async delete(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('id') id: string,
  ) {
    await this.views.delete(identity, { organizationId, projectId }, id);
    return true;
  }
}
