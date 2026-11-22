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
  VERSION_NEUTRAL,
} from '@nestjs/common';
import type { RequestWithId } from '../common/http/request-id.js';
import { IntegrationGatewayService } from './integration-gateway.service.js';
import { IntegrationCallDto } from './integrations.dto.js';

/**
 * Las rutas internas que llama el servidor MCP del servicio de IA (plan 07):
 * fuera del prefijo `/api` y del versionado, y sin sesión de Descope. Las
 * autentican el token del adaptador (`Authorization`) y la credencial delegada
 * (`X-Ktsu-Delegation`). Un proxy público no debe exponerlas.
 */
@Controller({ path: 'internal/v1/mcp-integrations', version: VERSION_NEUTRAL })
export class IntegrationGatewayController {
  constructor(private readonly gateway: IntegrationGatewayService) {}

  @Get('session')
  @Header('Cache-Control', 'no-store')
  session(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-ktsu-delegation') delegation: string | undefined,
    @Headers('x-ktsu-mcp-oauth') oauth: string | undefined,
    @Headers('x-ktsu-mcp-project') project: string | undefined,
    @Req() request: RequestWithId,
  ) {
    return this.gateway.session({
      authorization,
      delegation,
      oauth,
      project,
      requestId: request.requestId,
    });
  }

  @Get('operations')
  @Header('Cache-Control', 'no-store')
  operations(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-ktsu-delegation') delegation: string | undefined,
    @Headers('x-ktsu-mcp-oauth') oauth: string | undefined,
    @Headers('x-ktsu-mcp-project') project: string | undefined,
    @Req() request: RequestWithId,
  ) {
    return this.gateway.operations({
      authorization,
      delegation,
      oauth,
      project,
      requestId: request.requestId,
    });
  }

  @Post('operations/:name')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  call(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-ktsu-delegation') delegation: string | undefined,
    @Headers('x-ktsu-mcp-oauth') oauth: string | undefined,
    @Headers('x-ktsu-mcp-project') project: string | undefined,
    @Param('name') name: string,
    @Body() body: IntegrationCallDto,
    @Req() request: RequestWithId,
  ) {
    return this.gateway.call(
      {
        authorization,
        delegation,
        oauth,
        project,
        requestId: request.requestId,
      },
      name,
      body,
    );
  }
}
