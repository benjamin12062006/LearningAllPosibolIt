import { Transform } from 'class-transformer';
import { IsNotEmpty, IsObject, IsString, MaxLength } from 'class-validator';
import { WORKSHEET_LIMITS } from '../worksheets/worksheet-columns.js';

function trim({ value }: { value: unknown }) {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * `POST …/worksheets/:id/import-mappings`. La forma de `mapping` la valida
 * `parseMappingTemplate`, con las mismas reglas que las opciones de una
 * importación.
 */
export class CreateImportMappingDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(WORKSHEET_LIMITS.nameLength)
  name!: string;

  @IsObject()
  mapping!: Record<string, unknown>;
}
