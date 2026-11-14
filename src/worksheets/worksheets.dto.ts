import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../common/http/pagination.js';
import { ROW_QUERY_LIMITS } from './row-query.js';
import {
  COLUMN_TYPES,
  WORKSHEET_LIMITS,
  type ColumnType,
} from './worksheet-columns.js';

/** Un cursor real ocupa unos 200 caracteres; el margen evita cuerpos enormes. */
const MAX_CURSOR_LENGTH = 512;

function trim({ value }: { value: unknown }) {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateWorkbookDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(WORKSHEET_LIMITS.nameLength)
  name!: string;
}

/** `PATCH …/workbooks/:id` y `PATCH …/worksheets/:id`: el nombre nuevo. */
export class RenameDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(WORKSHEET_LIMITS.nameLength)
  name!: string;
}

/**
 * `POST …/worksheets/:id/duplicate`. Sin `workbookId`, la copia va al mismo
 * libro; sin `revisionId`, se copia la revisión actual.
 */
export class DuplicateWorksheetDto extends RenameDto {
  @IsOptional()
  @IsUUID()
  workbookId?: string;

  @IsOptional()
  @IsUUID()
  revisionId?: string;
}

/** En la consulta todo llega como texto: solo `true` y `false` son booleanos. */
function toBoolean({ value }: { value: unknown }) {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return value;
}

/**
 * `GET …/workbooks?archived=false`. Sin `archived`, activos y archivados (como
 * antes de que existiera archivar); con él, solo unos u otros.
 */
export class ArchivableListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  archived?: boolean;
}

export class SelectionOptionDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(WORKSHEET_LIMITS.nameLength)
  label!: string;
}

export class ColumnDefinitionDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(WORKSHEET_LIMITS.nameLength)
  name!: string;

  @IsIn(COLUMN_TYPES)
  type!: ColumnType;

  /** Sin enviar: la columna admite celdas vacías. */
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  /** Solo en `selection`; lo comprueba `planColumns`. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(WORKSHEET_LIMITS.optionsPerColumn)
  @ValidateNested({ each: true })
  @Type(() => SelectionOptionDto)
  options?: SelectionOptionDto[];

  /**
   * Solo en `calculated`. Es un árbol: lo valida `planColumns`, que además
   * necesita las demás columnas para resolver los nombres.
   */
  @IsOptional()
  @IsObject()
  formula?: Record<string, unknown>;
}

export class CreateWorksheetDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(WORKSHEET_LIMITS.nameLength)
  name!: string;

  /** Una hoja vacía puede empezar sin columnas. */
  @IsArray()
  @ArrayMaxSize(WORKSHEET_LIMITS.columnsPerWorksheet)
  @ValidateNested({ each: true })
  @Type(() => ColumnDefinitionDto)
  columns!: ColumnDefinitionDto[];
}

export class SortTermDto {
  @IsUUID()
  columnId!: string;

  @IsIn(['asc', 'desc'])
  direction!: 'asc' | 'desc';
}

/**
 * Consulta de filas (R10). `filter` es un árbol que valida `parseRowQuery`
 * contra las columnas de la revisión, porque sus columnas válidas dependen de
 * la hoja y no las conoce el DTO.
 */
export class QueryRowsDto {
  @IsOptional()
  @IsUUID()
  revisionId?: string;

  @IsOptional()
  @IsObject()
  filter?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ROW_QUERY_LIMITS.sortColumns)
  @ValidateNested({ each: true })
  @Type(() => SortTermDto)
  sort?: SortTermDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(WORKSHEET_LIMITS.columnsPerWorksheet)
  @IsUUID('all', { each: true })
  columns?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(MAX_CURSOR_LENGTH)
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(ROW_QUERY_LIMITS.pageSize)
  limit?: number;
}
