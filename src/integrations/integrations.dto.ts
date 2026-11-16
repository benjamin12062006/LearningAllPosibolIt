import { Transform, Type } from 'class-transformer';
import {
  ArrayContains,
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { PAGINATION } from '../common/http/pagination.js';
import type {
  CredentialAudience,
  CredentialCapability,
} from './integrations.types.js';

export class IssueCredentialDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 80)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  label!: string;

  @IsIn(['mcp', 'mcp_oauth', 'cli'])
  audience!: CredentialAudience;

  @IsArray()
  @ArrayContains(['read'])
  @ArrayMaxSize(2)
  @ArrayUnique()
  @IsIn(['read', 'prepare'], { each: true })
  capabilities!: CredentialCapability[];

  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u)
  expiresAt?: string;
}

export class CredentialPageDto {
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGINATION.maxLimit)
  limit?: number;
}

export class IntegrationCallDto {
  @IsUUID()
  callId!: string;

  @IsIn(['execute', 'prepare'])
  mode!: 'execute' | 'prepare';

  @IsObject()
  arguments!: Record<string, unknown>;
}
