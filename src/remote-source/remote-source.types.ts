import type { StoredUpload } from '../catalog-import/import.types.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { ApplicationFailure } from '../common/http/public-error.js';

/**
 * El CSV descargado, ya en `tmp/`, con la misma forma que una subida: entra por
 * `CatalogImportService.accept` igual que un archivo subido (D9).
 */
export type DownloadedSource = StoredUpload;

/** Códigos con los que puede fallar una descarga (contrato con E4, plan 01). */
export type SourceFailureCode =
  | typeof ErrorCodes.SOURCE_URL_NOT_ALLOWED
  | typeof ErrorCodes.SOURCE_REDIRECT_NOT_ALLOWED
  | typeof ErrorCodes.SOURCE_HTTP_ERROR
  | typeof ErrorCodes.SOURCE_UNREACHABLE
  | typeof ErrorCodes.SOURCE_TIMEOUT
  | typeof ErrorCodes.SOURCE_TOO_LARGE;

/**
 * Fallo público de la descarga. `upstreamStatus` es el estado HTTP del origen
 * cuando el código es `SOURCE_HTTP_ERROR`: el worker lo necesita para decidir si
 * reintenta (5xx y 429) o no (otros 4xx).
 */
export class RemoteSourceFailure extends ApplicationFailure {
  constructor(
    code: SourceFailureCode,
    readonly upstreamStatus?: number,
  ) {
    super(code);
    this.name = 'RemoteSourceFailure';
  }
}

export const REMOTE_SOURCE_OPTIONS = Symbol('REMOTE_SOURCE_OPTIONS');
export type RemoteSourceOptions = {
  /** Tiempo máximo de toda la descarga, cabeceras y cuerpo incluidos. */
  timeoutMs: number;
  /** Solo en pruebas: admitir `http:` contra un servidor local. */
  allowHttp: boolean;
  /** Solo en pruebas: admitir direcciones no públicas (`localhost`). */
  allowPrivateNetworks: boolean;
};
