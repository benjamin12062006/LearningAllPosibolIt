import { createHash } from 'node:crypto';
import type { FilterNode, ParsedRowQuery } from './row-query.js';

/**
 * Cursor opaco (R9): qué revisión se lee, con qué consulta y desde qué fila.
 * Una revisión es inmutable, así que el desplazamiento siempre señala las
 * mismas filas (ver «Decisión del cursor» en la ficha 02).
 */
export type RowCursor = Readonly<{
  revisionId: string;
  queryHash: string;
  offset: number;
}>;

/** Una hoja tiene como mucho 5.000 filas; cualquier desplazamiento mayor es falso. */
const MAX_OFFSET = 5000;
const SHA256_HEX = /^[a-f0-9]{64}$/;

export function encodeRowCursor(cursor: RowCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/** `null` si el texto no es un cursor emitido por esta API. */
export function decodeRowCursor(text: string): RowCursor | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  return isRowCursor(decoded) ? decoded : null;
}

/**
 * Huella de lo que decide qué filas salen y en qué orden: filtro, orden y
 * columnas. El tamaño de página no cuenta: se puede cambiar entre páginas.
 */
export function hashRowQuery(query: ParsedRowQuery): string {
  const canonical = {
    filter: query.filter ? canonicalFilter(query.filter) : null,
    sort: query.sort.map(({ column, direction }) => [column.id, direction]),
    columns: query.columnIds,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function canonicalFilter(node: FilterNode): unknown {
  if (node.kind === 'predicate') {
    return [node.column.id, node.op, node.values];
  }
  return [node.kind, node.children.map(canonicalFilter)];
}

function isRowCursor(value: unknown): value is RowCursor {
  if (!isRecord(value)) {
    return false;
  }
  const { revisionId, queryHash, offset } = value;
  return (
    typeof revisionId === 'string' &&
    typeof queryHash === 'string' &&
    SHA256_HEX.test(queryHash) &&
    isValidOffset(offset)
  );
}

function isValidOffset(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_OFFSET
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
