import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  CATALOG_HEADERS,
  catalogValues,
  mixedCatalog,
} from '../../evaluations/support/snapshot-fixtures.js';

export type SourceHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void;

/** CSV con las columnas de `CATALOG_RULESET`; todos los valores entre comillas. */
export function catalogCsv(rows: Record<string, string>[] = mixedCatalog(6)) {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const lines = [
    CATALOG_HEADERS.map(quote).join(','),
    ...rows.map((row) =>
      CATALOG_HEADERS.map((header) => quote(row[header] ?? '')).join(','),
    ),
  ];
  return `${lines.join('\n')}\n`;
}

/** Un catálogo con un id repetido: la importación falla con `CSV_DUPLICATE_ID`. */
export function duplicatedCatalogCsv() {
  return catalogCsv([catalogValues('SKU-1'), catalogValues('SKU-1')]);
}

/**
 * Servidor HTTP local que hace de origen del CSV. Escucha en `::` (IPv6 e
 * IPv4): `localhost` puede resolver a cualquiera de las dos.
 */
export async function startSourceServer() {
  const state: { handler: SourceHandler; hits: number } = {
    handler: (_request, response) => response.end(catalogCsv()),
    hits: 0,
  };
  const server: Server = createServer((request, response) => {
    state.hits += 1;
    state.handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '::', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://localhost:${port}/catalogo.csv`,
    state,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
