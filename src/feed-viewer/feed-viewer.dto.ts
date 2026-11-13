import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../common/http/pagination.js';
import { CHANGE_KINDS, type ChangeKind } from './tsv-comparison.js';

/** Longitud máxima del texto de búsqueda: un título de Google tiene 150. */
export const MAX_SEARCH_LENGTH = 150;

function trim({ value }: { value: unknown }) {
  return typeof value === 'string' ? value.trim() : value;
}

/** `GET …/products?limit=20&offset=0&search=zapatilla`. */
export class ProductPageQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(MAX_SEARCH_LENGTH)
  search?: string;
}

/** Un `id` de Google tiene 50 caracteres como mucho; se deja margen para catálogos que aún no lo cumplen. */
export const MAX_PRODUCT_ID_LENGTH = 200;

/**
 * `GET …/product?id=SKU-42`. El `id` va en la consulta y no en la ruta porque
 * puede llevar barras u otros caracteres; no se recorta: tiene que ser exacto.
 */
export class ProductQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_PRODUCT_ID_LENGTH)
  id!: string;
}

/**
 * `GET …/feeds/:feedId/comparison?exportId=…&change=modified&limit=20`. Sin
 * `change`, la lista trae añadidos, modificados y retirados.
 */
export class ComparisonQueryDto extends PaginationQueryDto {
  @IsUUID()
  exportId!: string;

  @IsOptional()
  @IsIn(CHANGE_KINDS)
  change?: ChangeKind;
}
