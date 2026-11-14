import { Field, ID, InputType, Int, ObjectType } from '@nestjs/graphql';
import { CreateWorksheetExportDto } from '../../worksheet-exports/worksheet-exports.dto.js';
import type {
  CsvDelimiterName,
  ExportFormat,
} from '../../worksheet-exports/worksheet-exports.types.js';
import { JsonObjectScalar } from '../common/json-object.scalar.js';
import { JsonScalar } from '../common/json.scalar.js';
import { PageInfoType } from '../common/page-info.type.js';
import { SortTermInput } from '../worksheets/worksheets.graphql.js';

@ObjectType('WorksheetExport')
export class WorksheetExportType {
  @Field(() => ID) id!: string;
  @Field(() => ID) worksheetId!: string;
  @Field(() => ID) revisionId!: string;
  @Field(() => Int) revisionSequence!: number;
  @Field(() => ID) createdBy!: string;
  /** `csv` o `xlsx`. */
  @Field() format!: string;
  @Field(() => JsonScalar) options!: unknown;
  /** Las columnas, el filtro y el orden con los que se escribió. */
  @Field(() => JsonScalar) query!: unknown;
  @Field() serializerVersion!: string;
  @Field(() => Int) rowCount!: number;
  @Field(() => Int) columnCount!: number;
  @Field(() => Int) problemCellCount!: number;
  @Field(() => Int) byteSize!: number;
  @Field() checksum!: string;
  @Field() createdAt!: string;
}

@ObjectType('WorksheetExportPage')
export class WorksheetExportPageType {
  @Field(() => [WorksheetExportType]) items!: WorksheetExportType[];
  @Field(() => PageInfoType) page!: PageInfoType;
}

/** La exportación y dónde se descarga (la descarga sigue en REST). */
@ObjectType('ExportedWorksheet')
export class ExportedWorksheetType {
  @Field(() => WorksheetExportType) export!: WorksheetExportType;
  @Field() downloadUrl!: string;
}

@InputType('ExportWorksheetInput')
export class ExportWorksheetInput extends CreateWorksheetExportDto {
  /** `csv` o `xlsx`. */
  @Field() declare format: ExportFormat;
  @Field(() => ID, { nullable: true }) declare revisionId?: string;
  @Field(() => [ID], { nullable: true }) declare columns?: string[];
  @Field(() => JsonObjectScalar, { nullable: true })
  declare filter?: Record<string, unknown>;
  @Field(() => [SortTermInput], { nullable: true })
  declare sort?: SortTermInput[];
  /** Solo CSV: `comma` o `semicolon`. */
  @Field(() => String, { nullable: true }) declare delimiter?: CsvDelimiterName;
  /** Solo CSV: `escape` o `keep`. */
  @Field(() => String, { nullable: true })
  declare formulas?: CreateWorksheetExportDto['formulas'];
}
