import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { CurrentIdentity } from '../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../auth/descope-session.guard.js';
import { uuidParamPipe } from '../common/http/validation-errors.js';
import {
  ComparisonQueryDto,
  ProductPageQueryDto,
  ProductQueryDto,
} from './feed-viewer.dto.js';
import { FeedViewerService } from './feed-viewer.service.js';

/**
 * Lectura JSON de los productos de un TSV, para el visor de la web (plan E6,
 * D1). Respuesta `{ columns, products: [{ line, values }], rowCount, page }`;
 * `rowCount` es el total del archivo, aunque haya búsqueda.
 */
@Controller('projects/:projectId')
@UseGuards(DescopeSessionGuard)
export class FeedViewerController {
  constructor(private readonly viewer: FeedViewerService) {}

  /** Lo que se aprobó y se puede publicar: `productos.tsv` de la exportación. */
  @Get('exports/:exportId/products')
  exportProducts(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('exportId', uuidParamPipe('exportId')) exportId: string,
    @Query() query: ProductPageQueryDto,
  ) {
    return this.viewer.exportProducts(identity, projectId, exportId, query);
  }

  /** La ficha de un producto de la exportación: `{ columns, product, source }`. */
  @Get('exports/:exportId/product')
  exportProduct(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('exportId', uuidParamPipe('exportId')) exportId: string,
    @Query() query: ProductQueryDto,
  ) {
    return this.viewer.exportProduct(identity, projectId, exportId, query.id);
  }

  /** Lo que recibe o recibió el canal: el archivo de una versión del feed. */
  @Get('feeds/:feedId/versions/:versionId/products')
  feedVersionProducts(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('feedId', uuidParamPipe('feedId')) feedId: string,
    @Param('versionId', uuidParamPipe('versionId')) versionId: string,
    @Query() query: ProductPageQueryDto,
  ) {
    return this.viewer.feedVersionProducts(
      identity,
      projectId,
      feedId,
      versionId,
      query,
    );
  }

  /** La ficha de un producto tal como estaba en esa versión del feed. */
  @Get('feeds/:feedId/versions/:versionId/product')
  feedVersionProduct(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('feedId', uuidParamPipe('feedId')) feedId: string,
    @Param('versionId', uuidParamPipe('versionId')) versionId: string,
    @Query() query: ProductQueryDto,
  ) {
    return this.viewer.feedVersionProduct(
      identity,
      projectId,
      feedId,
      versionId,
      query.id,
    );
  }

  /**
   * Qué cambiaría si se publicara esa exportación: `{ comparison: { candidate,
   * published, counts, changedFields, changes, page } }`.
   */
  @Get('feeds/:feedId/comparison')
  async compareWithPublished(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('feedId', uuidParamPipe('feedId')) feedId: string,
    @Query() query: ComparisonQueryDto,
  ) {
    return {
      comparison: await this.viewer.compareWithPublished(
        identity,
        projectId,
        feedId,
        query,
      ),
    };
  }
}
