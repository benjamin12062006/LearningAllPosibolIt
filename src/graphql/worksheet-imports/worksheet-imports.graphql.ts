import { Field, ID, InputType, Int, ObjectType } from '@nestjs/graphql';
import { CreateImportMappingDto } from '../../worksheet-imports/import-mappings.dto.js';
import { JsonObjectScalar } from '../common/json-object.scalar.js';
import { JsonScalar } from '../common/json.scalar.js';
import { PageInfoType } from '../common/page-info.type.js';

/** Los campos de una importación que salen también en el historial. */
@ObjectType('WorksheetImportSummary')
export class WorksheetImportSummaryType {
  @Field(() => ID) id!: string;
  @Field(() => ID) worksheetId!: string;
  /** El borrador que creó: se revisa y se aplica como cualquier otro. */
  @Field(() => ID) changesetId!: string;
  @Field(() => ID) createdBy!: string;
  /** `csv` o `xlsx`. */
  @Field() format!: string;
  @Field() fileHash!: string;
  @Field(() => Int) fileBytes!: number;
  /** Las opciones con las que se leyó el archivo, ya combinadas con la plantilla. */
  @Field(() => JsonScalar) options!: unknown;
  @Field(() => JsonScalar) report!: unknown;
  @Field() includedHash!: string;
  @Field() createdAt!: string;
}

@ObjectType('WorksheetImport')
export class WorksheetImportType extends WorksheetImportSummaryType {
  @Field(() => [JsonScalar]) excludedRows!: unknown[];
}

/** En el historial de la hoja: cuántas filas se excluyeron y en qué quedó. */
@ObjectType('WorksheetImportListItem')
export class WorksheetImportListItemType extends WorksheetImportSummaryType {
  @Field(() => Int) excludedRowCount!: number;
  @Field() changesetStatus!: string;
}

@ObjectType('WorksheetImportPage')
export class WorksheetImportPageType {
  @Field(() => [WorksheetImportListItemType])
  items!: WorksheetImportListItemType[];
  @Field(() => PageInfoType) page!: PageInfoType;
}

/** Una plantilla de mapeo: lo reutilizable de una importación. */
@ObjectType('ImportMapping')
export class ImportMappingType {
  @Field(() => ID) id!: string;
  @Field(() => ID) worksheetId!: string;
  @Field() name!: string;
  /** `{ mode, matchColumnId, decimalSeparator, booleanLabels, columns }`. */
  @Field(() => JsonScalar) mapping!: unknown;
  @Field(() => ID) createdBy!: string;
  @Field() createdAt!: string;
}

@ObjectType('ImportMappingPage')
export class ImportMappingPageType {
  @Field(() => [ImportMappingType]) items!: ImportMappingType[];
  @Field(() => PageInfoType) page!: PageInfoType;
}

/** El mapeo es un árbol del dominio: lo valida el mismo analizador que en REST. */
@InputType('CreateImportMappingInput')
export class CreateImportMappingInput extends CreateImportMappingDto {
  @Field() declare name: string;
  @Field(() => JsonObjectScalar) declare mapping: Record<string, unknown>;
}
