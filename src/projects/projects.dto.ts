import { Transform } from 'class-transformer';
import {
  IsIn,
  IsISO31661Alpha2,
  IsISO4217CurrencyCode,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const uppercase = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class CreateProjectDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @Transform(uppercase)
  @IsISO31661Alpha2()
  country!: string;

  @Transform(uppercase)
  @IsISO4217CurrencyCode()
  currency!: string;

  @IsIn(['google_merchant'])
  channelProfile!: 'google_merchant';
}

export class UpdateProjectDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(uppercase)
  @IsISO31661Alpha2()
  country?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(uppercase)
  @IsISO4217CurrencyCode()
  currency?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(['google_merchant'])
  channelProfile?: 'google_merchant';
}
