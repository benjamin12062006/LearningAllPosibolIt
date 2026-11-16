import { UseGuards } from '@nestjs/common';
import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedIdentity } from '../../auth/authenticated-request.js';
import { CurrentIdentity } from '../../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../../auth/descope-session.guard.js';
import type { RequestWithId } from '../../common/http/request-id.js';
import { CatalogWorksheetService } from '../../worksheet-catalog-snapshots/catalog-worksheet.service.js';
import { WorksheetCatalogSnapshotsService } from '../../worksheet-catalog-snapshots/worksheet-catalog-snapshots.service.js';
import { IdArg } from '../common/id-args.js';
import { WorksheetType } from '../worksheets/worksheets.graphql.js';
import {
  scopedWorksheet,
  type ScopedWorksheet,
} from '../worksheets/worksheets.resolver.js';
import {
  OpenCatalogAsWorksheetInput,
  SendWorksheetToCatalogInput,
  WorksheetCatalogAcceptanceType,
  WorksheetCatalogSnapshotType,
} from './worksheet-catalog-snapshots.graphql.js';

/**
 * El puente entre hojas y catálogo por GraphQL (C7.4): llevar una revisión al
 * catálogo y abrir un catálogo terminado como hoja nueva.
 */
@Resolver()
@UseGuards(DescopeSessionGuard)
export class WorksheetCatalogSnapshotsResolver {
  constructor(
    private readonly snapshots: WorksheetCatalogSnapshotsService,
    private readonly catalogWorksheets: CatalogWorksheetService,
  ) {}

  @Query(() => WorksheetCatalogSnapshotType, {
    name: 'worksheetCatalogSnapshot',
  })
  find(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('id') id: string,
  ) {
    return this.snapshots.find(identity, { organizationId, projectId }, id);
  }

  @Mutation(() => WorksheetCatalogAcceptanceType, {
    name: 'sendWorksheetToCatalog',
  })
  send(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Context('req') request: RequestWithId,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('worksheetId') worksheetId: string,
    @Args('input', { type: () => SendWorksheetToCatalogInput })
    input: SendWorksheetToCatalogInput,
  ) {
    return this.snapshots.create(
      identity,
      { organizationId, projectId },
      worksheetId,
      input,
      // El mismo identificador de petición que pondría REST.
      request.requestId ?? randomUUID(),
    );
  }

  /** Una hoja nueva con las filas del catálogo; el catálogo no cambia. */
  @Mutation(() => WorksheetType, { name: 'openCatalogAsWorksheet' })
  async open(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('workbookId') workbookId: string,
    @Args('input', { type: () => OpenCatalogAsWorksheetInput })
    input: OpenCatalogAsWorksheetInput,
  ): Promise<ScopedWorksheet> {
    const scope = { organizationId, projectId };
    const result = await this.catalogWorksheets.open(
      identity,
      scope,
      workbookId,
      input,
    );
    return scopedWorksheet(result, scope);
  }
}
