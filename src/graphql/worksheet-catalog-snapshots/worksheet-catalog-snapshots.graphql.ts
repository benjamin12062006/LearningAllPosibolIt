import { Field, ID, InputType, Int, ObjectType } from '@nestjs/graphql';
import {
  CreateWorksheetCatalogSnapshotDto,
  OpenCatalogAsWorksheetDto,
} from '../../worksheet-catalog-snapshots/worksheet-catalog-snapshots.dto.js';
import { JsonObjectScalar } from '../common/json-object.scalar.js';
import { JsonScalar } from '../common/json.scalar.js';
import { SortTermInput } from '../worksheets/worksheets.graphql.js';

/** De qué revisión y con qué columnas salió un catálogo de una hoja. */
@ObjectType('WorksheetCatalogSnapshot')
export class WorksheetCatalogSnapshotType {
  @Field(() => ID) snapshotId!: string;
  @Field(() => ID) worksheetId!: string;
  @Field(() => ID) revisionId!: string;
  @Field(() => Int) revisionSequence!: number;
  @Field(() => ID) createdBy!: string;
  @Field(() => ID) idColumnId!: string;
  /** Cada columna con la cabecera que tomó en el CSV. */
  @Field(() => [JsonScalar]) columns!: unknown[];
  @Field(() => JsonScalar) query!: unknown;
  @Field() serializerVersion!: string;
  @Field(() => Int) rowCount!: number;
  @Field() sourceHash!: string;
  @Field() createdAt!: string;
}

/** El catálogo queda en cola de importación (202 en REST); se sigue con `importJob`. */
@ObjectType('WorksheetCatalogAcceptance')
export class WorksheetCatalogAcceptanceType {
  @Field(() => WorksheetCatalogSnapshotType)
  catalogSnapshot!: WorksheetCatalogSnapshotType;
  @Field(() => ID) snapshotId!: string;
  @Field(() => ID) jobId!: string;
  @Field() status!: string;
  @Field() statusUrl!: string;
}

@InputType('SendWorksheetToCatalogInput')
export class SendWorksheetToCatalogInput extends CreateWorksheetCatalogSnapshotDto {
  /** La columna que será el `id` del catálogo. */
  @Field(() => ID) declare idColumnId: string;
  @Field(() => ID, { nullable: true }) declare revisionId?: string;
  @Field(() => [ID], { nullable: true }) declare columns?: string[];
  @Field(() => JsonObjectScalar, { nullable: true })
  declare filter?: Record<string, unknown>;
  @Field(() => [SortTermInput], { nullable: true })
  declare sort?: SortTermInput[];
}

@InputType('OpenCatalogAsWorksheetInput')
export class OpenCatalogAsWorksheetInput extends OpenCatalogAsWorksheetDto {
  @Field() declare name: string;
  @Field(() => ID) declare snapshotId: string;
}
