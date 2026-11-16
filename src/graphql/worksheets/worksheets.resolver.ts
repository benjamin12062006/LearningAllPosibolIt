import { UseGuards } from '@nestjs/common';
import {
  Args,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import type { AuthenticatedIdentity } from '../../auth/authenticated-request.js';
import { CurrentIdentity } from '../../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../../auth/descope-session.guard.js';
import { WorksheetRowsService } from '../../worksheets/worksheet-rows.service.js';
import { WorksheetsService } from '../../worksheets/worksheets.service.js';
import type {
  ProjectScope,
  Worksheet,
  WorksheetCapabilities,
} from '../../worksheets/worksheets.types.js';
import { IdArg } from '../common/id-args.js';
import { PaginationArgs } from '../common/pagination.args.js';
import {
  CreateWorksheetInput,
  DuplicateWorksheetInput,
  NameInput,
  WorksheetRevisionPageType,
  WorksheetRowPageType,
  WorksheetRowsArgs,
  WorksheetType,
} from './worksheets.graphql.js';

/**
 * La hoja con lo que puede hacer quien pregunta y con la organización y el
 * proyecto con los que se pidió: sus campos (`rows`, `revisions`, `changesets`…)
 * los necesitan para llamar a su servicio.
 */
export type ScopedWorksheet = Worksheet &
  Readonly<{ capabilities: WorksheetCapabilities; scope: ProjectScope }>;

/** Lo que devuelven los servicios de hojas: `{ worksheet, capabilities }`. */
type WorksheetResult = Readonly<{
  worksheet: Worksheet;
  capabilities: WorksheetCapabilities;
}>;

export function scopedWorksheet(
  result: WorksheetResult,
  scope: ProjectScope,
): ScopedWorksheet {
  return { ...result.worksheet, capabilities: result.capabilities, scope };
}

/**
 * Hojas por GraphQL (C7): la hoja con sus columnas, sus filas y su historial,
 * y crearla, renombrarla, archivarla, restaurarla y duplicarla. Los permisos y
 * los errores los ponen los mismos servicios que usa REST.
 */
@Resolver(() => WorksheetType)
@UseGuards(DescopeSessionGuard)
export class WorksheetsResolver {
  constructor(
    private readonly worksheets: WorksheetsService,
    private readonly rows: WorksheetRowsService,
  ) {}

  @Query(() => WorksheetType, { name: 'worksheet' })
  async findOne(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('id') id: string,
  ): Promise<ScopedWorksheet> {
    const scope = { organizationId, projectId };
    const result = await this.worksheets.findWorksheet(identity, scope, id);
    return scopedWorksheet(result, scope);
  }

  @Mutation(() => WorksheetType, { name: 'createWorksheet' })
  async create(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('workbookId') workbookId: string,
    @Args('input', { type: () => CreateWorksheetInput })
    input: CreateWorksheetInput,
  ): Promise<ScopedWorksheet> {
    const scope = { organizationId, projectId };
    const result = await this.worksheets.createWorksheet(
      identity,
      scope,
      workbookId,
      input,
    );
    return scopedWorksheet(result, scope);
  }

  @Mutation(() => WorksheetType, { name: 'renameWorksheet' })
  async rename(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('id') id: string,
    @Args('input', { type: () => NameInput }) input: NameInput,
  ): Promise<ScopedWorksheet> {
    const scope = { organizationId, projectId };
    const result = await this.worksheets.renameWorksheet(
      identity,
      scope,
      id,
      input.name,
    );
    return scopedWorksheet(result, scope);
  }

  /** Crea una hoja nueva con las filas de una revisión; la de origen no cambia. */
  @Mutation(() => WorksheetType, { name: 'duplicateWorksheet' })
  async duplicate(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('id') id: string,
    @Args('input', { type: () => DuplicateWorksheetInput })
    input: DuplicateWorksheetInput,
  ): Promise<ScopedWorksheet> {
    const scope = { organizationId, projectId };
    const result = await this.worksheets.duplicateWorksheet(
      identity,
      scope,
      id,
      input,
    );
    return scopedWorksheet(result, scope);
  }

  /** Manager: una hoja archivada se lee pero no admite cambios. */
  @Mutation(() => WorksheetType, { name: 'archiveWorksheet' })
  async archive(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('id') id: string,
  ): Promise<ScopedWorksheet> {
    const scope = { organizationId, projectId };
    const result = await this.worksheets.archiveWorksheet(identity, scope, id);
    return scopedWorksheet(result, scope);
  }

  @Mutation(() => WorksheetType, { name: 'restoreWorksheet' })
  async restore(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('organizationId') organizationId: string,
    @IdArg('projectId') projectId: string,
    @IdArg('id') id: string,
  ): Promise<ScopedWorksheet> {
    const scope = { organizationId, projectId };
    const result = await this.worksheets.restoreWorksheet(identity, scope, id);
    return scopedWorksheet(result, scope);
  }

  /** La misma lectura que `POST …/worksheets/:id/rows/query`. */
  @ResolveField(() => WorksheetRowPageType, { name: 'rows' })
  findRows(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Parent() worksheet: ScopedWorksheet,
    @Args() query: WorksheetRowsArgs,
  ) {
    return this.rows.query(identity, worksheet.scope, worksheet.id, query);
  }

  @ResolveField(() => WorksheetRevisionPageType, { name: 'revisions' })
  findRevisions(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Parent() worksheet: ScopedWorksheet,
    @Args() page: PaginationArgs,
  ) {
    return this.worksheets.findRevisions(
      identity,
      worksheet.scope,
      worksheet.id,
      page,
    );
  }
}
