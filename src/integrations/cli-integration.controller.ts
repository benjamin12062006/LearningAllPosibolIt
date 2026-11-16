import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { RequestWithId } from '../common/http/request-id.js';
import { IntegrationGatewayService } from './integration-gateway.service.js';
import { IntegrationCallDto } from './integrations.dto.js';

@Controller('integrations')
export class CliIntegrationController {
  constructor(private readonly gateway: IntegrationGatewayService) {}

  @Get('session')
  @Header('Cache-Control', 'no-store')
  session(
    @Headers('authorization') authorization: string | undefined,
    @Req() request: RequestWithId,
  ) {
    return this.gateway.session({
      channel: 'cli',
      authorization,
      requestId: request.requestId,
    });
  }

  @Get('operations')
  @Header('Cache-Control', 'no-store')
  operations(
    @Headers('authorization') authorization: string | undefined,
    @Req() request: RequestWithId,
  ) {
    return this.gateway.operations({
      channel: 'cli',
      authorization,
      requestId: request.requestId,
    });
  }

  @Post('operations/:name')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  call(
    @Headers('authorization') authorization: string | undefined,
    @Req() request: RequestWithId,
    @Param('name') name: string,
    @Body() body: IntegrationCallDto,
  ) {
    return this.gateway.call(
      { channel: 'cli', authorization, requestId: request.requestId },
      name,
      body,
    );
  }
}
