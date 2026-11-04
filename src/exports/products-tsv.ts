import {
  hasTabOrLineBreak,
  isBlank,
  PRODUCT_ATTRIBUTES,
  REQUIRED_ATTRIBUTES,
  startsWithQuote,
  type ProductAttribute,
  type ProductValues,
} from '../evaluations/engine/google-merchant.profile.js';

/** Un producto válido de la evaluación, ya normalizado por el motor. */
export type ExportableRow = Readonly<{
  externalId: string;
  values: ProductValues;
}>;

export type ProductsTsv = Readonly<{
  content: Buffer;
  rowCount: number;
}>;

/**
 * IANA registra `text/tab-separated-values` con el juego de caracteres como
 * parámetro (F21 de reviews&exports). Lo usan la descarga privada y la URL
 * pública del feed.
 */
export const PRODUCTS_TSV_TYPE = 'text/tab-separated-values; charset=utf-8';

/** `id` sale de la columna identificadora; el resto, de los atributos del perfil. */
type Column = 'id' | ProductAttribute;

const FIELD_SEPARATOR = '\t';

/** La IANA no fija el fin de línea; se usa el de Unix (D4, propuesta propia). */
const LINE_END = '\n';

const OPTIONAL_ATTRIBUTES = PRODUCT_ATTRIBUTES.filter(
  (attribute) => !REQUIRED_ATTRIBUTES.includes(attribute),
);

const REQUIRED_IN_PROFILE_ORDER = PRODUCT_ATTRIBUTES.filter((attribute) =>
  REQUIRED_ATTRIBUTES.includes(attribute),
);

/**
 * `productos.tsv` para Merchant Center (plan de reviews y exports, D4): una
 * cabecera con los nombres de atributo y una línea por producto, en el orden en
 * que llegan las filas (el de `sourceRow`). UTF-8 sin BOM.
 *
 * Solo admite filas válidas: una fila sin un atributo obligatorio o con un valor
 * que no cabe en un TSV indica un error del backend, no del catálogo, y se lanza
 * un error en lugar de escribir un archivo que Google rechazaría.
 */
export function buildProductsTsv(rows: readonly ExportableRow[]): ProductsTsv {
  if (rows.length === 0) {
    throw new Error('Un TSV de productos necesita al menos un producto.');
  }

  const columns = chooseColumns(rows);
  const lines = [tsvLine(columns)];
  for (const row of rows) {
    lines.push(tsvLine(columns.map((column) => cellOf(row, column))));
  }

  return {
    content: Buffer.from(`${lines.join(LINE_END)}${LINE_END}`, 'utf8'),
    rowCount: rows.length,
  };
}

/**
 * `id`, después los opcionales que tienen algún valor y al final los
 * obligatorios. Como un obligatorio nunca está vacío en una fila válida, ninguna
 * línea termina en tabulador (Google lo prohíbe) y todas tienen el mismo número
 * de campos (lo exige la IANA). Google lee las columnas por el nombre de la
 * cabecera, no por su posición.
 */
function chooseColumns(rows: readonly ExportableRow[]): Column[] {
  const optionalWithValue = OPTIONAL_ATTRIBUTES.filter((attribute) =>
    rows.some((row) => hasValue(row.values[attribute])),
  );
  return ['id', ...optionalWithValue, ...REQUIRED_IN_PROFILE_ORDER];
}

function cellOf(row: ExportableRow, column: Column) {
  if (column === 'id') {
    return row.externalId;
  }

  const value = row.values[column];
  if (hasValue(value)) {
    return value;
  }
  if (REQUIRED_ATTRIBUTES.includes(column)) {
    throw new Error(
      `Falta el atributo obligatorio ${column} en un producto válido.`,
    );
  }
  // Para Google un valor vacío o de solo espacios es lo mismo que una celda
  // vacía. Escribirlo tal cual rompería el TSV si los espacios son tabuladores
  // o saltos de línea, que el perfil no informa porque el valor está vacío.
  return '';
}

/** Para Google, vacío o solo espacios es no tener valor (`isBlank`). */
function hasValue(value: string | undefined): value is string {
  return !isBlank(value);
}

function tsvLine(cells: readonly string[]) {
  for (const cell of cells) {
    assertFitsInTsv(cell);
  }
  return cells.join(FIELD_SEPARATOR);
}

/** El mensaje no incluye el valor: no se copian datos del catálogo en los registros. */
function assertFitsInTsv(cell: string) {
  if (hasTabOrLineBreak(cell) || startsWithQuote(cell)) {
    throw new Error('Un valor no se puede escribir en el TSV sin escaparlo.');
  }
}
