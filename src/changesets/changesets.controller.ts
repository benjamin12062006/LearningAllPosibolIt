import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { CurrentIdentity } from '../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../auth/descope-session.guard.js';
import { uuidParamPipe } from '../common/http/validation-errors.js';
import {
  ApplyChangesetDto,
  CreateChangesetDto,
  DecisionDto,
  DraftVersionDto,
  RebaseDto,
  SaveOperationsDto,
} from './changesets.dto.js';
import { ChangesetsService } from './changesets.service.js';
import type { Changeset } from './changesets.types.js';

/**
 * Rutas de borradores bajo `P = /organizations/:organizationId/projects/:projectId`
 * ([16]). Las que devuelven un borrador mandan su versión en `ETag`, para que
 * el siguiente guardado la envíe en `If-Match` (D3).
 */
@Controller('organizations/:organizationId/projects/:projectId')
@UseGuards(DescopeSessionGuard)
export class ChangesetsController {
  constructor(private readonly changesets: ChangesetsService) {}

  @Post('worksheets/:worksheetId/changesets')
  async create(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('worksheetId', uuidParamPipe('worksheetId')) worksheetId: string,
    @Body() body: CreateChangesetDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const changeset = await this.changesets.create(
      identity,
      { organizationId, projectId },
      worksheetId,
      body.title,
    );
    return withEtag(response, changeset);
  }

  @Get('changesets/:changesetId')
  async find(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('changesetId', uuidParamPipe('changesetId')) changesetId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const changeset = await this.changesets.find(
      identity,
      { organizationId, projectId },
      changesetId,
    );
    return withEtag(response, changeset);
  }

  @Put('changesets/:changesetId/operations')
  async saveOperations(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('changesetId', uuidParamPipe('changesetId')) changesetId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: SaveOperationsDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const changeset = await this.changesets.saveOperations(
      identity,
      { organizationId, projectId },
      changesetId,
      ifMatch,
      body.operations,
    );
    return withEtag(response, changeset);
  }

  @Get('changesets/:changesetId/diff')
  async review(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('changesetId', uuidParamPipe('changesetId')) changesetId: string,
  ) {
    const review = await this.changesets.review(
      identity,
      { organizationId, projectId },
      changesetId,
    );
    return { review };
  }

  @Post('changesets/:changesetId/submit')
  @HttpCode(200)
  async submit(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('changesetId', uuidParamPipe('changesetId')) changesetId: string,
    @Body() body: DraftVersionDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const changeset = await this.changesets.submit(
      identity,
      { organizationId, projectId },
      changesetId,
      body.draftVersion,
    );
    return withEtag(response, changeset);
  }

  @Post('changesets/:changesetId/reopen')
  @HttpCode(200)
  async reopen(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('changesetId', uuidParamPipe('changesetId')) changesetId: string,
    @Body() body: DraftVersionDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const changeset = await this.changesets.reopen(
      identity,
      { organizationId, projectId },
      changesetId,
      body.draftVersion,
    );
    return withEtag(response, changeset);
  }

  @Post('changesets/:changesetId/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('changesetId', uuidParamPipe('changesetId')) changesetId: string,
  ) {
    const changeset = await this.changesets.cancel(
      identity,
      { organizationId, projectId },
      changesetId,
    );
    return { changeset };
  }

  @Post('changesets/:changesetId/decisions')
  decide(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('changesetId', uuidParamPipe('changesetId')) changesetId: string,
    @Body() body: DecisionDto,
  ) {
    return this.changesets.decide(
      identity,
      { organizationId, projectId },
      changesetId,
      body,
    );
  }

  /** Reintentar con la misma `Idempotency-Key` devuelve el mismo resultado (D8). */
  @Post('changesets/:changesetId/apply')
  @HttpCode(200)
  async apply(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('changesetId', uuidParamPipe('changesetId')) changesetId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: ApplyChangesetDto,
  ) {
    const applied = await this.changesets.apply(
      identity,
      { organizationId, projectId },
      changesetId,
      idempotencyKey,
      body,
    );
    return { applied };
  }

  @Post('changesets/:changesetId/rebase')
  @HttpCode(200)
  async rebase(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('changesetId', uuidParamPipe('changesetId')) changesetId: string,
    @Body() body: RebaseDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const changeset = await this.changesets.rebase(
      identity,
      { organizationId, projectId },
      changesetId,
      body.draftVersion,
      body.resolutions ?? [],
    );
    return withEtag(response, changeset);
  }

  @Post('revisions/:revisionId/revert-proposal')
  async proposeRevert(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('revisionId', uuidParamPipe('revisionId')) revisionId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const changeset = await this.changesets.proposeRevert(
      identity,
      { organizationId, projectId },
      revisionId,
    );
    return withEtag(response, changeset);
  }
}

/** `ETag: "3"`: la versión que el siguiente guardado debe mandar en `If-Match`. */
function withEtag(response: Response, changeset: Changeset) {
  response.setHeader('ETag', `"${changeset.draftVersion}"`);
  return { changeset };
}
