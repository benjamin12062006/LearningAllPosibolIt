import { Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import {
  resolvePage,
  toPage,
  type PageInfo,
} from '../common/http/pagination.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { ExportsService } from '../exports/exports.service.js';
import type { ExportView } from '../exports/exports.types.js';
import { FeedsService } from '../feeds/feeds.service.js';
import type {
  FeedVersionView,
  FeedView,
  PublishedVersionView,
} from '../feeds/feeds.types.js';
import type {
  ComparisonQueryDto,
  ProductPageQueryDto,
} from './feed-viewer.dto.js';
import {
  compareProducts,
  type ChangeCounts,
  type ChangedField,
  type ProductChange,
} from './tsv-comparison.js';
import {
  findTsvProduct,
  readAllProducts,
  readTsvPage,
  type TsvPage,
  type TsvProduct,
  type TsvTable,
} from './tsv-page.js';

/** Lo que ve el visor: una página del TSV y cuántos productos tiene el archivo. */
export type ProductPage = TsvPage & Readonly<{ rowCount: number }>;

/**
 * De qué archivo sale un producto: la exportación o la versión del feed. Las
 * dos llevan la evaluación de origen (en una versión puede ser nula si se
 * borró su importación), que es de donde sale «Requiere atención».
 */
export type ProductSource =
  | Readonly<{ kind: 'export'; export: ExportView }>
  | Readonly<{
      kind: 'feed_version';
      feedId: string;
      version: FeedVersionView;
    }>;

/** La ficha de un producto: sus valores en ese archivo y su procedencia. */
export type ProductDetail = Readonly<{
  columns: readonly string[];
  product: TsvProduct;
  source: ProductSource;
}>;

/**
 * Qué cambiaría en el canal si se publicara una exportación (plan 02 de cierre,
 * P5). `counts` y `changedFields` son del archivo entero; `changes` es la
 * página pedida.
 */
export type FeedComparison = Readonly<{
  candidate: ExportView;
  published: PublishedVersionView;
  counts: ChangeCounts;
  changedFields: readonly ChangedField[];
  changes: readonly ProductChange[];
  page: PageInfo;
}>;

/** Un TSV ya abierto: lo dan tanto la exportación como la versión del feed. */
type OpenedTsv = Readonly<{ content: Readable; rowCount: number }>;

/**
 * Visor del feed (plan E6, D1): lee el TSV real de una exportación o de una
 * versión publicada. Los permisos y los 404 los ponen los servicios dueños de
 * cada archivo; este solo lee la página pedida.
 */
@Injectable()
export class FeedViewerService {
  constructor(
    private readonly exports: ExportsService,
    private readonly feeds: FeedsService,
  ) {}

  async exportProducts(
    identity: AuthenticatedIdentity,
    projectId: string,
    exportId: string,
    query: ProductPageQueryDto,
  ): Promise<ProductPage> {
    const file = await this.exports.openDownload(identity, projectId, exportId);
    return this.readPage(file, query);
  }

  async feedVersionProducts(
    identity: AuthenticatedIdentity,
    projectId: string,
    feedId: string,
    versionId: string,
    query: ProductPageQueryDto,
  ): Promise<ProductPage> {
    const file = await this.feeds.openVersionFile(
      identity,
      projectId,
      feedId,
      versionId,
    );
    return this.readPage(file, query);
  }

  /** La ficha de un producto de la exportación (plan 02 de cierre, P2). */
  async exportProduct(
    identity: AuthenticatedIdentity,
    projectId: string,
    exportId: string,
    productId: string,
  ): Promise<ProductDetail> {
    const found = await this.exports.findOne(identity, projectId, exportId);
    const file = await this.exports.openDownload(identity, projectId, exportId);
    return this.readProduct(file, productId, { kind: 'export', export: found });
  }

  /** La ficha conserva los valores de esa versión, aunque ya no sea la vigente. */
  async feedVersionProduct(
    identity: AuthenticatedIdentity,
    projectId: string,
    feedId: string,
    versionId: string,
    productId: string,
  ): Promise<ProductDetail> {
    const version = await this.feeds.findVersion(
      identity,
      projectId,
      feedId,
      versionId,
    );
    const file = await this.feeds.openVersionFile(
      identity,
      projectId,
      feedId,
      versionId,
    );
    return this.readProduct(file, productId, {
      kind: 'feed_version',
      feedId,
      version,
    });
  }

  /**
   * Compara una exportación con la versión publicada del feed. Solo lee: la
   * URL pública sigue sirviendo la versión vigente hasta que alguien publique.
   */
  async compareWithPublished(
    identity: AuthenticatedIdentity,
    projectId: string,
    feedId: string,
    query: ComparisonQueryDto,
  ): Promise<FeedComparison> {
    // Primero lo que puede ser ajeno (404) y después el estado del feed (409).
    const feed = await this.feeds.findOne(identity, projectId, feedId);
    const candidate = await this.exports.findOne(
      identity,
      projectId,
      query.exportId,
    );
    const published = publishedVersionOf(feed);

    const comparison = compareProducts(
      await this.readVersion(identity, projectId, feedId, published.id),
      await this.readExport(identity, projectId, query.exportId),
    );
    const { items, page } = pageOfChanges(comparison.changes, query);
    return {
      candidate,
      published,
      counts: comparison.counts,
      changedFields: comparison.changedFields,
      changes: items,
      page,
    };
  }

  private async readVersion(
    identity: AuthenticatedIdentity,
    projectId: string,
    feedId: string,
    versionId: string,
  ): Promise<TsvTable> {
    const file = await this.feeds.openVersionFile(
      identity,
      projectId,
      feedId,
      versionId,
    );
    return readAllProducts(file.content);
  }

  private async readExport(
    identity: AuthenticatedIdentity,
    projectId: string,
    exportId: string,
  ): Promise<TsvTable> {
    const file = await this.exports.openDownload(identity, projectId, exportId);
    return readAllProducts(file.content);
  }

  private async readProduct(
    file: OpenedTsv,
    productId: string,
    source: ProductSource,
  ): Promise<ProductDetail> {
    const { columns, product } = await findTsvProduct(file.content, productId);
    if (!product) {
      throw apiError(ErrorCodes.PRODUCT_NOT_FOUND);
    }
    return { columns, product, source };
  }

  private async readPage(
    file: OpenedTsv,
    query: ProductPageQueryDto,
  ): Promise<ProductPage> {
    const page = await readTsvPage(file.content, {
      ...resolvePage(query),
      search: query.search,
    });
    return { ...page, rowCount: file.rowCount };
  }
}

/** Sin versión publicada no hay con qué comparar: 409. */
function publishedVersionOf(feed: FeedView): PublishedVersionView {
  if (!feed.publishedVersion) {
    throw apiError(ErrorCodes.FEED_NOT_PUBLISHED);
  }
  return feed.publishedVersion;
}

/** La página pedida de los cambios, opcionalmente de un solo tipo. */
function pageOfChanges(
  changes: readonly ProductChange[],
  query: ComparisonQueryDto,
) {
  const wanted = changes.filter(
    (change) => query.change === undefined || change.change === query.change,
  );
  const page = resolvePage(query);
  // Una fila de más, como en los repositorios, para saber si hay otra página.
  const window = wanted.slice(page.offset, page.offset + page.limit + 1);
  return toPage(window, page);
}
