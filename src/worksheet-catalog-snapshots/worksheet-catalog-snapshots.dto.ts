import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ROW_QUERY_LIMITS } from '../worksheets/row-query.js';
import { WORKSHEET_LIMITS } from '../worksheets/worksheet-columns.js';
import { SortTermDto } from '../worksheets/worksheets.dto.js';

/**
 * Llevar una revisión al catálogo (D24). `columns`, `filter` y `sort` son los
 * de `rows/query` y los valida `parseRowQuery` contra las columnas de la
 * revisión; `idColumnId` debe estar entre las columnas elegidas.
 */
export class CreateWorksheetCatalogSnapshotDto {
  @IsUUID()
  idColumnId!: string;

  @IsOptional()
  @IsUUID()
  revisionId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(WORKSHEET_LIMITS.columnsPerWorksheet)
  @IsUUID('all', { each: true })
  columns?: string[];

  @IsOptional()
  @IsObject()
  filter?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ROW_QUERY_LIMITS.sortColumns)
  @ValidateNested({ each: true })
  @Type(() => SortTermDto)
  sort?: SortTermDto[];
}

/** `POST …/workbooks/:workbookId/worksheets/from-catalog` (H5). */
export class OpenCatalogAsWorksheetDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(WORKSHEET_LIMITS.nameLength)
  name!: string;

  @IsUUID()
  snapshotId!: string;
}

function trim({ value }: { value: unknown }) {
  return typeof value === 'string' ? value.trim() : value;
}
