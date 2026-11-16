import {
  ArgsType,
  Field,
  ID,
  InputType,
  Int,
  ObjectType,
} from '@nestjs/graphql';
import {
  ArchivableListQueryDto,
  ColumnDefinitionDto,
  CreateWorkbookDto,
  CreateWorksheetDto,
  DuplicateWorksheetDto,
  QueryRowsDto,
  RenameDto,
  SelectionOptionDto,
  SortTermDto,
} from '../../worksheets/worksheets.dto.js';
import type { ColumnType } from '../../worksheets/worksheet-columns.js';
import { JsonObjectScalar } from '../common/json-object.scalar.js';
import { JsonScalar } from '../common/json.scalar.js';
import { PageInfoType } from '../common/page-info.type.js';

@ObjectType('WorksheetRevision')
export class WorksheetRevisionType {
  @Field(() => ID) id!: string;
  @Field(() => Int) sequence!: number;
  @Field(() => Int) rowCount!: number;
  @Field() createdAt!: string;
}

/** Una revisión en el historial de la hoja: de dónde salió y quién la hizo. */
@ObjectType('WorksheetRevisionEntry')
export class WorksheetRevisionEntryType {
  @Field(() => ID) id!: string;
  @Field(() => Int) sequence!: number;
  @Field(() => Int) schemaVersion!: number;
  /** `initialize`, `changeset`, `duplicate` o `catalog`. */
  @Field() source!: string;
  @Field(() => Int) rowCount!: number;
  @Field(() => ID, { nullable: true }) changesetId!: string | null;
  @Field(() => ID) createdBy!: string;
  @Field() createdAt!: string;
}

@ObjectType('WorksheetRevisionPage')
export class WorksheetRevisionPageType {
  @Field(() => [WorksheetRevisionEntryType])
  items!: WorksheetRevisionEntryType[];
  @Field(() => PageInfoType) page!: PageInfoType;
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

/** Lo que puede hacer quien pregunta con esta hoja. */
@ObjectType('WorksheetCapabilities')
export class WorksheetCapabilitiesType {
  @Field() write!: boolean;
  @Field() approve!: boolean;
}

@ObjectType('WorksheetOrigin')
export class WorksheetOriginType {
  @Field(() => ID) worksheetId!: string;
  @Field(() => ID) revisionId!: string;
}

@ObjectType('CatalogOrigin')
export class CatalogOriginType {
  @Field(() => ID) snapshotId!: string;
}

/** Los campos de una hoja en un listado: sin columnas. */
@ObjectType('WorksheetSummary')
export class WorksheetSummaryType {
  @Field(() => ID) id!: string;
  @Field(() => ID) workbookId!: string;
  @Field() name!: string;
  @Field() mode!: string;
  @Field(() => Int) schemaVersion!: number;
  @Field(() => Int) generation!: number;
  @Field(() => WorksheetRevisionType) headRevision!: WorksheetRevisionType;
  @Field() createdAt!: string;
  /** Nulo si la hoja está activa. */
  @Field(() => String, { nullable: true }) archivedAt!: string | null;
  /** No nulo si su libro está archivado: tampoco admite cambios. */
  @Field(() => String, { nullable: true }) workbookArchivedAt!: string | null;
  /** Solo en una copia. */
  @Field(() => WorksheetOriginType, { nullable: true })
  duplicatedFrom!: WorksheetOriginType | null;
  /** Solo en una hoja abierta desde un catálogo. */
  @Field(() => CatalogOriginType, { nullable: true })
  openedFromCatalog!: CatalogOriginType | null;
}

@ObjectType('Worksheet')
export class WorksheetType extends WorksheetSummaryType {
  @Field(() => [WorksheetColumnType]) columns!: WorksheetColumnType[];
  @Field(() => WorksheetCapabilitiesType)
  capabilities!: WorksheetCapabilitiesType;
}

@ObjectType('WorksheetSummaryPage')
export class WorksheetSummaryPageType {
  @Field(() => [WorksheetSummaryType]) items!: WorksheetSummaryType[];
  @Field(() => PageInfoType) page!: PageInfoType;
}

@ObjectType('Workbook')
export class WorkbookType {
  @Field(() => ID) id!: string;
  @Field(() => ID) projectId!: string;
  @Field() name!: string;
  @Field() createdAt!: string;
  /** Nulo si está activo. */
  @Field(() => String, { nullable: true }) archivedAt!: string | null;
}

@ObjectType('WorkbookPage')
export class WorkbookPageType {
  @Field(() => [WorkbookType]) items!: WorkbookType[];
  @Field(() => PageInfoType) page!: PageInfoType;
}

/** `?archived=`: sin él, activos y archivados, como en REST. */
@ArgsType()
export class ArchivableListArgs extends ArchivableListQueryDto {
  @Field(() => Int, { nullable: true }) declare limit?: number;
  @Field(() => Int, { nullable: true }) declare offset?: number;
  @Field(() => Boolean, { nullable: true }) declare archived?: boolean;
}

@InputType('SortTermInput')
export class SortTermInput extends SortTermDto {
  @Field(() => ID) declare columnId: string;
  /** `asc` o `desc`. */
  @Field() declare direction: 'asc' | 'desc';
}

/**
 * Lo mismo que el cuerpo de `POST …/rows/query`: el filtro es un árbol del
 * dominio (`JSONObject`) y lo valida el mismo analizador que en REST.
 */
@ArgsType()
export class WorksheetRowsArgs extends QueryRowsDto {
  @Field(() => ID, { nullable: true }) declare revisionId?: string;
  @Field(() => ID, { nullable: true }) declare viewId?: string;
  @Field(() => JsonObjectScalar, { nullable: true })
  declare filter?: Record<string, unknown>;
  @Field(() => [SortTermInput], { nullable: true })
  declare sort?: SortTermInput[];
  @Field(() => [ID], { nullable: true }) declare columns?: string[];
  @Field(() => String, { nullable: true }) declare cursor?: string;
  @Field(() => Int, { nullable: true }) declare limit?: number;
}

@InputType('NameInput')
export class NameInput extends RenameDto {
  @Field() declare name: string;
}

@InputType('CreateWorkbookInput')
export class CreateWorkbookInput extends CreateWorkbookDto {
  @Field() declare name: string;
}

@InputType('SelectionOptionInput')
export class SelectionOptionInput extends SelectionOptionDto {
  @Field() declare label: string;
}

@InputType('ColumnDefinitionInput')
export class ColumnDefinitionInput extends ColumnDefinitionDto {
  @Field() declare name: string;
  /** Uno de los tipos de columna, como en REST. */
  @Field() declare type: ColumnType;
  @Field(() => Boolean, { nullable: true }) declare required?: boolean;
  @Field(() => [SelectionOptionInput], { nullable: true })
  declare options?: SelectionOptionInput[];
  /** Solo en las calculadas: el árbol de la fórmula. */
  @Field(() => JsonObjectScalar, { nullable: true })
  declare formula?: Record<string, unknown>;
}

@InputType('CreateWorksheetInput')
export class CreateWorksheetInput extends CreateWorksheetDto {
  @Field() declare name: string;
  @Field(() => [ColumnDefinitionInput])
  declare columns: ColumnDefinitionInput[];
}

@InputType('DuplicateWorksheetInput')
export class DuplicateWorksheetInput extends DuplicateWorksheetDto {
  @Field() declare name: string;
  /** Otro libro del proyecto; sin él, el mismo. */
  @Field(() => ID, { nullable: true }) declare workbookId?: string;
  /** Una revisión anterior; sin ella, la actual. */
  @Field(() => ID, { nullable: true }) declare revisionId?: string;
}
