import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { CurrentIdentity } from '../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../auth/descope-session.guard.js';
import { PaginationQueryDto } from '../common/http/pagination.js';
import { uuidParamPipe } from '../common/http/validation-errors.js';
import {
  ApproveFeedPolicyDto,
  PublishFeedDto,
  UpdateFeedScheduleDto,
  UpdateFeedSourceDto,
} from './feeds.dto.js';
import { FeedsService } from './feeds.service.js';

@Controller('projects/:projectId/feeds')
@UseGuards(DescopeSessionGuard)
export class FeedsController {
  constructor(private readonly feeds: FeedsService) {}

  /** `201` con el feed y la URL de entrega, que solo se muestra esta vez (D7). */
  @Post()
  create(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
  ) {
    return this.feeds.create(identity, projectId);
  }

  @Get()
  async findAll(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
  ) {
    return { items: await this.feeds.findAll(identity, projectId) };
  }

  @Get(':feedId')
  async findOne(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('feedId', uuidParamPipe('feedId')) feedId: string,
  ) {
    return { feed: await this.feeds.findOne(identity, projectId, feedId) };
  }

  /**
   * `201` con la versión nueva publicada, o `200` si esa exportación ya era la
   * publicada (D6). `passthrough` solo fija el estado, como en exportaciones.
   */
  @Post(':feedId/publications')
  async publish(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('feedId', uuidParamPipe('feedId')) feedId: string,
    @Body() body: PublishFeedDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.feeds.publish(identity, projectId, feedId, body);
    response.status(result.published ? 201 : 200);
    return { feed: result.feed };
  }

  /** Historial de versiones, de la más reciente a la más antigua (D12). */
  @Get(':feedId/versions')
  listVersions(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('feedId', uuidParamPipe('feedId')) feedId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.feeds.listVersions(identity, projectId, feedId, query);
  }

  /** Sustituye la fuente remota del feed (D9). */
  @Put(':feedId/source')
  async setSource(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('feedId', uuidParamPipe('feedId')) feedId: string,
    @Body() body: UpdateFeedSourceDto,
  ) {
    return {
      feed: await this.feeds.setSource(identity, projectId, feedId, body),
    };
  }

  /** Activa, desactiva o cambia la actualización diaria (D10). */
  @Put(':feedId/schedule')
  async setSchedule(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('feedId', uuidParamPipe('feedId')) feedId: string,
    @Body() body: UpdateFeedScheduleDto,
  ) {
    return {
      feed: await this.feeds.setSchedule(identity, projectId, feedId, body),
    };
  }

  /** Aprueba (o sustituye) la política de la actualización automática (D11). */
  @Put(':feedId/policy')
  async approvePolicy(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('feedId', uuidParamPipe('feedId')) feedId: string,
    @Body() body: ApproveFeedPolicyDto,
  ) {
    return {
      feed: await this.feeds.approvePolicy(identity, projectId, feedId, body),
    };
  }

  /**
   * Token nuevo; el anterior deja de valer (D7). `200`: no crea un recurso, cambia
   * el del feed. La URL solo se devuelve aquí.
   */
  @Post(':feedId/delivery-token')
  @HttpCode(200)
  rotateDeliveryToken(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('feedId', uuidParamPipe('feedId')) feedId: string,
  ) {
    return this.feeds.rotateDeliveryToken(identity, projectId, feedId);
  }

  /** Desactiva la entrega: la URL pública responde 404 hasta rotar otro token. */
  @Delete(':feedId/delivery-token')
  @HttpCode(204)
  async disableDelivery(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('feedId', uuidParamPipe('feedId')) feedId: string,
  ) {
    await this.feeds.disableDelivery(identity, projectId, feedId);
  }
}
