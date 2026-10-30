import { IsIn, IsString, Matches, MaxLength } from 'class-validator';

export class ImportCatalogDto {
  @IsString()
  @Matches(/\S/)
  @MaxLength(128)
  idColumn!: string;

  @IsIn(['comma', 'semicolon'])
  delimiter: 'comma' | 'semicolon' = 'comma';
}
