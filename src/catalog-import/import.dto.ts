import { IsIn, IsString, Matches, MaxLength } from 'class-validator';
import type { ImportDelimiter } from './import.types.js';

const DELIMITERS: ImportDelimiter[] = ['comma', 'semicolon'];

export class ImportCatalogDto {
  @IsString()
  @Matches(/\S/) // al menos un carácter que no sea espacio
  @MaxLength(128)
  idColumn!: string;

  @IsIn(DELIMITERS)
  delimiter: ImportDelimiter = 'comma';
}
