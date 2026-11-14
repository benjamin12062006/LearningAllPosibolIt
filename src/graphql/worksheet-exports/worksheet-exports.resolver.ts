import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import type { AuthenticatedIdentity } from '../../auth/authenticated-request.js';
import { CurrentIdentity } from '../../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../../auth/descope-session.guard.js';
import { WorksheetExportsService } from '../../worksheet-exports/worksheet-exports.service.js';
import { IdArg } from '../common/id-args.js';
import {
  ExportedWorksheetType,
  ExportWorksheetInput,
  WorksheetExportType,
} from './worksheet-exports.graphql.js';

/** Exportar una hoja a CSV o XLSX por GraphQL (C7.4); el archivo se baja por REST. */
@Resolver()
@UseGuards(DescopeSessionGuard)
export class WorksheetExportsResolver {
  constructor(private readonly exports: WorksheetExportsService) {}

  @Query(() => WorksheetExportType, { name: 'worksheetExport' })
  worksheetExport(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('id') id: string,
  ) {
    return this.exports.find(identity, { organizationId, projectId }, id);
  }

  @Mutation(() => ExportedWorksheetType, { name: 'exportWorksheet' })
  exportWorksheet(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('worksheetId') worksheetId: string,
    @Args('input', { type: () => ExportWorksheetInput })
    input: ExportWorksheetInput,
  ) {
    return this.exports.create(
      identity,
      { organizationId, projectId },
      worksheetId,
      input,
    );
  }
}
