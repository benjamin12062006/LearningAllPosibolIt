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
import { FeedViewerService } from '../../feed-viewer/feed-viewer.service.js';
import { FeedsService } from '../../feeds/feeds.service.js';
import type { FeedView } from '../../feeds/feeds.types.js';
import {
  FeedComparisonArgs,
  FeedComparisonType,
  FeedDeliveryType,
  FeedType,
} from './feeds.graphql.js';

/** El feed con el proyecto con el que se pidió, para sus campos. */
type ProjectFeed = FeedView & Readonly<{ projectId: string }>;

/**
 * Diagnóstico del feed por GraphQL (C7, piloto): el feed, si entrega y qué
 * cambiaría al publicar, en una sola llamada. Cada campo llama al mismo
 * servicio que su ruta REST.
 */
@Resolver(() => FeedType)
@UseGuards(DescopeSessionGuard)
export class FeedsResolver {
  constructor(
    private readonly feeds: FeedsService,
    private readonly viewer: FeedViewerService,
  ) {}

  @Query(() => FeedType, { name: 'feed' })
  async findOne(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Args('projectId', { type: () => ID }, uuidParamPipe('projectId'))
    projectId: string,
    @Args('id', { type: () => ID }, uuidParamPipe('id')) id: string,
  ): Promise<ProjectFeed> {
    const feed = await this.feeds.findOne(identity, projectId, id);
    return { ...feed, projectId };
  }

  @ResolveField(() => FeedDeliveryType, { name: 'delivery' })
  delivery(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Parent() feed: ProjectFeed,
  ) {
    return this.feeds.deliveryStatus(identity, feed.projectId, feed.id);
  }

  @ResolveField(() => FeedComparisonType, { name: 'comparison' })
  comparison(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Parent() feed: ProjectFeed,
    @Args() query: FeedComparisonArgs,
  ) {
    return this.viewer.compareWithPublished(
      identity,
      feed.projectId,
      feed.id,
      query,
    );
  }
}
