import { UseGuards } from '@nestjs/common';
import {
  Args,
  ID,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import type { AuthenticatedIdentity } from '../../auth/authenticated-request.js';
import { CurrentIdentity } from '../../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../../auth/descope-session.guard.js';
import { uuidParamPipe } from '../../common/http/validation-errors.js';
import { ExportsService } from '../../exports/exports.service.js';
import type { ExportView } from '../../exports/exports.types.js';
import { FeedViewerService } from '../../feed-viewer/feed-viewer.service.js';
import {
  ApproveExportInput,
  ExportApprovalType,
  ExportType,
  ProductArgs,
  ProductDetailType,
  ProductPageArgs,
  ProductPageType,
} from './exports.graphql.js';

/** La exportación con el proyecto con el que se pidió, para sus campos. */
type ProjectExport = ExportView & Readonly<{ projectId: string }>;

/**
 * Exportaciones por GraphQL (C7.2): la exportación aprobada y su TSV en el
 * visor. La descarga del archivo sigue en REST.
 */
@Resolver(() => ExportType)
@UseGuards(DescopeSessionGuard)
export class ExportsResolver {
  constructor(
    private readonly exports: ExportsService,
    private readonly viewer: FeedViewerService,
  ) {}

  @Query(() => ExportType, { name: 'export' })
  async findOne(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Args('projectId', { type: () => ID }, uuidParamPipe('projectId'))
    projectId: string,
    @Args('id', { type: () => ID }, uuidParamPipe('id')) id: string,
  ): Promise<ProjectExport> {
    const found = await this.exports.findOne(identity, projectId, id);
    return { ...found, projectId };
  }

  /** Aprueba lo que sale al canal, como `POST …/exports` (Manager). */
  @Mutation(() => ExportApprovalType, { name: 'approveExport' })
  async approve(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Args('projectId', { type: () => ID }, uuidParamPipe('projectId'))
    projectId: string,
    @Args('input', { type: () => ApproveExportInput })
    input: ApproveExportInput,
  ) {
    const result = await this.exports.create(identity, projectId, input);
    return {
      export: { ...result.export, projectId },
      downloadUrl: result.downloadUrl,
      created: result.created,
    };
  }

  @ResolveField(() => ProductPageType, { name: 'products' })
  products(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Parent() found: ProjectExport,
    @Args() query: ProductPageArgs,
  ) {
    return this.viewer.exportProducts(
      identity,
      found.projectId,
      found.id,
      query,
    );
  }

  @ResolveField(() => ProductDetailType, { name: 'product' })
  async product(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Parent() found: ProjectExport,
    @Args() query: ProductArgs,
  ) {
    const detail = await this.viewer.exportProduct(
      identity,
      found.projectId,
      found.id,
      query.id,
    );
    // La procedencia es esta misma exportación: con su proyecto, por si se
    // piden sus campos.
    return { ...detail, source: { kind: 'export', export: found } };
  }
}
