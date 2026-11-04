import { Inject, Injectable } from '@nestjs/common';
import { lookup as dnsLookup } from 'node:dns';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { ArtifactStore } from '../artifacts/artifact.store.js';
import {
  IMPORT_LIMITS,
  ImportFailure,
} from '../catalog-import/import.types.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { isPublicAddress } from './public-address.js';
import {
  REMOTE_SOURCE_OPTIONS,
  RemoteSourceFailure,
  type DownloadedSource,
  type RemoteSourceOptions,
} from './remote-source.types.js';
import { literalAddressOf, parseSourceUrl } from './source-url.js';

/** El tiempo límite propio y, si llega, la señal de apagado de quien llama. */
type DownloadSignals = Readonly<{
  timeout: AbortSignal;
  shutdown: AbortSignal | undefined;
  combined: AbortSignal;
}>;

/** Pide el archivo tal cual: sin `Accept-Encoding`, el origen no lo comprime. */
const REQUEST_HEADERS = {
  accept: 'text/csv, text/plain;q=0.9, */*;q=0.1',
  'user-agent': 'estadistica-forms-feed-source',
};

/**
 * Descarga la fuente CSV de un feed (D9) sin dejar que llegue a la red interna
 * (F21): solo URLs permitidas, conexión a direcciones públicas validadas en el
 * mismo momento de conectar, sin redirecciones, con tiempo y tamaño limitados.
 */
@Injectable()
export class RemoteSourceService {
  constructor(
    private readonly store: ArtifactStore,
    @Inject(REMOTE_SOURCE_OPTIONS)
    private readonly options: RemoteSourceOptions,
  ) {}

  /**
   * Descarga `url` a `tmp/` y devuelve el archivo con la forma de una subida.
   * Si falla, lanza `RemoteSourceFailure` y no deja nada en `tmp/`; un aborto
   * por `signal` se propaga tal cual: el trabajo no falló, se interrumpió.
   */
  async download(url: string, signal?: AbortSignal): Promise<DownloadedSource> {
    const target = this.allowedUrl(url);
    const signals = downloadSignals(this.options.timeoutMs, signal);

    try {
      const response = await this.request(target, signals.combined);
      assertDownloadable(response);
      return await this.store.receive(response, signals.combined);
    } catch (error) {
      throw toSourceFailure(error, signals);
    }
  }

  private allowedUrl(raw: string) {
    const url = parseSourceUrl(raw, { allowHttp: this.options.allowHttp });
    if (!url) {
      throw new RemoteSourceFailure(ErrorCodes.SOURCE_URL_NOT_ALLOWED);
    }
    const literal = literalAddressOf(url);
    if (literal && !this.isAllowedAddress(literal)) {
      throw new RemoteSourceFailure(ErrorCodes.SOURCE_URL_NOT_ALLOWED);
    }
    return url;
  }

  /**
   * Una conexión nueva por descarga (`agent: false`): ningún socket de un pool
   * se reutiliza sin pasar por `lookup`. La URL conserva el nombre, así que
   * `Host`, SNI y el certificado usan el nombre (F32).
   */
  private request(url: URL, signal: AbortSignal) {
    const client = url.protocol === 'https:' ? https : http;
    return new Promise<IncomingMessage>((resolve, reject) => {
      const request = client.request(url, {
        agent: false,
        headers: REQUEST_HEADERS,
        lookup: this.lookupPublic,
        signal,
      });
      request.once('response', resolve);
      request.once('error', reject);
      request.end();
    });
  }

  /**
   * La resolución que usa la propia conexión (F33): si alguna dirección del
   * nombre no es pública, no se conecta a ninguna. Responde en la forma que pide
   * la conexión: lista con `all`, o una dirección y su familia sin él.
   */
  private readonly lookupPublic: LookupFunction = (
    hostname,
    options,
    callback,
  ) => {
    dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) {
        callback(error, []);
        return;
      }
      const allowed = addresses.every((entry) =>
        this.isAllowedAddress(entry.address),
      );
      if (!allowed) {
        callback(
          new RemoteSourceFailure(ErrorCodes.SOURCE_URL_NOT_ALLOWED),
          [],
        );
        return;
      }
      if (options.all) {
        callback(null, addresses);
        return;
      }
      callback(null, addresses[0].address, addresses[0].family);
    });
  };

  private isAllowedAddress(address: string) {
    return this.options.allowPrivateNetworks || isPublicAddress(address);
  }
}

function downloadSignals(
  timeoutMs: number,
  shutdown: AbortSignal | undefined,
): DownloadSignals {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = shutdown ? AbortSignal.any([timeout, shutdown]) : timeout;
  return { timeout, shutdown, combined };
}

/**
 * Antes de guardar nada: una redirección no se sigue, otro estado no 2xx es un
 * error del origen y un `Content-Length` excesivo se rechaza sin leer el cuerpo.
 * El cuerpo se descarta para liberar la conexión.
 */
function assertDownloadable(response: IncomingMessage) {
  const status = response.statusCode ?? 0;
  const failure = responseFailure(response, status);
  if (failure) {
    response.destroy();
    throw failure;
  }
}

function responseFailure(response: IncomingMessage, status: number) {
  if (isRedirect(status)) {
    return new RemoteSourceFailure(ErrorCodes.SOURCE_REDIRECT_NOT_ALLOWED);
  }
  if (!isSuccess(status)) {
    return new RemoteSourceFailure(ErrorCodes.SOURCE_HTTP_ERROR, status);
  }
  if (declaredLength(response) > IMPORT_LIMITS.fileBytes) {
    return new RemoteSourceFailure(ErrorCodes.SOURCE_TOO_LARGE);
  }
  return null;
}

/**
 * Traduce cualquier error de la descarga a su código público. El orden importa:
 * el aborto por apagado se respeta antes que nada (con el motivo de la señal,
 * porque lo que llega puede ser un error del socket cortado), y el tiempo
 * agotado se reconoce por su señal, porque el error que llega es un aborto
 * genérico.
 */
function toSourceFailure(error: unknown, signals: DownloadSignals): unknown {
  if (signals.shutdown?.aborted) {
    return signals.shutdown.reason;
  }
  if (error instanceof RemoteSourceFailure) {
    return error;
  }
  if (signals.timeout.aborted) {
    return new RemoteSourceFailure(ErrorCodes.SOURCE_TIMEOUT);
  }
  if (isTooLarge(error)) {
    return new RemoteSourceFailure(ErrorCodes.SOURCE_TOO_LARGE);
  }
  return new RemoteSourceFailure(ErrorCodes.SOURCE_UNREACHABLE);
}

function isRedirect(status: number) {
  return status >= 300 && status < 400;
}

function isSuccess(status: number) {
  return status >= 200 && status < 300;
}

/** `0` si el origen no declara la longitud (envío por partes). */
function declaredLength(response: IncomingMessage) {
  return Number(response.headers['content-length'] ?? 0);
}

/** `ArtifactStore.receive` corta al pasar el límite de una importación. */
function isTooLarge(error: unknown) {
  return (
    error instanceof ImportFailure &&
    error.detail.code === ErrorCodes.IMPORT_FILE_TOO_LARGE
  );
}
