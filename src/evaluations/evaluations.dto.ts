import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { PaginationQueryDto } from '../common/http/pagination.js';
import { ROW_OUTCOMES, type RowOutcomeKind } from './evaluations.types.js';
import { LANGUAGES, type Language } from './problem-messages.js';

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

/** `GET …/rows?outcome=invalid&limit=20&offset=0`; sin `outcome`, todas las filas. */
export class EvaluationRowsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(ROW_OUTCOMES)
  outcome?: RowOutcomeKind;
}

/** `GET …/errors.csv?lang=en`; por defecto en español. */
export class ErrorsCsvQueryDto {
  @IsOptional()
  @IsIn(LANGUAGES)
  lang?: Language;
}
