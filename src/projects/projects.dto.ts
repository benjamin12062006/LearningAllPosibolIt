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
import type { ChannelProfile } from './projects.types.js';

const CHANNEL_PROFILES: ChannelProfile[] = ['google_merchant'];

function trim({ value }: { value: unknown }) {
  return typeof value === 'string' ? value.trim() : value;
}

function trimAndUppercase({ value }: { value: unknown }) {
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}

/** En una actualización parcial, solo se valida lo que el cliente envía. */
function whenPresent(_object: object, value: unknown) {
  return value !== undefined;
}

export class CreateProjectDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @Transform(trimAndUppercase)
  @IsISO31661Alpha2()
  country!: string;

  @Transform(trimAndUppercase)
  @IsISO4217CurrencyCode()
  currency!: string;

  @IsIn(CHANNEL_PROFILES)
  channelProfile!: ChannelProfile;
}

export class UpdateProjectDto {
  @ValidateIf(whenPresent)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @ValidateIf(whenPresent)
  @Transform(trimAndUppercase)
  @IsISO31661Alpha2()
  country?: string;

  @ValidateIf(whenPresent)
  @Transform(trimAndUppercase)
  @IsISO4217CurrencyCode()
  currency?: string;

  @ValidateIf(whenPresent)
  @IsIn(CHANNEL_PROFILES)
  channelProfile?: ChannelProfile;
}
