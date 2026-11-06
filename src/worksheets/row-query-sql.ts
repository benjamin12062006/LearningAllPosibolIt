import { Prisma } from '../generated/prisma/client.js';
import { SQL_PATTERNS, type CellLiteral } from './cell-values.js';
import type {
  FilterNode,
  FilterPredicate,
  QueryColumn,
  SortTerm,
} from './row-query.js';

/**
 * Traduce la consulta ya validada a SQL (R6, R7). Todo valor del cliente,
 * incluido el ID de columna que se usa como clave del JSON, va como parámetro
 * (C18). Los fragmentos se refieren a `worksheet_row_versions r`.
 */
export function whereSql(filter: FilterNode | null): Prisma.Sql {
  if (!filter) {
    return Prisma.sql`TRUE`;
  }
  if (filter.kind === 'predicate') {
    return predicateSql(filter);
  }
  const separator = filter.kind === 'and' ? ' AND ' : ' OR ';
  const children = filter.children.map(whereSql);
  return Prisma.sql`(${Prisma.join(children, separator)})`;
}

/**
 * Orden pedido con los nulos siempre al final y, después, el orden de la hoja
 * y el ID de fila: con un desempate único el orden queda determinado (F42).
 */
export function orderSql(sort: readonly SortTerm[]): Prisma.Sql {
  const requested = sort.map(
    (term) =>
      Prisma.sql`${cellSql(term.column)} ${DIRECTIONS[term.direction]} NULLS LAST`,
  );
  return Prisma.join([
    ...requested,
    Prisma.sql`r.sort_key`,
    Prisma.sql`r.row_id`,
  ]);
}

const DIRECTIONS = {
  asc: Prisma.raw('ASC'),
  desc: Prisma.raw('DESC'),
} as const;

function predicateSql(predicate: FilterPredicate): Prisma.Sql {
  const cell = cellSql(predicate.column);
  const [value] = predicate.values;

  switch (predicate.op) {
    case 'is_null':
      return Prisma.sql`${cell} IS NULL`;
    case 'in': {
      const values = predicate.values.map((item) =>
        literalSql(predicate.column, item),
      );
      return Prisma.sql`${cell} IN (${Prisma.join(values)})`;
    }
    case 'contains':
      // `strpos` busca la subcadena tal cual: `%` y `_` no son comodines (F41).
      return Prisma.sql`strpos(lower(${cell}), lower(${value})) > 0`;
    default:
      return Prisma.sql`${cell} ${COMPARISONS[predicate.op]} ${literalSql(predicate.column, value)}`;
  }
}

/**
 * Null solo coincide con `is_null` ([12]). En SQL ya ocurre así: `null = x`,
 * `null <> x` o `null < x` no son verdaderos, así que esas filas no salen.
 */
const COMPARISONS = {
  equals: Prisma.raw('='),
  not_equals: Prisma.raw('<>'),
  lt: Prisma.raw('<'),
  lte: Prisma.raw('<='),
  gt: Prisma.raw('>'),
  gte: Prisma.raw('>='),
} as const;

/**
 * Valor de la celda con el tipo de la columna. Un dato guardado sin la forma
 * canónica se lee como null en lugar de hacer fallar la conversión (R7).
 */
function cellSql(column: QueryColumn): Prisma.Sql {
  const asText = Prisma.sql`(r.cell_values ->> ${column.id})`;

  switch (column.type) {
    case 'text':
    case 'selection':
      return asText;
    case 'integer':
    case 'decimal':
      return Prisma.sql`(CASE WHEN ${asText} ~ ${SQL_PATTERNS.decimal} THEN ${asText}::numeric END)`;
    case 'date':
      // `YYYY-MM-DD` ordena igual como texto que como fecha.
      return Prisma.sql`(CASE WHEN ${asText} ~ ${SQL_PATTERNS.date} THEN ${asText} END)`;
    case 'boolean':
      return Prisma.sql`(CASE WHEN jsonb_typeof(r.cell_values -> ${column.id}) = 'boolean' THEN (r.cell_values -> ${column.id})::boolean END)`;
    case 'calculated':
      // El analizador no deja filtrar ni ordenar por una calculada (V8).
      return Prisma.sql`NULL`;
  }
}

/** El analizador ya comprobó la forma canónica: las conversiones no fallan. */
function literalSql(column: QueryColumn, value: CellLiteral): Prisma.Sql {
  switch (column.type) {
    case 'integer':
    case 'decimal':
      return Prisma.sql`${value}::numeric`;
    case 'boolean':
      return Prisma.sql`${value}::boolean`;
    default:
      return Prisma.sql`${value}::text`;
  }
}
