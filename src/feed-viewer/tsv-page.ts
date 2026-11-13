import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import type { PageInfo, PageRequest } from '../common/http/pagination.js';

/** Un producto tal como está en el TSV: su línea (la cabecera es la 1) y sus celdas. */
export type TsvProduct = Readonly<{
  line: number;
  values: Readonly<Record<string, string>>;
}>;

export type TsvPage = Readonly<{
  columns: readonly string[];
  products: readonly TsvProduct[];
  page: PageInfo;
}>;

export type TsvPageRequest = PageRequest &
  Readonly<{
    /** Texto que buscar en `id` o `title`, sin distinguir mayúsculas. */
    search?: string;
  }>;

/** Un TSV entero en memoria: solo para comparar dos archivos. */
export type TsvTable = Readonly<{
  columns: readonly string[];
  products: readonly TsvProduct[];
}>;

/** Lo que da la búsqueda de un producto: `product` es nulo si no está en el archivo. */
export type TsvProductMatch = Readonly<{
  columns: readonly string[];
  product: TsvProduct | null;
}>;

const FIELD_SEPARATOR = '\t';

/** La columna que identifica un producto en el TSV de Google. */
export const ID_COLUMN = 'id';

/** Columnas en las que busca el visor: las que una persona reconoce de un producto. */
const SEARCHABLE_COLUMNS = [ID_COLUMN, 'title'] as const;

/**
 * Lee una página del TSV de productos línea a línea (plan E6, D1): salta las que
 * quedan antes de la página y deja de leer en cuanto tiene una de más (para
 * saber si hay otra página). Nunca tiene el archivo entero en memoria.
 */
export async function readTsvPage(
  content: Readable,
  request: TsvPageRequest,
): Promise<TsvPage> {
  const matches = matcherFor(request.search);
  const wanted = request.offset + request.limit + 1;
  const found: TsvProduct[] = [];

  const columns = await scanProducts(content, (product) => {
    if (matches(product)) {
      found.push(product);
    }
    return found.length < wanted;
  });

  return {
    columns,
    products: found.slice(request.offset, request.offset + request.limit),
    page: {
      limit: request.limit,
      offset: request.offset,
      hasMore: found.length === wanted,
    },
  };
}

/**
 * Busca un producto por su `id` exacto (plan 02 de cierre, P2) y deja de leer
 * al encontrarlo. El `id` distingue mayúsculas: es el que recibe el canal.
 */
export async function findTsvProduct(
  content: Readable,
  productId: string,
): Promise<TsvProductMatch> {
  let product: TsvProduct | null = null;

  const columns = await scanProducts(content, (candidate) => {
    if (candidate.values[ID_COLUMN] === productId) {
      product = candidate;
    }
    return product === null;
  });

  return { columns, product };
}

/**
 * Lee el TSV entero (plan 02 de cierre, P5). Cabe en memoria porque un catálogo
 * tiene como mucho 5.000 filas (`IMPORT_LIMITS.rows`); el visor no lo usa para
 * paginar.
 */
export async function readAllProducts(content: Readable): Promise<TsvTable> {
  const products: TsvProduct[] = [];
  const columns = await scanProducts(content, (product) => {
    products.push(product);
    return true;
  });
  return { columns, products };
}

/**
 * Recorre los productos del TSV mientras `keepReading` responda `true` y
 * devuelve las columnas de la cabecera.
 *
 * El TSV lo escribe la API (`buildProductsTsv`): sin comillas ni escapes, con
 * `\n` y el mismo número de campos en cada línea. Una línea distinta indica un
 * archivo dañado, no un error del cliente, y se lanza un error.
 */
async function scanProducts(
  content: Readable,
  keepReading: (product: TsvProduct) => boolean,
): Promise<string[]> {
  const lines = createInterface({ input: content, crlfDelay: Infinity });
  let columns: string[] | null = null;
  let lineNumber = 0;
  try {
    for await (const line of lines) {
      lineNumber += 1;
      if (columns === null) {
        columns = line.split(FIELD_SEPARATOR);
        continue;
      }
      if (line === '') {
        continue;
      }
      if (!keepReading(toProduct(columns, line, lineNumber))) {
        break;
      }
    }
  } finally {
    // Salir del bucle no cierra el archivo: se libera el descriptor aquí.
    lines.close();
    content.destroy();
  }
  return columns ?? [];
}

function toProduct(
  columns: readonly string[],
  line: string,
  lineNumber: number,
): TsvProduct {
  const cells = line.split(FIELD_SEPARATOR);
  if (cells.length !== columns.length) {
    throw new Error(
      `La línea ${lineNumber} del TSV no tiene el número de campos de la cabecera.`,
    );
  }
  const values: Record<string, string> = {};
  columns.forEach((column, index) => {
    values[column] = cells[index];
  });
  return { line: lineNumber, values };
}

/** Sin búsqueda, todo coincide. */
function matcherFor(search: string | undefined) {
  if (search === undefined || search === '') {
    return () => true;
  }
  const needle = search.toLowerCase();
  return (product: TsvProduct) =>
    SEARCHABLE_COLUMNS.some((column) =>
      (product.values[column] ?? '').toLowerCase().includes(needle),
    );
}
