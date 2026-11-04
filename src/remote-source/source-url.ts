import { isIP } from 'node:net';

/** Longitud máxima de la URL de una fuente (D9). */
export const SOURCE_URL_MAX_LENGTH = 2048;

type SourceUrlOptions = { allowHttp: boolean };

/**
 * La URL si se puede usar como fuente, o `null`: solo `https:` (o `http:` en
 * pruebas), sin usuario ni contraseña y con nombre de servidor. Si las
 * direcciones del servidor son públicas se comprueba al conectar, no aquí: el
 * DNS puede cambiar entre configurar y descargar.
 */
export function parseSourceUrl(
  raw: string,
  options: SourceUrlOptions = { allowHttp: false },
): URL | null {
  if (raw.length > SOURCE_URL_MAX_LENGTH || !URL.canParse(raw)) {
    return null;
  }
  const url = new URL(raw);
  if (!isAllowedProtocol(url, options)) {
    return null;
  }
  if (url.username || url.password || !url.hostname) {
    return null;
  }
  return url;
}

/**
 * La IP escrita directamente en la URL (`https://10.0.0.1/…`, `https://[::1]/…`),
 * o `null` si es un nombre. Estas no pasan por la resolución de nombres, así
 * que se validan aparte (ficha 07, F33).
 */
export function literalAddressOf(url: URL): string | null {
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  return isIP(host) ? host : null;
}

function isAllowedProtocol(url: URL, options: SourceUrlOptions) {
  return (
    url.protocol === 'https:' || (options.allowHttp && url.protocol === 'http:')
  );
}
