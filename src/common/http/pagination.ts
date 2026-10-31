import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Único origen de los límites de listados; REST y GraphQL los comparten. */
export const PAGINATION = { defaultLimit: 20, maxLimit: 100 } as const;

export type PageRequest = Readonly<{ limit: number; offset: number }>;
export type PageInfo = PageRequest & Readonly<{ hasMore: boolean }>;

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGINATION.maxLimit)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export function resolvePage(query: Partial<PageRequest> = {}): PageRequest {
  return {
    limit: query.limit ?? PAGINATION.defaultLimit,
    offset: query.offset ?? 0,
  };
}

/** Los repositorios piden `limit + 1` filas: así `hasMore` no necesita `COUNT`. */
export function fetchWindow(page: PageRequest): PageRequest {
  return { limit: page.limit + 1, offset: page.offset };
}

export function toPage<T>(
  rows: T[],
  page: PageRequest,
): { items: T[]; page: PageInfo } {
  return {
    items: rows.slice(0, page.limit),
    page: { ...page, hasMore: rows.length > page.limit },
  };
}
