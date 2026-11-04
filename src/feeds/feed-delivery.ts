import { DELIVERY_TOKEN_PATTERN } from './delivery-token.js';

const DELIVERY_FILE_EXTENSION = '.tsv';

/** Prefijo de una etiqueta débil (`W/"…"`) en `ETag` e `If-None-Match`. */
const WEAK_TAG_PREFIX = 'W/';

/**
 * El token de `<token>.tsv`, o `null` si el nombre no tiene esa forma. Así una
 * URL mal formada responde igual que un token que no existe, sin consultar la
 * base.
 */
export function tokenFromFileName(fileName: string): string | null {
  if (!fileName.endsWith(DELIVERY_FILE_EXTENSION)) {
    return null;
  }
  const token = fileName.slice(0, -DELIVERY_FILE_EXTENSION.length);
  return DELIVERY_TOKEN_PATTERN.test(token) ? token : null;
}

/** Etiqueta fuerte con la suma SHA-256 del TSV: cambia si y solo si cambia el archivo (D8). */
export function entityTagOf(tsvChecksum: string) {
  return `"${tsvChecksum}"`;
}

/**
 * `true` si el cliente ya tiene esta versión: alguna etiqueta de
 * `If-None-Match` coincide con la comparación débil, o es `*` (F23).
 */
export function isNotModified(
  ifNoneMatch: string | undefined,
  entityTag: string,
): boolean {
  if (!ifNoneMatch) {
    return false;
  }
  if (ifNoneMatch.trim() === '*') {
    return true;
  }
  return ifNoneMatch
    .split(',')
    .some((tag) => withoutWeakPrefix(tag.trim()) === entityTag);
}

/** La comparación débil ignora `W/`: dos etiquetas con la misma cadena coinciden. */
function withoutWeakPrefix(tag: string) {
  return tag.startsWith(WEAK_TAG_PREFIX)
    ? tag.slice(WEAK_TAG_PREFIX.length)
    : tag;
}
