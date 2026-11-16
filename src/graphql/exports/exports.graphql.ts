import {
  ArgsType,
  Field,
  ID,
  InputType,
  Int,
  ObjectType,
} from '@nestjs/graphql';
import { CreateExportDto } from '../../exports/exports.dto.js';
import {
  ProductPageQueryDto,
  ProductQueryDto,
} from '../../feed-viewer/feed-viewer.dto.js';
import { JsonScalar } from '../common/json.scalar.js';
import { PageInfoType } from '../common/page-info.type.js';
import { FeedVersionType } from '../feeds/feeds.graphql.js';

@ObjectType('Export')
export class ExportType {
  @Field(() => ID) id!: string;
  @Field(() => ID) evaluationId!: string;
  @Field(() => Int) acceptedInvalidCount!: number;
  @Field(() => Int) acceptedExcludedCount!: number;
  @Field(() => Int) rowCount!: number;
  @Field(() => Int) byteSize!: number;
  @Field() tsvChecksum!: string;
  @Field() createdAt!: string;
}

/** Una línea del TSV: `values` son sus columnas, `{ id, title, … }`. */
@ObjectType('TsvProduct')
export class TsvProductType {
  @Field(() => Int) line!: number;
  @Field(() => JsonScalar) values!: Record<string, string>;
}

/** Una página del TSV y cuántos productos tiene el archivo entero. */
@ObjectType('ProductPage')
export class ProductPageType {
  @Field(() => [String]) columns!: string[];
  @Field(() => [TsvProductType]) products!: TsvProductType[];
  @Field(() => PageInfoType) page!: PageInfoType;
  @Field(() => Int) rowCount!: number;
}

/**
 * De qué archivo sale un producto: `kind` es `export` (con `export`) o
 * `feed_version` (con `feedId` y `version`).
 */
@ObjectType('ProductSource')
export class ProductSourceType {
  @Field() kind!: string;
  @Field(() => ExportType, { nullable: true }) export?: ExportType;
  @Field(() => ID, { nullable: true }) feedId?: string;
  @Field(() => FeedVersionType, { nullable: true }) version?: FeedVersionType;
}

@ObjectType('ProductDetail')
export class ProductDetailType {
  @Field(() => [String]) columns!: string[];
  @Field(() => TsvProductType) product!: TsvProductType;
  @Field(() => ProductSourceType) source!: ProductSourceType;
}

/** El resultado de aprobar: `created` es falso si la evaluación ya tenía una. */
@ObjectType('ExportApproval')
export class ExportApprovalType {
  @Field(() => ExportType) export!: ExportType;
  @Field() downloadUrl!: string;
  @Field() created!: boolean;
}

/** Lo que el operador vio al revisar la evaluación (D2 de exportaciones). */
@InputType('ApproveExportInput')
export class ApproveExportInput extends CreateExportDto {
  @Field(() => ID) declare evaluationId: string;
  @Field() declare resultChecksum: string;
  @Field(() => Int) declare acceptedInvalidCount: number;
  @Field(() => Int) declare acceptedExcludedCount: number;
}

/** Los mismos parámetros que `…/products?limit=&offset=&search=`. */
@ArgsType()
export class ProductPageArgs extends ProductPageQueryDto {
  @Field(() => Int, { nullable: true }) declare limit?: number;
  @Field(() => Int, { nullable: true }) declare offset?: number;
  @Field(() => String, { nullable: true }) declare search?: string;
}

/** `…/product?id=`: el `id` exacto del producto en el TSV. */
@ArgsType()
export class ProductArgs extends ProductQueryDto {
  @Field() declare id: string;
}
