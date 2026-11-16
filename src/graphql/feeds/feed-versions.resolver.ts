import { UseGuards } from '@nestjs/common';
import { Args, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import type { AuthenticatedIdentity } from '../../auth/authenticated-request.js';
import { CurrentIdentity } from '../../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../../auth/descope-session.guard.js';
import { FeedViewerService } from '../../feed-viewer/feed-viewer.service.js';
import type { FeedVersionView } from '../../feeds/feeds.types.js';
import {
  ProductArgs,
  ProductDetailType,
  ProductPageArgs,
  ProductPageType,
} from '../exports/exports.graphql.js';
import { FeedVersionType } from './feeds.graphql.js';

/** Una versión con su proyecto y su feed, para leer su archivo. */
export type ScopedFeedVersion = FeedVersionView &
  Readonly<{ projectId: string; feedId: string }>;

/**
 * El visor de una versión del feed (C7.3): lo que recibe o recibió el canal,
 * con los mismos servicios que `…/versions/:versionId/products` y `…/product`.
 */
@Resolver(() => FeedVersionType)
@UseGuards(DescopeSessionGuard)
export class FeedVersionsResolver {
  constructor(private readonly viewer: FeedViewerService) {}

  @ResolveField(() => ProductPageType, { name: 'products' })
  products(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Parent() version: ScopedFeedVersion,
    @Args() query: ProductPageArgs,
  ) {
    return this.viewer.feedVersionProducts(
      identity,
      version.projectId,
      version.feedId,
      version.id,
      query,
    );
  }

  @ResolveField(() => ProductDetailType, { name: 'product' })
  async product(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Parent() version: ScopedFeedVersion,
    @Args() query: ProductArgs,
  ) {
    const detail = await this.viewer.feedVersionProduct(
      identity,
      version.projectId,
      version.feedId,
      version.id,
      query.id,
    );
    // La procedencia es esta misma versión: con su proyecto y su feed.
    return {
      ...detail,
      source: { kind: 'feed_version', feedId: version.feedId, version },
    };
  }
}
