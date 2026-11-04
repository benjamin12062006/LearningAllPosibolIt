import {
  IsBoolean,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateBy,
} from 'class-validator';
import { IMPORT_LIMITS } from '../catalog-import/import.types.js';
import { ImportCatalogDto } from '../catalog-import/import.dto.js';
import { parseSourceUrl } from '../remote-source/source-url.js';
import { isValidTimeZone, REFRESH_TIME_PATTERN } from './feed-schedule.js';

/** `generation` es un `INTEGER` de PostgreSQL. */
const MAX_GENERATION = 2_147_483_647;

/**
 * Body de `POST …/feeds/:feedId/publications` (D6): qué exportación publicar y
 * qué generación del feed vio el operador. Si ya no es la vigente, alguien
 * publicó entretanto y la petición se rechaza.
 */
export class PublishFeedDto {
  @IsUUID()
  exportId!: string;

  @IsInt()
  @Min(0)
  @Max(MAX_GENERATION)
  expectedGeneration!: number;
}

/**
 * Body de `PUT …/feeds/:feedId/source` (D9): la URL del CSV y cómo leerlo, con
 * las mismas reglas de columna y separador que una importación subida.
 */
export class UpdateFeedSourceDto extends ImportCatalogDto {
  @IsString()
  @IsSourceUrl()
  url!: string;
}

/**
 * La misma comprobación que hará la descarga: `https:`, sin usuario ni
 * contraseña, con nombre de servidor y como mucho 2.048 caracteres. Que el
 * destino sea público se comprueba al conectar.
 */
function IsSourceUrl(): PropertyDecorator {
  return ValidateBy({
    name: 'isSourceUrl',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' && parseSourceUrl(value) !== null,
    },
  });
}

/**
 * Body de `PUT …/feeds/:feedId/policy` (D11): la revisión de reglas y los
 * límites, todos obligatorios y explícitos (el umbral se acuerda con el piloto;
 * no hay cifras ocultas). Una evaluación tiene como mucho tantas filas como una
 * importación.
 */
export class ApproveFeedPolicyDto {
  @IsInt()
  @Min(1)
  @Max(MAX_GENERATION)
  rulesetRevision!: number;

  @IsInt()
  @Min(0)
  @Max(IMPORT_LIMITS.rows)
  maxInvalid!: number;

  @IsInt()
  @Min(0)
  @Max(IMPORT_LIMITS.rows)
  maxExcluded!: number;

  @IsInt()
  @Min(0)
  @Max(100)
  maxDropPercent!: number;
}

/**
 * Body de `PUT …/feeds/:feedId/schedule` (D10): si la actualización diaria está
 * activa, a qué hora local y en qué zona. Los tres campos son obligatorios: así
 * desactivarla conserva la hora para volver a activarla.
 */
export class UpdateFeedScheduleDto {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  @Matches(REFRESH_TIME_PATTERN)
  refreshTime!: string;

  @IsString()
  @IsTimeZone()
  timeZone!: string;
}

/** La misma comprobación que usará el worker al calcular la hora local. */
function IsTimeZone(): PropertyDecorator {
  return ValidateBy({
    name: 'isTimeZone',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' && isValidTimeZone(value),
    },
  });
}
