import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { ROW_QUERY_LIMITS } from '../worksheets/row-query.js';
import { WORKSHEET_LIMITS } from '../worksheets/worksheet-columns.js';
import { SortTermDto } from '../worksheets/worksheets.dto.js';
import type { CsvFormulaPolicy } from './export-csv.js';
import type {
  CsvDelimiterName,
  ExportFormat,
} from './worksheet-exports.types.js';

/**
 * Exportar una revisión (D16). `filter`, `sort` y `columns` son los de
 * `rows/query` y los valida `parseRowQuery` contra las columnas de la
 * revisión; `delimiter` y `formulas` solo valen para CSV.
 */
export class CreateWorksheetExportDto {
  @IsIn(['csv', 'xlsx'])
  format!: ExportFormat;

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

  @IsOptional()
  @IsIn(['comma', 'semicolon'])
  delimiter?: CsvDelimiterName;

  @IsOptional()
  @IsIn(['escape', 'keep'])
  formulas?: CsvFormulaPolicy;
}
