import { IsInt, IsString, IsUUID, Matches, Max, Min } from 'class-validator';
import { IMPORT_LIMITS } from '../catalog-import/import.types.js';

/** SHA-256 en hexadecimal, como lo guarda `result_checksum`. */
const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;

/**
 * Body de `POST /projects/:projectId/exports` (D2): la evaluación y lo que el
 * operador vio al revisarla. Los cuatro campos son obligatorios, también con
 * conteos 0: confirmar las exclusiones es explícito.
 */
export class CreateExportDto {
  @IsUUID()
  evaluationId!: string;

  @IsString()
  @Matches(CHECKSUM_PATTERN)
  resultChecksum!: string;

  /** Una evaluación tiene como mucho tantas filas como una importación. */
  @IsInt()
  @Min(0)
  @Max(IMPORT_LIMITS.rows)
  acceptedInvalidCount!: number;

  @IsInt()
  @Min(0)
  @Max(IMPORT_LIMITS.rows)
  acceptedExcludedCount!: number;
}
