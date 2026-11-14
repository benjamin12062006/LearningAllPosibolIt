import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { CurrentIdentity } from '../auth/current-identity.decorator.js';
import { DescopeSessionGuard } from '../auth/descope-session.guard.js';
import { PaginationQueryDto } from '../common/http/pagination.js';
import { uuidParamPipe } from '../common/http/validation-errors.js';
import {
  CreateEvaluationDto,
  ErrorsCsvQueryDto,
  EvaluationRowsQueryDto,
  PreviewRulesDto,
} from './evaluations.dto.js';
import { EvaluationsService } from './evaluations.service.js';

/** RFC 4180 registra `text/csv` con los parámetros `charset` y `header` (F32). */
const ERRORS_CSV_TYPE = 'text/csv; charset=utf-8; header=present';

@Controller('projects/:projectId/evaluations')
@UseGuards(DescopeSessionGuard)
export class EvaluationsController {
  constructor(private readonly evaluations: EvaluationsService) {}

  /** 202: la evaluación queda en cola; el resultado se consulta después. */
  @Post()
  @HttpCode(202)
  accept(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Body() body: CreateEvaluationDto,
  ) {
    return this.evaluations.accept(identity, projectId, body);
  }

  /** Historial del proyecto: `{ evaluations, page }`, sin muestra (plan 02). */
  /**
   * Prueba unas reglas sobre un catálogo sin guardar nada: `{ preview: {
   * counts, problems, outcomeChanges, changedValues, changedProducts,
   * products, page } }`. `200` y no `201`: no crea ningún recurso.
   */
  @Post('preview')
  @HttpCode(200)
  async previewRules(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Body() body: PreviewRulesDto,
    @Query() query: PaginationQueryDto,
  ) {
    return {
      preview: await this.evaluations.previewRules(
        identity,
        projectId,
        body,
        query,
      ),
    };
  }

  @Get()
  async findAll(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Query() query: PaginationQueryDto,
  ) {
    const { items, page } = await this.evaluations.findAll(
      identity,
      projectId,
      query,
    );
    return { evaluations: items, page };
  }

  /** Respuesta `{ evaluation, sample }`. */
  @Get(':evaluationId')
  findOne(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('evaluationId', uuidParamPipe('evaluationId')) evaluationId: string,
  ) {
    return this.evaluations.findOne(identity, projectId, evaluationId);
  }

  @Get(':evaluationId/rows')
  async findRows(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('evaluationId', uuidParamPipe('evaluationId')) evaluationId: string,
    @Query() query: EvaluationRowsQueryDto,
  ) {
    const { items, page } = await this.evaluations.findRows(
      identity,
      projectId,
      evaluationId,
      query,
    );
    return { rows: items, page };
  }

  /**
   * «Requiere atención»: `{ attention: { affectedProducts, problemGroups,
   * excludedProducts, exclusionGroups } }`. Cada grupo se abre con `…/rows`.
   */
  @Get(':evaluationId/attention')
  async findAttention(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('evaluationId', uuidParamPipe('evaluationId')) evaluationId: string,
  ) {
    return {
      attention: await this.evaluations.findAttention(
        identity,
        projectId,
        evaluationId,
      ),
    };
  }

  /** Descarga de `errores.csv` (D10); `StreamableFile` fija las cabeceras (F37). */
  @Get(':evaluationId/errors.csv')
  async downloadErrorsCsv(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('projectId', uuidParamPipe('projectId')) projectId: string,
    @Param('evaluationId', uuidParamPipe('evaluationId')) evaluationId: string,
    @Query() query: ErrorsCsvQueryDto,
  ) {
    const csv = await this.evaluations.buildErrorsCsv(
      identity,
      projectId,
      evaluationId,
      query.lang ?? 'es',
    );
    return new StreamableFile(Buffer.from(csv, 'utf8'), {
      type: ERRORS_CSV_TYPE,
      disposition: `attachment; filename="errores-${evaluationId}.csv"`,
    });
  }
}
