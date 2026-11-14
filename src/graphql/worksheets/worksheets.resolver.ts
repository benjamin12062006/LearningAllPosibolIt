import { UseGuards } from '@nestjs/common';
import {
  Args,
  ID,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import type { AuthenticatedIdentity } from '../../auth/authenticated-request.js';
import { CurrentIdentity } from '../../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../../auth/descope-session.guard.js';
import { uuidParamPipe } from '../../common/http/validation-errors.js';
import { WorksheetRowsService } from '../../worksheets/worksheet-rows.service.js';
import { WorksheetsService } from '../../worksheets/worksheets.service.js';
import type {
  ProjectScope,
  Worksheet,
} from '../../worksheets/worksheets.types.js';
import {
  WorksheetRowPageType,
  WorksheetRowsArgs,
  WorksheetType,
} from './worksheets.graphql.js';

/** La hoja con la organización y el proyecto con los que se pidió, para sus campos. */
type ScopedWorksheet = Worksheet & Readonly<{ scope: ProjectScope }>;

/**
 * Hojas por GraphQL (C7, piloto): la hoja con sus columnas y una página de
 * filas en una sola llamada. Los permisos y los 404 los ponen los mismos
 * servicios que usa REST.
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
    @Args('organizationId', { type: () => ID }, uuidParamPipe('organizationId'))
    organizationId: string,
    @Args('projectId', { type: () => ID }, uuidParamPipe('projectId'))
    projectId: string,
    @Args('id', { type: () => ID }, uuidParamPipe('id')) id: string,
  ): Promise<ScopedWorksheet> {
    const scope = { organizationId, projectId };
    const { worksheet } = await this.worksheets.findWorksheet(
      identity,
      scope,
      id,
    );
    return { ...worksheet, scope };
  }

  /** La misma lectura que `POST …/worksheets/:id/rows/query`. */
  @ResolveField(() => WorksheetRowPageType, { name: 'rows' })
  findRows(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Parent() worksheet: ScopedWorksheet,
    @Args() page: WorksheetRowsArgs,
  ) {
    return this.rows.query(identity, worksheet.scope, worksheet.id, page);
  }
}
