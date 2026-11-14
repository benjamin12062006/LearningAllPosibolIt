import { UseGuards } from '@nestjs/common';
import {
  Args,
  Mutation,
  Parent,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import type { AuthenticatedIdentity } from '../../auth/authenticated-request.js';
import { CurrentIdentity } from '../../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../../auth/descope-session.guard.js';
import { WorksheetsService } from '../../worksheets/worksheets.service.js';
import type {
  ProjectScope,
  Workbook,
} from '../../worksheets/worksheets.types.js';
import { IdArg } from '../common/id-args.js';
import {
  ArchivableListArgs,
  CreateWorkbookInput,
  NameInput,
  WorkbookType,
  WorksheetSummaryPageType,
} from './worksheets.graphql.js';

/** El libro con la organización y el proyecto con los que se pidió. */
export type ScopedWorkbook = Workbook & Readonly<{ scope: ProjectScope }>;

/**
 * Libros por GraphQL (C7.4): crearlos, renombrarlos, archivarlos y
 * restaurarlos, y sus hojas como campo. Listarlos es `Project.workbooks`.
 */
@Resolver(() => WorkbookType)
@UseGuards(DescopeSessionGuard)
export class WorkbooksResolver {
  constructor(private readonly worksheets: WorksheetsService) {}

  @Mutation(() => WorkbookType, { name: 'createWorkbook' })
  async create(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @Args('input', { type: () => CreateWorkbookInput })
    input: CreateWorkbookInput,
  ): Promise<ScopedWorkbook> {
    const scope = { organizationId, projectId };
    const workbook = await this.worksheets.createWorkbook(
      identity,
      scope,
      input.name,
    );
    return { ...workbook, scope };
  }

  @Mutation(() => WorkbookType, { name: 'renameWorkbook' })
  async rename(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('id') id: string,
    @Args('input', { type: () => NameInput }) input: NameInput,
  ): Promise<ScopedWorkbook> {
    const scope = { organizationId, projectId };
    const workbook = await this.worksheets.renameWorkbook(
      identity,
      scope,
      id,
      input.name,
    );
    return { ...workbook, scope };
  }

  /** Manager: sus hojas se leen pero no admiten cambios. */
  @Mutation(() => WorkbookType, { name: 'archiveWorkbook' })
  async archive(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('id') id: string,
  ): Promise<ScopedWorkbook> {
    const scope = { organizationId, projectId };
    const workbook = await this.worksheets.archiveWorkbook(identity, scope, id);
    return { ...workbook, scope };
  }

  @Mutation(() => WorkbookType, { name: 'restoreWorkbook' })
  async restore(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('id') id: string,
  ): Promise<ScopedWorkbook> {
    const scope = { organizationId, projectId };
    const workbook = await this.worksheets.restoreWorkbook(identity, scope, id);
    return { ...workbook, scope };
  }

  /** Las hojas del libro, como `GET …/workbooks/:id/worksheets`. */
  @ResolveField(() => WorksheetSummaryPageType, { name: 'worksheets' })
  findWorksheets(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Parent() workbook: ScopedWorkbook,
    @Args() query: ArchivableListArgs,
  ) {
    return this.worksheets.findWorksheets(
      identity,
      workbook.scope,
      workbook.id,
      query,
    );
  }
}
