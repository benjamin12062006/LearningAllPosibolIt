import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
  StreamableFile,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import type { RequestWithId } from '../common/http/request-id.js';
import { uuidParamPipe } from '../common/http/validation-errors.js';
import { ExportsService } from '../exports/exports.service.js';
import { FeedsService } from '../feeds/feeds.service.js';
import { WorksheetExportsService } from '../worksheet-exports/worksheet-exports.service.js';
import { CliOAuthAccess } from './cli-oauth-access.js';
import { IntegrationGatewayService } from './integration-gateway.service.js';
import { IntegrationCallDto } from './integrations.dto.js';

@Controller('integrations')
export class CliIntegrationController {
  constructor(
    private readonly gateway: IntegrationGatewayService,
    private readonly oauth: CliOAuthAccess,
    private readonly worksheets: WorksheetExportsService,
    private readonly exports: ExportsService,
    private readonly feeds: FeedsService,
  ) {}

  @Get('oauth')
  @Header('Cache-Control', 'no-store')
  oauthMetadata() {
    return this.oauth.metadata();
  }

  @Get('session')
  @Header('Cache-Control', 'no-store')
  session(@Req() request: RequestWithId) {
    return this.gateway.session(cliHeaders(request));
  }

  @Get('operations')
  @Header('Cache-Control', 'no-store')
  operations(@Req() request: RequestWithId) {
    return this.gateway.operations(cliHeaders(request));
  }

  @Post('operations/:name')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  call(
    @Req() request: RequestWithId,
    @Param('name') name: string,
    @Body() body: IntegrationCallDto,
  ) {
    return this.gateway.call(cliHeaders(request), name, body);
  }

  @Get('proposals/:proposalId')
  @Header('Cache-Control', 'no-store')
  async proposal(
    @Req() request: RequestWithId,
    @Param('proposalId', uuidParamPipe('proposalId')) proposalId: string,
  ) {
    const { proposal } = await this.gateway.cliProposalAccess(
      cliHeaders(request),
      proposalId,
    );
    return { proposal };
  }

  @Get('proposals/:proposalId/file')
  @Header('Cache-Control', 'no-store')
  async downloadWorksheet(
    @Req() request: RequestWithId,
    @Param('proposalId', uuidParamPipe('proposalId')) proposalId: string,
  ) {
    const { proposal, delegation } = await this.gateway.cliProposalAccess(
      cliHeaders(request),
      proposalId,
    );
    const result = proposal.result;
    if (
      proposal.operation !== 'export_worksheet' ||
      proposal.status !== 'confirmed' ||
      !result ||
      typeof result !== 'object' ||
      !('exportId' in result) ||
      typeof result.exportId !== 'string' ||
      !isUUID(result.exportId)
    ) {
      throw apiError(ErrorCodes.WORKSHEET_EXPORT_NOT_FOUND);
    }
    const { content, file } = await this.worksheets.openDownload(
      delegation.identity,
      delegation.scope,
      result.exportId,
    );
    const type =
      file.format === 'csv'
        ? 'text/csv; charset=utf-8'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    return new StreamableFile(content, {
      type,
      disposition: `attachment; filename="hoja-${result.exportId}.${file.format}"`,
      length: file.byteSize,
    });
  }

  @Get('exports/:exportId/file')
  @Header('Cache-Control', 'no-store')
  async downloadExport(
    @Req() request: RequestWithId,
    @Param('exportId', uuidParamPipe('exportId')) exportId: string,
  ) {
    const { identity, scope } = await this.gateway.cliReader(
      cliHeaders(request),
    );
    const { content } = await this.exports.openDownload(
      identity,
      scope.projectId,
      exportId,
    );
    return new StreamableFile(content, {
      type: 'text/tab-separated-values; charset=utf-8',
      disposition: `attachment; filename="export-${exportId}.tsv"`,
    });
  }

  @Get('feeds/:feedId/versions/:versionId/file')
  @Header('Cache-Control', 'no-store')
  async downloadFeed(
    @Req() request: RequestWithId,
    @Param('feedId', uuidParamPipe('feedId')) feedId: string,
    @Param('versionId', uuidParamPipe('versionId')) versionId: string,
  ) {
    const { identity, scope } = await this.gateway.cliReader(
      cliHeaders(request),
    );
    const { content } = await this.feeds.openVersionFile(
      identity,
      scope.projectId,
      feedId,
      versionId,
    );
    return new StreamableFile(content, {
      type: 'text/tab-separated-values; charset=utf-8',
      disposition: `attachment; filename="feed-${versionId}.tsv"`,
    });
  }
}

function cliHeaders(request: RequestWithId) {
  return {
    channel: 'cli' as const,
    authorization: request.header('authorization'),
    project: request.header('x-ktsu-cli-project')?.toLowerCase(),
    requestId: request.requestId,
  };
}
