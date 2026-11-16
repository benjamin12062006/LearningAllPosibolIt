import {
  isCanonicalValue,
  type CellLiteral,
} from '../worksheets/cell-values.js';
import {
  add,
  divide,
  formatRounded,
  multiply,
  parseDecimal,
  round,
  type RoundingMode,
} from '../worksheets/exact-decimal.js';
import type { WorksheetColumn } from '../worksheets/worksheets.types.js';

export const TRANSFORM_LIMITS = {
  rows: 200,
  cells: 1_000,
  storedBytes: 1_048_576,
  sampleBytes: 60 * 1024,
  sampleCells: 25,
  ttlMs: 15 * 60 * 1000,
} as const;

const RATE_PATTERN = /^-?\d{1,9}(?:\.\d{1,6})?$/;
const ONE = parseDecimal('1');
const ONE_HUNDRED = parseDecimal('100');

export type Transform =
  | Readonly<{ kind: 'trim_text' }>
  | Readonly<{
      kind: 'replace_exact';
      from: CellLiteral | null;
      to: CellLiteral | null;
    }>
  | Readonly<{
      kind: 'map_values';
      pairs: readonly Readonly<{
        from: CellLiteral | null;
        to: CellLiteral | null;
      }>[];
    }>
  | Readonly<{
      kind: 'percentage';
      rate: string;
      scale: number;
      rounding: RoundingMode;
    }>;

type Cell = CellLiteral | null;
type CellTransform = (value: Cell) => Cell;

export function planTransform(
  column: WorksheetColumn,
  transform: Transform,
): CellTransform | null {
  if (column.type === 'calculated') return null;
  switch (transform.kind) {
    case 'trim_text':
      return column.type === 'text'
        ? (value) => (typeof value === 'string' ? value.trim() : value)
        : null;
    case 'replace_exact':
      return replacements(column, [transform]);
    case 'map_values':
      return replacements(column, transform.pairs);
    case 'percentage':
      return column.type === 'decimal' ? percentage(transform) : null;
  }
}

function replacements(
  column: WorksheetColumn,
  pairs: readonly { from: Cell; to: Cell }[],
): CellTransform | null {
  const changes = new Map<Cell, Cell>();
  for (const { from, to } of pairs) {
    const sourceIsValid = from === null || isCanonicalValue(column, from);
    const targetIsValid =
      to === null ? !column.required : isCanonicalValue(column, to);
    if (!sourceIsValid || !targetIsValid || changes.has(from)) return null;
    changes.set(from, to);
  }
  return (value) => {
    const replacement = changes.get(value);
    return replacement === undefined ? value : replacement;
  };
}

function percentage({
  rate,
  scale,
  rounding,
}: Extract<Transform, { kind: 'percentage' }>): CellTransform | null {
  if (!RATE_PATTERN.test(rate)) return null;
  const proportion = divide(parseDecimal(rate), ONE_HUNDRED);
  if (!proportion) return null;
  const factor = add(ONE, proportion);
  return (value) => {
    if (typeof value !== 'string') return value;
    const scaled = multiply(parseDecimal(value), factor);
    return formatRounded(round(scaled, scale, rounding), scale);
  };
}
