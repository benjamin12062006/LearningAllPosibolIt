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
import { FeedRefreshesService } from '../../feed-refreshes/feed-refreshes.service.js';
import { FeedViewerService } from '../../feed-viewer/feed-viewer.service.js';
import { FeedsService } from '../../feeds/feeds.service.js';
import type { FeedView } from '../../feeds/feeds.types.js';
import { IdArg } from '../common/id-args.js';
import { PaginationArgs } from '../common/pagination.args.js';
import {
  CreatedFeedType,
  FeedComparisonArgs,
  FeedComparisonType,
  FeedDeliveryType,
  FeedPolicyInput,
  FeedPublicationType,
  FeedRefreshType,
  FeedScheduleInput,
  FeedSourceInput,
  FeedType,
  FeedVersionPageType,
  PublishFeedInput,
} from './feeds.graphql.js';

/** El feed con el proyecto con el que se pidió, para sus campos. */
export type ProjectFeed = FeedView & Readonly<{ projectId: string }>;

/**
 * Feeds por GraphQL (C7): el feed con su entrega, su comparación y su
 * historial, y las operaciones de configurarlo y publicarlo. Cada operación
 * llama al mismo servicio que su ruta REST. El token de entrega se queda en
 * REST (ficha 05): solo `createFeed` devuelve la URL, una vez, como REST.
 */
@Resolver(() => FeedType)
@UseGuards(DescopeSessionGuard)
export class FeedsResolver {
  constructor(
    private readonly feeds: FeedsService,
    private readonly viewer: FeedViewerService,
    private readonly refreshes: FeedRefreshesService,
  ) {}

  @Query(() => FeedType, { name: 'feed' })
  async findOne(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('projectId') projectId: string,
    @IdArg('id') id: string,
  ): Promise<ProjectFeed> {
    const feed = await this.feeds.findOne(identity, projectId, id);
    return { ...feed, projectId };
  }

  /** Crea el feed del proyecto (Manager), como `POST …/feeds`. */
  @Mutation(() => CreatedFeedType, { name: 'createFeed' })
  async create(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('projectId') projectId: string,
  ) {
    const { feed, deliveryUrl } = await this.feeds.create(identity, projectId);
    return { feed: { ...feed, projectId }, deliveryUrl };
  }

  /** Publica una exportación aprobada (Manager), como `POST …/publications`. */
  @Mutation(() => FeedPublicationType, { name: 'publishFeed' })
  async publish(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('projectId') projectId: string,
    @IdArg('feedId') feedId: string,
    @Args('input', { type: () => PublishFeedInput }) input: PublishFeedInput,
  ) {
    const { feed, published } = await this.feeds.publish(
      identity,
      projectId,
      feedId,
      input,
    );
    return { feed: { ...feed, projectId }, published };
  }

  @Mutation(() => FeedType, { name: 'setFeedSource' })
  async setSource(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('projectId') projectId: string,
    @IdArg('feedId') feedId: string,
    @Args('input', { type: () => FeedSourceInput }) input: FeedSourceInput,
  ): Promise<ProjectFeed> {
    const feed = await this.feeds.setSource(identity, projectId, feedId, input);
    return { ...feed, projectId };
  }

  @Mutation(() => FeedType, { name: 'setFeedSchedule' })
  async setSchedule(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('projectId') projectId: string,
    @IdArg('feedId') feedId: string,
    @Args('input', { type: () => FeedScheduleInput }) input: FeedScheduleInput,
  ): Promise<ProjectFeed> {
    const feed = await this.feeds.setSchedule(
      identity,
      projectId,
      feedId,
      input,
    );
    return { ...feed, projectId };
  }

  @Mutation(() => FeedType, { name: 'approveFeedPolicy' })
  async approvePolicy(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('projectId') projectId: string,
    @IdArg('feedId') feedId: string,
    @Args('input', { type: () => FeedPolicyInput }) input: FeedPolicyInput,
  ): Promise<ProjectFeed> {
    const feed = await this.feeds.approvePolicy(
      identity,
      projectId,
      feedId,
      input,
    );
    return { ...feed, projectId };
  }

  /** Pone una actualización en cola (202 en REST) y la devuelve en cola. */
  @Mutation(() => FeedRefreshType, { name: 'requestFeedRefresh' })
  async requestRefresh(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('projectId') projectId: string,
    @IdArg('feedId') feedId: string,
  ) {
    const { refresh } = await this.refreshes.trigger(
      identity,
      projectId,
      feedId,
    );
    return refresh;
  }

  @Query(() => FeedRefreshType, { name: 'feedRefresh' })
  findRefresh(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @IdArg('projectId') projectId: string,
    @IdArg('feedId') feedId: string,
    @IdArg('id') id: string,
  ) {
    return this.refreshes.findOne(identity, projectId, feedId, id);
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

  /** Cada versión lleva el proyecto y el feed para sus campos (el visor). */
  @ResolveField(() => FeedVersionPageType, { name: 'versions' })
  async versions(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Parent() feed: ProjectFeed,
    @Args() page: PaginationArgs,
  ) {
    const { versions, page: info } = await this.feeds.listVersions(
      identity,
      feed.projectId,
      feed.id,
      page,
    );
    const owner = { projectId: feed.projectId, feedId: feed.id };
    return {
      items: versions.map((version) => ({ ...version, ...owner })),
      page: info,
    };
  }
}
