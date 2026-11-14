import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import { ApiErrorType } from '../common/api-error.type.js';
import { JsonScalar } from '../common/json.scalar.js';
import { PageInfoType } from '../common/page-info.type.js';

export enum ImportJobStatus {
  queued = 'queued',
  running = 'running',
  succeeded = 'succeeded',
  failed = 'failed',
}
export enum ImportSnapshotStatus {
  pending = 'pending',
  importing = 'importing',
  ready = 'ready',
  failed = 'failed',
}
export enum ImportDelimiter {
  comma = 'comma',
  semicolon = 'semicolon',
}
registerEnumType(ImportJobStatus, { name: 'ImportJobStatus' });
registerEnumType(ImportSnapshotStatus, { name: 'ImportSnapshotStatus' });
registerEnumType(ImportDelimiter, { name: 'ImportDelimiter' });

@ObjectType('ImportJob')
export class ImportJobType {
  @Field(() => ID) id!: string;
  @Field(() => ID) projectId!: string;
  @Field(() => ID) snapshotId!: string;
  @Field(() => ImportJobStatus) status!: ImportJobStatus;
  @Field(() => Int) processedRows!: number;
  @Field() createdAt!: string;
  @Field(() => String, { nullable: true }) startedAt!: string | null;
  @Field(() => String, { nullable: true }) finishedAt!: string | null;
  @Field(() => ApiErrorType, { nullable: true }) error!: ApiErrorType | null;
}

@ObjectType('ImportRow')
export class ImportRowType {
  @Field(() => Int) sourceRow!: number;
  @Field() externalId!: string;
  @Field(() => JsonScalar) originalValues!: Record<string, string>;
}

@ObjectType('ImportSnapshot')
export class ImportSnapshotType {
  @Field(() => ID) id!: string;
  @Field(() => ID) projectId!: string;
  @Field() idColumn!: string;
  @Field(() => ImportDelimiter) delimiter!: ImportDelimiter;
  @Field(() => [String], { nullable: true }) headers!: string[] | null;
  @Field() sourceHash!: string;
  @Field(() => Int) byteSize!: number;
  @Field() originalName!: string;
  @Field(() => ImportSnapshotStatus) status!: ImportSnapshotStatus;
  @Field(() => Int, { nullable: true }) rowCount!: number | null;
  @Field() createdAt!: string;
  @Field(() => String, { nullable: true }) finishedAt!: string | null;
  @Field(() => ApiErrorType, { nullable: true }) error!: ApiErrorType | null;
  @Field(() => [ImportRowType]) sample!: ImportRowType[];
}

/** El trabajo de una importación listada: cuánto lleva. */
@ObjectType('ImportJobSummary')
export class ImportJobSummaryType {
  @Field(() => ID) id!: string;
  @Field(() => ImportJobStatus) status!: ImportJobStatus;
  @Field(() => Int) processedRows!: number;
}

/** Una importación en el listado del proyecto: sin cabeceras ni muestra. */
@ObjectType('ImportSummary')
export class ImportSummaryType {
  @Field(() => ID) id!: string;
  @Field(() => ID) projectId!: string;
  @Field() idColumn!: string;
  @Field(() => ImportDelimiter) delimiter!: ImportDelimiter;
  @Field(() => Int) byteSize!: number;
  @Field() originalName!: string;
  @Field(() => ImportSnapshotStatus) status!: ImportSnapshotStatus;
  @Field(() => Int, { nullable: true }) rowCount!: number | null;
  @Field() createdAt!: string;
  @Field(() => String, { nullable: true }) finishedAt!: string | null;
  @Field(() => ApiErrorType, { nullable: true }) error!: ApiErrorType | null;
  @Field(() => ImportJobSummaryType, { nullable: true })
  job!: ImportJobSummaryType | null;
}

@ObjectType('ImportPage')
export class ImportPageType {
  @Field(() => [ImportSummaryType]) items!: ImportSummaryType[];
  @Field(() => PageInfoType) page!: PageInfoType;
}
