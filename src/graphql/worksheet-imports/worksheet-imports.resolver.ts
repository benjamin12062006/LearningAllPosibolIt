import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import type { AuthenticatedIdentity } from '../../auth/authenticated-request.js';
import { CurrentIdentity } from '../../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../../auth/descope-session.guard.js';
import { ImportMappingsService } from '../../worksheet-imports/import-mappings.service.js';
import { WorksheetImportsService } from '../../worksheet-imports/worksheet-imports.service.js';
import { IdArg } from '../common/id-args.js';
import {
  CreateImportMappingInput,
  ImportMappingType,
  WorksheetImportType,
} from './worksheet-imports.graphql.js';

/**
 * Importaciones de hojas por GraphQL (C7.4): leer una importación y las
 * plantillas de mapeo. Subir el archivo sigue en REST (multipart, ficha 05).
 */
@Resolver()
@UseGuards(DescopeSessionGuard)
export class WorksheetImportsResolver {
  constructor(
    private readonly imports: WorksheetImportsService,
    private readonly mappings: ImportMappingsService,
  ) {}

  @Query(() => WorksheetImportType, { name: 'worksheetImport' })
  worksheetImport(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('id') id: string,
  ) {
    return this.imports.find(identity, { organizationId, projectId }, id);
  }

  @Query(() => ImportMappingType, { name: 'importMapping' })
  importMapping(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('id') id: string,
  ) {
    return this.mappings.find(identity, { organizationId, projectId }, id);
  }

  @Mutation(() => ImportMappingType, { name: 'createImportMapping' })
  createImportMapping(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('worksheetId') worksheetId: string,
    @Args('input', { type: () => CreateImportMappingInput })
    input: CreateImportMappingInput,
  ) {
    return this.mappings.create(
      identity,
      { organizationId, projectId },
      worksheetId,
      input,
    );
  }

  /** Borrar la plantilla no cambia las importaciones que la usaron. */
  @Mutation(() => Boolean, { name: 'deleteImportMapping' })
  async deleteImportMapping(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('id') id: string,
  ) {
    await this.mappings.delete(identity, { organizationId, projectId }, id);
    return true;
  }
}
