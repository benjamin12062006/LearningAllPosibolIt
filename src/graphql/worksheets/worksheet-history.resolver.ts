import { UseGuards } from '@nestjs/common';
import { Args, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import type { AuthenticatedIdentity } from '../../auth/authenticated-request.js';
import { CurrentIdentity } from '../../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../../auth/descope-session.guard.js';
import { ChangesetsService } from '../../changesets/changesets.service.js';
import { WorksheetExportsService } from '../../worksheet-exports/worksheet-exports.service.js';
import { ImportMappingsService } from '../../worksheet-imports/import-mappings.service.js';
import { WorksheetImportsService } from '../../worksheet-imports/worksheet-imports.service.js';
import { SavedViewsService } from '../../worksheets/saved-views.service.js';
import {
  ChangesetListArgs,
  ChangesetPageType,
} from '../changesets/changesets.graphql.js';
import { PaginationArgs } from '../common/pagination.args.js';
import { WorksheetExportPageType } from '../worksheet-exports/worksheet-exports.graphql.js';
import {
  ImportMappingPageType,
  WorksheetImportPageType,
} from '../worksheet-imports/worksheet-imports.graphql.js';
import { SavedViewPageType } from './saved-views.graphql.js';
import { WorksheetType } from './worksheets.graphql.js';
import type { ScopedWorksheet } from './worksheets.resolver.js';

/**
 * Lo que cuelga de una hoja y vive en otros módulos (C7.4, H2–H4): sus
 * borradores, importaciones, exportaciones, plantillas y vistas. La hoja y
 * todo su historial en una llamada, cada lista con el servicio de su ruta REST.
 */
@Resolver(() => WorksheetType)
@UseGuards(DescopeSessionGuard)
export class WorksheetHistoryResolver {
  constructor(
    private readonly changesets: ChangesetsService,
    private readonly imports: WorksheetImportsService,
    private readonly exports: WorksheetExportsService,
    private readonly mappings: ImportMappingsService,
    private readonly views: SavedViewsService,
  ) {}

  @ResolveField(() => ChangesetPageType, { name: 'changesets' })
  changesetList(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Parent() worksheet: ScopedWorksheet,
    @Args() query: ChangesetListArgs,
  ) {
    return this.changesets.findByWorksheet(
      identity,
      worksheet.scope,
      worksheet.id,
      query,
    );
  }

  @ResolveField(() => WorksheetImportPageType, { name: 'imports' })
  importList(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Parent() worksheet: ScopedWorksheet,
    @Args() page: PaginationArgs,
  ) {
    return this.imports.findByWorksheet(
      identity,
      worksheet.scope,
      worksheet.id,
      page,
    );
  }

  @ResolveField(() => WorksheetExportPageType, { name: 'exports' })
  exportList(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Parent() worksheet: ScopedWorksheet,
    @Args() page: PaginationArgs,
  ) {
    return this.exports.findByWorksheet(
      identity,
      worksheet.scope,
      worksheet.id,
      page,
    );
  }

  @ResolveField(() => ImportMappingPageType, { name: 'importMappings' })
  mappingList(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Parent() worksheet: ScopedWorksheet,
    @Args() page: PaginationArgs,
  ) {
    return this.mappings.findByWorksheet(
      identity,
      worksheet.scope,
      worksheet.id,
      page,
    );
  }

  @ResolveField(() => SavedViewPageType, { name: 'savedViews' })
  savedViewList(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Parent() worksheet: ScopedWorksheet,
    @Args() page: PaginationArgs,
  ) {
    return this.views.findByWorksheet(
      identity,
      worksheet.scope,
      worksheet.id,
      page,
    );
  }
}
