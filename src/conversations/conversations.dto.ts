import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PAGINATION } from '../common/http/pagination.js';

const MAX_TITLE_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 16_000;
/** Límite compartido con el decodificador para validar antes de convertir el cursor. */
export const MAX_CONVERSATION_CURSOR_LENGTH = 512;

// Reproduce el conteo de PostgreSQL incluso si el texto contiene selectores de variación.
const SINGLE_LINE_TEXT = new RegExp(
  `^[^\\p{Cc}\\p{Cs}]{1,${MAX_TITLE_LENGTH}}$`,
  'u',
);
const MESSAGE_TEXT = new RegExp(
  `^(?:[^\\p{Cc}\\p{Cs}]|[\\t\\n]){1,${MAX_MESSAGE_LENGTH}}$`,
  'u',
);

export class CreateConversationDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TITLE_LENGTH)
  @Matches(SINGLE_LINE_TEXT)
  title!: string;
}

export class AppendConversationMessageDto {
  @Transform(lowercase)
  @IsUUID()
  clientMessageId!: string;

  @Transform(normalizeMessage)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_MESSAGE_LENGTH)
  @Matches(MESSAGE_TEXT)
  content!: string;
}

export class ConversationMessagesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGINATION.maxLimit)
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;
}

export class ConversationListQueryDto extends ConversationMessagesQueryDto {
  @IsOptional()
  @IsUUID()
  workbookId?: string;

  @IsOptional()
  @IsUUID()
  worksheetId?: string;
}

function trim({ value }: { value: unknown }) {
  return typeof value === 'string' ? value.trim() : value;
}

function lowercase({ value }: { value: unknown }) {
  return typeof value === 'string' ? value.toLowerCase() : value;
}

function normalizeMessage({ value }: { value: unknown }) {
  return typeof value === 'string'
    ? value.replace(/\r\n?/g, '\n').trim()
    : value;
}
