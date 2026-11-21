import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { CurrentIdentity } from '../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../auth/descope-session.guard.js';
import { uuidParamPipe } from '../common/http/validation-errors.js';
import {
  ProposalDecisionDto,
  RunEventsQueryDto,
  StartAgentRunDto,
} from './agent-runs.dto.js';
import { AgentRunsService } from './agent-runs.service.js';

/**
 * Las rutas de la persona para el agente (E6.3a). `P` es
 * `/organizations/:organizationId/projects/:projectId`.
 */
/** Cada cuánto se miran hitos nuevos y cuánto dura como mucho un flujo SSE. */
const SSE_LIMITS = { pollMs: 250, maxMs: 5 * 60_000 } as const;
/** Un comentario cada 15 s mantiene viva la conexión a través de proxies. */
const HEARTBEAT_MS = 15_000;

@Controller('organizations/:organizationId/projects/:projectId')
@UseGuards(DescopeSessionGuard)
export class AgentRunsController {
  constructor(private readonly runs: AgentRunsService) {}

  /** 202: la ejecución queda en cola; se sigue con `GET …/ai-runs/:runId`. */
  @Post('conversations/:conversationId/runs')
  @HttpCode(202)
  async start(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('conversationId', uuidParamPipe('conversationId'))
    conversationId: string,
    @Body() body: StartAgentRunDto,
  ) {
    const run = await this.runs.start(
      identity,
      { organizationId, projectId },
      conversationId,
      body,
    );
    return { run };
  }

  @Get('conversations/:conversationId/runs/latest')
  async latest(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('conversationId', uuidParamPipe('conversationId'))
    conversationId: string,
  ) {
    return {
      run: await this.runs.latest(
        identity,
        { organizationId, projectId },
        conversationId,
      ),
    };
  }

  @Get('ai-runs/:runId')
  async find(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('runId', uuidParamPipe('runId')) runId: string,
  ) {
    const run = await this.runs.find(
      identity,
      { organizationId, projectId },
      runId,
    );
    return { run };
  }

  @Post('ai-runs/:runId/proposals/:proposalId/confirm')
  @HttpCode(200)
  async confirm(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('runId', uuidParamPipe('runId')) runId: string,
    @Param('proposalId', uuidParamPipe('proposalId')) proposalId: string,
    @Body() body: ProposalDecisionDto,
  ) {
    // `{ proposal, continuation, continuationError }` (plan 10, D7).
    return this.runs.confirm(
      identity,
      { organizationId, projectId },
      runId,
      proposalId,
      body.proposalHash,
    );
  }

  @Post('ai-runs/:runId/proposals/:proposalId/reject')
  @HttpCode(200)
  async reject(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('runId', uuidParamPipe('runId')) runId: string,
    @Param('proposalId', uuidParamPipe('proposalId')) proposalId: string,
    @Body() body: ProposalDecisionDto,
  ) {
    const proposal = await this.runs.reject(
      identity,
      { organizationId, projectId },
      runId,
      proposalId,
      body.proposalHash,
    );
    return { proposal };
  }

  @Post('ai-runs/:runId/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('runId', uuidParamPipe('runId')) runId: string,
  ) {
    const run = await this.runs.cancel(
      identity,
      { organizationId, projectId },
      runId,
    );
    return { run };
  }

  /**
   * Los hitos de la ejecución por SSE (E6.4, D4): `id` es la secuencia, que la
   * web manda en `after` o en `Last-Event-ID` al reconectar. El acceso se
   * comprueba antes de abrir el flujo, así lo ajeno responde 404 en JSON.
   */
  @Get('ai-runs/:runId/events')
  async events(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('organizationId', uuidParamPipe('organizationId'))
    organizationId: string,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('runId', uuidParamPipe('runId')) runId: string,
    @Query() query: RunEventsQueryDto,
    @Headers('last-event-id') lastEventId: string | undefined,
    @Res() response: Response,
  ) {
    await this.runs.find(identity, { organizationId, projectId }, runId);
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    let closed = false;
    response.on('close', () => {
      closed = true;
    });
    let lastWrite = Date.now();
    const after = query.after ?? lastSequence(lastEventId);
    for await (const event of this.runs.events(runId, after, SSE_LIMITS)) {
      if (closed) {
        break;
      }
      if (event) {
        response.write(
          `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify({
            ...event.payload,
            createdAt: event.createdAt,
          })}\n\n`,
        );
        lastWrite = Date.now();
      } else if (Date.now() - lastWrite >= HEARTBEAT_MS) {
        response.write(': latido\n\n');
        lastWrite = Date.now();
      }
    }
    response.end();
  }
}

/** `Last-Event-ID` es texto libre: solo vale un entero no negativo. */
function lastSequence(header: string | undefined): number {
  const value = Number(header);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}
