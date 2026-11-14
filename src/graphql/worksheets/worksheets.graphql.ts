import { ArgsType, Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { JsonScalar } from '../common/json.scalar.js';

/** El mismo tope que la consulta REST de filas (`ROW_QUERY_LIMITS`). */
const MAX_ROWS_PER_PAGE = 100;

@ObjectType('WorksheetRevision')
export class WorksheetRevisionType {
  @Field(() => ID) id!: string;
  @Field(() => Int) sequence!: number;
  @Field(() => Int) rowCount!: number;
  @Field() createdAt!: string;
}

@ObjectType('WorksheetColumn')
export class WorksheetColumnType {
  @Field(() => ID) id!: string;
  @Field() name!: string;
  @Field() type!: string;
  @Field(() => Int) position!: number;
  @Field() required!: boolean;
  /** Solo en las columnas de selección: `[{ id, label }]`. */
  @Field(() => JsonScalar, { nullable: true }) options?: unknown;
  /** Solo en las calculadas. */
  @Field(() => JsonScalar, { nullable: true }) formula?: unknown;
}

/** Una página de filas: `{ rowId, values, problems }` por fila. */
@ObjectType('WorksheetRowPage')
export class WorksheetRowPageType {
  @Field(() => [JsonScalar]) items!: unknown[];
  @Field(() => String, { nullable: true }) nextCursor!: string | null;
  @Field(() => ID) revisionId!: string;
  @Field(() => Int) schemaVersion!: number;
}

@ObjectType('Worksheet')
export class WorksheetType {
  @Field(() => ID) id!: string;
  @Field(() => ID) workbookId!: string;
  @Field() name!: string;
  @Field() mode!: string;
  @Field(() => Int) schemaVersion!: number;
  @Field(() => Int) generation!: number;
  @Field(() => WorksheetRevisionType) headRevision!: WorksheetRevisionType;
  @Field(() => [WorksheetColumnType]) columns!: WorksheetColumnType[];
  @Field() createdAt!: string;
}

/**
 * Lo que la consulta de filas admite por GraphQL en el piloto: página, cursor y
 * revisión. El filtro y el orden de REST son árboles; llegan con C7, cuando
 * haya un tipo de entrada para ellos.
 */
@ArgsType()
export class WorksheetRowsArgs {
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_ROWS_PER_PAGE)
  limit?: number;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  cursor?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  revisionId?: string;
}
