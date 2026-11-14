import {
  ArgsType,
  Field,
  ID,
  Int,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import {
  CHANGE_KINDS,
  type ChangeKind,
} from '../../feed-viewer/tsv-comparison.js';
import { PaginationArgs } from '../common/pagination.args.js';

export enum ProductChangeKind {
  added = 'added',
  removed = 'removed',
  modified = 'modified',
}
registerEnumType(ProductChangeKind, { name: 'ProductChangeKind' });

@ObjectType('PageInfo')
export class PageInfoType {
  @Field(() => Int) limit!: number;
  @Field(() => Int) offset!: number;
  @Field() hasMore!: boolean;
}

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

@ObjectType('Feed')
export class FeedType {
  @Field(() => ID) id!: string;
  @Field(() => Int) generation!: number;
  @Field() deliveryEnabled!: boolean;
  @Field(() => FeedPublishedVersionType, { nullable: true })
  publishedVersion!: FeedPublishedVersionType | null;
  @Field() createdAt!: string;
  @Field() updatedAt!: string;
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
