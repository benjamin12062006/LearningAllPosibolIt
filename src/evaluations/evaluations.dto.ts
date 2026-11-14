import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../common/http/pagination.js';
import { CreateRulesetDto } from '../rulesets/rulesets.dto.js';
import type {
  ProblemAttribute,
  ProblemCode,
} from './engine/google-merchant.profile.js';
import { ROW_OUTCOMES, type RowOutcomeKind } from './evaluations.types.js';
import {
  LANGUAGES,
  PROBLEM_ATTRIBUTES,
  PROBLEM_CODES,
  type Language,
} from './problem-messages.js';

/** Un conjunto de reglas no llega a tantas; es solo un tope para la consulta. */
const MAX_RULE_POSITION = 1_000;

/** La columna `revision` es INTEGER. */
const MAX_REVISION = 2_147_483_647;

/** Body de `POST /projects/:projectId/evaluations`: qué snapshot y con qué revisión. */
export class CreateEvaluationDto {
  @IsUUID()
  snapshotId!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_REVISION)
  rulesetRevision!: number;
}

/**
 * Body de `POST …/evaluations/preview`: las reglas que se quieren probar (el
 * mismo body que al guardarlas) y sobre qué catálogo. Sin `baseRevision` se
 * comparan con la última revisión guardada.
 */
export class PreviewRulesDto extends CreateRulesetDto {
  @IsUUID()
  snapshotId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_REVISION)
  baseRevision?: number;
}

/**
 * `GET …/rows?outcome=invalid&limit=20&offset=0`; sin filtros, todas las filas.
 *
 * Para abrir un grupo de «Requiere atención»: `attribute` y `code` juntos (las
 * filas con ese problema) o `rule` (las que excluyó la regla de esa posición).
 */
export class EvaluationRowsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(ROW_OUTCOMES)
  outcome?: RowOutcomeKind;

  @ValidateIf(isProblemFilter)
  @IsIn(PROBLEM_ATTRIBUTES)
  attribute?: ProblemAttribute;

  @ValidateIf(isProblemFilter)
  @IsIn(PROBLEM_CODES)
  code?: ProblemCode;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_RULE_POSITION)
  rule?: number;
}

/** Un problema es un atributo y un código: si llega uno, el otro es obligatorio. */
function isProblemFilter(query: EvaluationRowsQueryDto) {
  return query.attribute !== undefined || query.code !== undefined;
}

/** `GET …/errors.csv?lang=en`; por defecto en español. */
export class ErrorsCsvQueryDto {
  @IsOptional()
  @IsIn(LANGUAGES)
  lang?: Language;
}
