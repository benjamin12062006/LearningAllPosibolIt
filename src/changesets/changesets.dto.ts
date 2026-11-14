import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../common/http/pagination.js';
import { MAX_OPERATIONS } from './changeset-operations.js';
import {
  CHANGESET_STATUSES,
  type ChangesetStatus,
} from './changesets.types.js';

const SHA256_HEX = /^[a-f0-9]{64}$/;

function trim({ value }: { value: unknown }) {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateChangesetDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;
}

/** `GET …/worksheets/:id/changesets?status=draft&limit=20`; sin `status`, todos. */
export class ChangesetListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(CHANGESET_STATUSES)
  status?: ChangesetStatus;
}

/**
 * Cada operación es un objeto cuya forma depende de su `type`: la valida
 * `normalizeOperations`, que además necesita el esquema y las filas de la base.
 */
export class SaveOperationsDto {
  @IsArray()
  @ArrayMaxSize(MAX_OPERATIONS)
  operations!: unknown[];
}

/** La versión del borrador que la persona tenía delante (D5, D7, D9). */
export class DraftVersionDto {
  @IsInt()
  @Min(1)
  draftVersion!: number;
}

export class DecisionDto extends DraftVersionDto {
  @IsIn(['accept', 'reject'])
  decision!: 'accept' | 'reject';

  @Matches(SHA256_HEX)
  contentHash!: string;

  @IsUUID()
  expectedHeadRevisionId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ApplyChangesetDto {
  @Matches(SHA256_HEX)
  contentHash!: string;

  @IsUUID()
  expectedHeadRevisionId!: string;
}

/**
 * Elección para un conflicto de celda (`rowId` y `columnId`), de fila
 * (`columnId` null) o de columna (`rowId` null, E4.7).
 */
export class ConflictResolutionDto {
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  rowId!: string | null;

  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  columnId!: string | null;

  @IsIn(['proposed', 'head'])
  choice!: 'proposed' | 'head';
}

export class RebaseDto extends DraftVersionDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_OPERATIONS)
  @ValidateNested({ each: true })
  @Type(() => ConflictResolutionDto)
  resolutions?: ConflictResolutionDto[];
}
