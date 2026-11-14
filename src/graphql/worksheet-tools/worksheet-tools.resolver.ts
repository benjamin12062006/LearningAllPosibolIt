import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import type { AuthenticatedIdentity } from '../../auth/authenticated-request.js';
import { CurrentIdentity } from '../../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../../auth/descope-session.guard.js';
import { WorksheetToolsService } from '../../worksheet-tools/worksheet-tools.service.js';
import { IdArg } from '../common/id-args.js';
import {
  CreateWorksheetChangeProposalInput,
  CreateWorksheetSelectionInput,
  PreviewWorksheetTransformInput,
  WorksheetChangeProposalType,
  WorksheetSelectionType,
  WorksheetTransformPreviewPageArgs,
  WorksheetTransformPreviewPageType,
  WorksheetTransformPreviewType,
} from './worksheet-tools.graphql.js';

@Resolver()
@UseGuards(DescopeSessionGuard)
export class WorksheetToolsResolver {
  constructor(private readonly tools: WorksheetToolsService) {}

  @Mutation(() => WorksheetSelectionType, { name: 'createWorksheetSelection' })
  createSelection(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('worksheetId') worksheetId: string,
    @Args('input', { type: () => CreateWorksheetSelectionInput })
    input: CreateWorksheetSelectionInput,
  ) {
    return this.tools.createSelection(
      identity,
      { organizationId, projectId },
      worksheetId,
      input,
    );
  }

  @Mutation(() => WorksheetTransformPreviewType, {
    name: 'previewWorksheetTransform',
  })
  previewTransform(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('worksheetId') worksheetId: string,
    @Args('input', { type: () => PreviewWorksheetTransformInput })
    input: PreviewWorksheetTransformInput,
  ) {
    return this.tools.previewTransform(
      identity,
      { organizationId, projectId },
      worksheetId,
      input,
    );
  }

  @Query(() => WorksheetTransformPreviewPageType, {
    name: 'worksheetTransformPreview',
  })
  findPreview(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('worksheetId') worksheetId: string,
    @IdArg('previewId') previewId: string,
    @Args() { limit, offset }: WorksheetTransformPreviewPageArgs,
  ) {
    return this.tools.findPreview(
      identity,
      { organizationId, projectId },
      worksheetId,
      previewId,
      limit,
      offset,
    );
  }

  @Mutation(() => WorksheetChangeProposalType, {
    name: 'createWorksheetChangeProposal',
  })
  createChangeProposal(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('worksheetId') worksheetId: string,
    @Args('input', { type: () => CreateWorksheetChangeProposalInput })
    { idempotencyKey, ...input }: CreateWorksheetChangeProposalInput,
  ) {
    return this.tools.createChangeProposal(
      identity,
      { organizationId, projectId },
      worksheetId,
      input,
      idempotencyKey ?? undefined,
    );
  }
}
