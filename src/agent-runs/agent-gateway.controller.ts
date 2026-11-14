import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { uuidParamPipe } from '../common/http/validation-errors.js';
import { GatewayCallDto } from './agent-runs.dto.js';
import { AgentGatewayService } from './agent-gateway.service.js';

/**
 * La ruta interna que llama el servicio de IA (A11):
 * `POST /internal/v1/agent-runs/:runId/operations/:name`, fuera del prefijo
 * `/api` y del versionado. No usa la sesión de Descope: la autentica la
 * credencial de la ejecución.
 */
@Controller({ path: 'internal/v1/agent-runs', version: VERSION_NEUTRAL })
export class AgentGatewayController {
  constructor(private readonly gateway: AgentGatewayService) {}

  @Post(':runId/operations/:name')
  @HttpCode(200)
  call(
    @Param('runId', uuidParamPipe('runId')) runId: string,
    @Param('name') name: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: GatewayCallDto,
  ) {
    return this.gateway.call(runId, authorization, name, body);
  }
}
