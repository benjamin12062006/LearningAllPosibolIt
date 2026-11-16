import {
  ArgsType,
  Field,
  ID,
  InputType,
  Int,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import type { ImportDelimiter } from '../../catalog-import/import.types.js';
import {
  ApproveFeedPolicyDto,
  PublishFeedDto,
  UpdateFeedScheduleDto,
  UpdateFeedSourceDto,
} from '../../feeds/feeds.dto.js';
import {
  CHANGE_KINDS,
  type ChangeKind,
} from '../../feed-viewer/tsv-comparison.js';
import { ApiErrorType } from '../common/api-error.type.js';
import { PageInfoType } from '../common/page-info.type.js';
import { PaginationArgs } from '../common/pagination.args.js';

export enum ProductChangeKind {
  added = 'added',
  removed = 'removed',
  modified = 'modified',
}
registerEnumType(ProductChangeKind, { name: 'ProductChangeKind' });

@ObjectType('FeedPublishedVersion')
export class FeedPublishedVersionType {
  @Field(() => ID) id!: string;
  /** Nulos si se borró la importación de la que salió. */
  @Field(() => ID, { nullable: true }) exportId!: string | null;
  @Field(() => ID, { nullable: true }) evaluationId!: string | null;
  @Field(() => Int) rowCount!: number;
  @Field(() => Int) byteSize!: number;
  @Field() tsvChecksum!: string;
  @Field() publishedBy!: string;
  @Field() publishedAt!: string;
}

/** Una versión del historial del feed. */
@ObjectType('FeedVersion')
export class FeedVersionType extends FeedPublishedVersionType {
  /** La versión publicada ahora. */
  @Field() current!: boolean;
  /** `false` si la retención ya retiró su archivo: no se puede volver a ella. */
  @Field() fileRetained!: boolean;
}

/** Si la URL pública entrega y, si no, por qué. Nunca lleva el token. */
@ObjectType('FeedDelivery')
export class FeedDeliveryType {
  @Field() delivering!: boolean;
  @Field(() => String, { nullable: true }) reason!: string | null;
  @Field() deliveryEnabled!: boolean;
}

@ObjectType('ProductFieldChange')
export class ProductFieldChangeType {
  @Field() field!: string;
  @Field(() => String, { nullable: true }) before!: string | null;
  @Field(() => String, { nullable: true }) after!: string | null;
}

@ObjectType('ProductChange')
export class ProductChangeType {
  @Field(() => ID) id!: string;
  @Field(() => ProductChangeKind) change!: ProductChangeKind;
  @Field(() => [ProductFieldChangeType]) fields!: ProductFieldChangeType[];
}

@ObjectType('ChangeCounts')
export class ChangeCountsType {
  @Field(() => Int) added!: number;
  @Field(() => Int) removed!: number;
  @Field(() => Int) modified!: number;
  @Field(() => Int) unchanged!: number;
}

@ObjectType('ChangedField')
export class ChangedFieldType {
  @Field() field!: string;
  @Field(() => Int) productCount!: number;
}

@ObjectType('ExportSummary')
export class ExportSummaryType {
  @Field(() => ID) id!: string;
  @Field(() => ID) evaluationId!: string;
  @Field(() => Int) rowCount!: number;
  @Field() createdAt!: string;
}

/** Qué cambiaría en el canal si se publicara la exportación candidata. */
@ObjectType('FeedComparison')
export class FeedComparisonType {
  @Field(() => ExportSummaryType) candidate!: ExportSummaryType;
  @Field(() => ChangeCountsType) counts!: ChangeCountsType;
  @Field(() => [ChangedFieldType]) changedFields!: ChangedFieldType[];
  @Field(() => [ProductChangeType]) changes!: ProductChangeType[];
  @Field(() => PageInfoType) page!: PageInfoType;
}

/** De dónde descarga el feed su CSV y cómo leerlo. */
@ObjectType('FeedSource')
export class FeedSourceType {
  @Field() url!: string;
  @Field() idColumn!: string;
  @Field() delimiter!: string;
}

/** Con qué reglas y límites se publica sin revisión una actualización. */
@ObjectType('FeedPolicy')
export class FeedPolicyType {
  @Field(() => Int) rulesetRevision!: number;
  @Field(() => Int) maxInvalid!: number;
  @Field(() => Int) maxExcluded!: number;
  @Field(() => Int) maxDropPercent!: number;
  @Field() engineVersion!: string;
  @Field() profileVersion!: string;
  @Field() approvedAt!: string;
}

@ObjectType('FeedSchedule')
export class FeedScheduleType {
  @Field() enabled!: boolean;
  /** `HH:MM` en la zona del horario. */
  @Field() refreshTime!: string;
  @Field() timeZone!: string;
}

/** La última actualización del feed, para la portada del feed. */
@ObjectType('FeedLastRefresh')
export class FeedLastRefreshType {
  @Field(() => ID) id!: string;
  @Field() status!: string;
  @Field() stage!: string;
  @Field(() => String, { nullable: true }) outcome!: string | null;
  @Field(() => ApiErrorType, { nullable: true }) error!: ApiErrorType | null;
  @Field(() => String, { nullable: true }) scheduledFor!: string | null;
  @Field() createdAt!: string;
  @Field(() => String, { nullable: true }) finishedAt!: string | null;
}

@ObjectType('Feed')
export class FeedType {
  @Field(() => ID) id!: string;
  @Field(() => Int) generation!: number;
  @Field() deliveryEnabled!: boolean;
  @Field(() => FeedPublishedVersionType, { nullable: true })
  publishedVersion!: FeedPublishedVersionType | null;
  @Field(() => FeedSourceType, { nullable: true })
  source!: FeedSourceType | null;
  @Field(() => FeedPolicyType, { nullable: true })
  policy!: FeedPolicyType | null;
  @Field(() => FeedScheduleType, { nullable: true })
  schedule!: FeedScheduleType | null;
  @Field(() => FeedLastRefreshType, { nullable: true })
  lastRefresh!: FeedLastRefreshType | null;
  @Field() createdAt!: string;
  @Field() updatedAt!: string;
}

@ObjectType('FeedVersionPage')
export class FeedVersionPageType {
  @Field(() => [FeedVersionType]) items!: FeedVersionType[];
  @Field(() => PageInfoType) page!: PageInfoType;
}

/** El feed recién creado y su URL de entrega, que solo se muestra esta vez. */
@ObjectType('CreatedFeed')
export class CreatedFeedType {
  @Field(() => FeedType) feed!: FeedType;
  @Field() deliveryUrl!: string;
}

/** `published` es falso si esa exportación ya era la publicada. */
@ObjectType('FeedPublication')
export class FeedPublicationType {
  @Field(() => FeedType) feed!: FeedType;
  @Field() published!: boolean;
}

/** Una actualización del feed: descargar, importar, evaluar y publicar. */
@ObjectType('FeedRefresh')
export class FeedRefreshType {
  @Field(() => ID) id!: string;
  @Field(() => ID) feedId!: string;
  @Field() status!: string;
  @Field() stage!: string;
  @Field(() => Int) attempts!: number;
  @Field(() => String, { nullable: true }) outcome!: string | null;
  @Field(() => ID, { nullable: true }) snapshotId!: string | null;
  @Field(() => ID, { nullable: true }) evaluationId!: string | null;
  @Field() runAfter!: string;
  @Field(() => ApiErrorType, { nullable: true }) error!: ApiErrorType | null;
  @Field(() => String, { nullable: true }) scheduledFor!: string | null;
  @Field() createdAt!: string;
  @Field(() => String, { nullable: true }) finishedAt!: string | null;
}

@InputType('PublishFeedInput')
export class PublishFeedInput extends PublishFeedDto {
  @Field(() => ID) declare exportId: string;
  /** La `generation` que vio quien publica: si cambió, 409. */
  @Field(() => Int) declare expectedGeneration: number;
}

/** El separador va como texto para dar el mismo error que REST. */
@InputType('FeedSourceInput')
export class FeedSourceInput extends UpdateFeedSourceDto {
  @Field() declare url: string;
  @Field() declare idColumn: string;
  @Field(() => String, { nullable: true, description: '`comma` por defecto.' })
  declare delimiter: ImportDelimiter;
}

@InputType('FeedScheduleInput')
export class FeedScheduleInput extends UpdateFeedScheduleDto {
  @Field() declare enabled: boolean;
  @Field() declare refreshTime: string;
  @Field() declare timeZone: string;
}

@InputType('FeedPolicyInput')
export class FeedPolicyInput extends ApproveFeedPolicyDto {
  @Field(() => Int) declare rulesetRevision: number;
  @Field(() => Int) declare maxInvalid: number;
  @Field(() => Int) declare maxExcluded: number;
  @Field(() => Int) declare maxDropPercent: number;
}

/** Los mismos parámetros que `GET …/feeds/:feedId/comparison`. */
@ArgsType()
export class FeedComparisonArgs extends PaginationArgs {
  @Field(() => ID)
  @IsUUID()
  exportId!: string;

  @Field(() => ProductChangeKind, { nullable: true })
  @IsOptional()
  @IsIn(CHANGE_KINDS)
  change?: ChangeKind;
}
