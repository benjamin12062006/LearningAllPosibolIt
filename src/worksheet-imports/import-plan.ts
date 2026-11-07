import { randomUUID } from 'node:crypto';
import { ErrorCodes, type ErrorCode } from '../common/http/error-codes.js';
import type {
  Operation,
  RowValues,
} from '../changesets/changeset-operations.js';
import type { AddColumn } from '../changesets/changeset-schema.js';
import {
  isCanonicalValue,
  type CellLiteral,
} from '../worksheets/cell-values.js';
import { normalizeName } from '../worksheets/worksheet-columns.js';
import type { WorksheetColumn } from '../worksheets/worksheets.types.js';
import type { ColumnMapping, ImportOptions } from './import-options.js';
import {
  isTypedCell,
  type ImportField,
  type ImportTable,
  type TypedCell,
} from './worksheet-imports.types.js';

/** Un problema de una fila del archivo, con la cabecera o la columna afectada. */
export type RowProblem = Readonly<{
  sourceRow: number;
  field: string;
  code: ErrorCode;
}>;

export type IncludedRow = Readonly<{
  sourceRow: number;
  rowId: string;
  action: 'insert' | 'update' | 'unchanged';
}>;

export type ExcludedRow = Readonly<{
  sourceRow: number;
  /** Vacío si la persona excluyó una fila sin problemas. */
  codes: readonly ErrorCode[];
}>;

export type ImportReport = Readonly<{
  rows: number;
  inserted: number;
  updated: number;
  unchanged: number;
  excluded: number;
  invalid: number;
  newColumns: number;
  ignoredHeaders: readonly string[];
}>;

export type ImportPlan =
  | Readonly<{
      ok: false;
      code: ErrorCode;
      issues: readonly Readonly<{ field: string; code: ErrorCode }>[];
    }>
  | Readonly<{
      ok: true;
      operations: readonly Operation[];
      report: ImportReport;
      /** Problemas de filas que la persona no excluyó: impiden crear el borrador. */
      problems: readonly RowProblem[];
      included: readonly IncludedRow[];
      excluded: readonly ExcludedRow[];
    }>;

export type PlanContext = Readonly<{
  table: ImportTable;
  /** Esquema de la revisión actual de la hoja. */
  columns: readonly WorksheetColumn[];
  /** Filas vivas de la revisión actual; solo hacen falta en `upsert`. */
  rows: RowValues;
  options: ImportOptions;
  /** Prefijo de orden: las filas nuevas van detrás, en el orden del archivo. */
  sortPrefix: string;
  newId?: () => string;
}>;

/** Una cabecera ya resuelta: su posición en el archivo y su columna destino. */
type Target = Readonly<{
  index: number;
  header: string;
  column: WorksheetColumn;
}>;

/**
 * Convierte el archivo en operaciones de un borrador (plan imports&exports 01,
 * D3–D6): primero resuelve el mapeo, después convierte cada fila y decide si
 * inserta, actualiza o no cambia. Nunca lanza.
 */
export function planImport(context: PlanContext): ImportPlan {
  const newId = context.newId ?? randomUUID;
  const mapping = resolveMapping(context, newId);
  if (!mapping.ok) {
    return mapping;
  }
  const rowsOutOfRange = context.options.excludeRows.filter(
    (row) => row > context.table.rows.length,
  );
  if (rowsOutOfRange.length > 0) {
    return {
      ok: false,
      code: ErrorCodes.IMPORT_OPTIONS_INVALID,
      issues: [
        { field: 'excludeRows', code: ErrorCodes.IMPORT_OPTIONS_INVALID },
      ],
    };
  }

  const builder = new ImportBuilder(context, mapping.targets, newId);
  context.table.rows.forEach((fields, index) =>
    builder.addRow(fields, index + 1),
  );
  return builder.finish(mapping.newColumns, mapping.ignoredHeaders);
}

// ── Mapeo ──

type ResolvedMapping =
  | Readonly<{
      ok: true;
      targets: readonly Target[];
      newColumns: readonly AddColumn[];
      ignoredHeaders: readonly string[];
    }>
  | Extract<ImportPlan, { ok: false }>;

/**
 * Cada cabecera existe y se usa una vez; cada columna, también. Una columna
 * calculada no recibe valores; una nueva no repite nombre. En `upsert`, la
 * clave es una columna existente y mapeada.
 */
function resolveMapping(
  context: PlanContext,
  newId: () => string,
): ResolvedMapping {
  const { table, columns, options } = context;
  const issues: { field: string; code: ErrorCode }[] = [];
  const invalid = (field: string) =>
    issues.push({ field, code: ErrorCodes.IMPORT_MAPPING_INVALID });

  const columnsById = new Map(columns.map((column) => [column.id, column]));
  const takenNames = new Set(columns.map(({ name }) => normalizeName(name)));
  const usedHeaders = new Set<string>();
  const usedColumns = new Set<string>();
  const targets: Target[] = [];
  const newColumns: AddColumn[] = [];

  options.columns.forEach((mapping, position) => {
    const path = `columns.${position}`;
    const index = table.headers.indexOf(mapping.header);
    if (index < 0 || usedHeaders.has(mapping.header)) {
      invalid(`${path}.header`);
      return;
    }
    usedHeaders.add(mapping.header);

    const column = targetColumn(mapping, columnsById, takenNames, newId);
    if (!column || usedColumns.has(column.id)) {
      invalid(isExisting(mapping) ? `${path}.columnId` : `${path}.newColumn`);
      return;
    }
    usedColumns.add(column.id);
    if (!isExisting(mapping)) {
      takenNames.add(normalizeName(column.name));
      newColumns.push(addColumnOf(column));
    }
    targets.push({ index, header: mapping.header, column });
  });

  const keyIsMapped =
    options.matchColumnId === null ||
    (columnsById.has(options.matchColumnId) &&
      usedColumns.has(options.matchColumnId));
  if (!keyIsMapped) {
    invalid('matchColumnId');
  }
  if (issues.length > 0) {
    return { ok: false, code: ErrorCodes.IMPORT_MAPPING_INVALID, issues };
  }
  return {
    ok: true,
    targets,
    newColumns,
    ignoredHeaders: table.headers.filter((header) => !usedHeaders.has(header)),
  };
}

function isExisting(
  mapping: ColumnMapping,
): mapping is Extract<ColumnMapping, { columnId: string }> {
  return 'columnId' in mapping;
}

/** La columna destino, o `null` si no se puede usar. */
function targetColumn(
  mapping: ColumnMapping,
  columnsById: ReadonlyMap<string, WorksheetColumn>,
  takenNames: ReadonlySet<string>,
  newId: () => string,
): WorksheetColumn | null {
  if (isExisting(mapping)) {
    const column = columnsById.get(mapping.columnId);
    return column && column.type !== 'calculated' ? column : null;
  }
  const { name, type, options } = mapping.newColumn;
  const labels = (options ?? []).map(({ label }) => normalizeName(label));
  const hasValidOptions =
    type === 'selection'
      ? labels.length >= 1 && new Set(labels).size === labels.length
      : options === undefined;
  if (takenNames.has(normalizeName(name)) || !hasValidOptions) {
    return null;
  }
  return {
    id: newId(),
    name: name.trim(),
    type,
    position: columnsById.size,
    required: false,
    ...(options
      ? { options: options.map(({ label }) => ({ id: newId(), label })) }
      : {}),
  };
}

function addColumnOf(column: WorksheetColumn): AddColumn {
  return {
    type: 'add_column',
    columnId: column.id,
    name: column.name,
    columnType: column.type as AddColumn['columnType'],
    ...(column.options ? { options: column.options } : {}),
  };
}

// ── Filas ──

/** Con qué fila de la hoja se corresponde una del archivo. */
type RowMatch =
  | Readonly<{ kind: 'new' }>
  | Readonly<{ kind: 'existing'; rowId: string }>
  | Readonly<{ kind: 'invalid' }>;

/** Resultado de convertir un campo del archivo al valor de su columna. */
type Converted =
  | Readonly<{ kind: 'empty' }>
  | Readonly<{ kind: 'value'; value: CellLiteral }>
  /** Sin `code`, el valor no tiene la forma de la columna (`CELL_VALUE_INVALID`). */
  | Readonly<{ kind: 'invalid'; code?: ErrorCode }>;

/**
 * Acumula, fila a fila, operaciones, inclusiones, exclusiones y problemas. Un
 * objeto porque la decisión de cada fila depende de las claves anteriores.
 */
class ImportBuilder {
  private readonly operations: Operation[] = [];
  private readonly included: IncludedRow[] = [];
  private readonly excluded: ExcludedRow[] = [];
  private readonly problems: RowProblem[] = [];
  private readonly counts = {
    inserted: 0,
    updated: 0,
    unchanged: 0,
    invalid: 0,
  };
  private readonly excludedRows: ReadonlySet<number>;
  private readonly keyTarget: Target | null;
  /** Clave → filas de la hoja con ese valor (`upsert`). */
  private readonly sheetKeys = new Map<string, string[]>();
  /** Clave → número de veces que aparece en el archivo. */
  private readonly fileKeys = new Map<string, number>();

  constructor(
    private readonly context: PlanContext,
    private readonly targets: readonly Target[],
    private readonly newId: () => string,
  ) {
    this.excludedRows = new Set(context.options.excludeRows);
    const keyId = context.options.matchColumnId;
    this.keyTarget = targets.find(({ column }) => column.id === keyId) ?? null;
    if (this.keyTarget) {
      this.indexSheetKeys(this.keyTarget.column.id);
      this.countFileKeys(this.keyTarget);
    }
  }

  addRow(fields: readonly ImportField[], sourceRow: number) {
    const values = new Map<string, CellLiteral>();
    const problems: RowProblem[] = [];
    for (const target of this.targets) {
      const converted = convert(
        target.column,
        fields[target.index],
        this.context.options,
      );
      if (converted.kind === 'invalid') {
        problems.push({
          sourceRow,
          field: target.header,
          code: converted.code ?? ErrorCodes.CELL_VALUE_INVALID,
        });
      } else if (converted.kind === 'value') {
        values.set(target.column.id, converted.value);
      }
    }

    const match = this.matchOf(values, sourceRow, problems);
    if (match.kind === 'new') {
      problems.push(...this.missingRequired(values, sourceRow));
    }

    if (this.excludedRows.has(sourceRow)) {
      this.excluded.push({
        sourceRow,
        codes: [...new Set(problems.map(({ code }) => code))],
      });
      return;
    }
    if (problems.length > 0) {
      this.counts.invalid += 1;
      this.problems.push(...problems);
      return;
    }
    if (match.kind === 'existing') {
      this.update(match.rowId, values, sourceRow);
    } else {
      this.insert(values, sourceRow);
    }
  }

  finish(
    newColumns: readonly AddColumn[],
    ignoredHeaders: readonly string[],
  ): ImportPlan {
    return {
      ok: true,
      operations: [...newColumns, ...this.operations],
      report: {
        rows: this.context.table.rows.length,
        ...this.counts,
        excluded: this.excluded.length,
        newColumns: newColumns.length,
        ignoredHeaders,
      },
      problems: this.problems,
      included: this.included,
      excluded: this.excluded,
    };
  }

  /**
   * En `upsert`, la fila de la hoja con la misma clave, o una fila nueva (como
   * siempre en `append`). Una clave vacía, repetida o ambigua es un problema y
   * la fila no se compara con nada más.
   */
  private matchOf(
    values: ReadonlyMap<string, CellLiteral>,
    sourceRow: number,
    problems: RowProblem[],
  ): RowMatch {
    if (!this.keyTarget) {
      return { kind: 'new' };
    }
    const field = this.keyTarget.header;
    const key = values.get(this.keyTarget.column.id);
    if (key === undefined) {
      if (!problems.some((problem) => problem.field === field)) {
        problems.push({
          sourceRow,
          field,
          code: ErrorCodes.IMPORT_KEY_MISSING,
        });
      }
      return { kind: 'invalid' };
    }
    const keyText = String(key);
    if ((this.fileKeys.get(keyText) ?? 0) > 1) {
      problems.push({
        sourceRow,
        field,
        code: ErrorCodes.IMPORT_KEY_DUPLICATE,
      });
      return { kind: 'invalid' };
    }
    const matches = this.sheetKeys.get(keyText) ?? [];
    if (matches.length > 1) {
      problems.push({
        sourceRow,
        field,
        code: ErrorCodes.IMPORT_KEY_AMBIGUOUS,
      });
      return { kind: 'invalid' };
    }
    return matches.length === 1
      ? { kind: 'existing', rowId: matches[0] }
      : { kind: 'new' };
  }

  /** Una fila nueva necesita valor en cada columna obligatoria. */
  private missingRequired(
    values: ReadonlyMap<string, CellLiteral>,
    sourceRow: number,
  ): RowProblem[] {
    return this.context.columns
      .filter((column) => column.required && !values.has(column.id))
      .map((column) => ({
        sourceRow,
        field: this.headerOf(column.id) ?? column.name,
        code: ErrorCodes.CELL_REQUIRED,
      }));
  }

  private insert(values: ReadonlyMap<string, CellLiteral>, sourceRow: number) {
    const rowId = this.newId();
    this.operations.push({
      type: 'insert_row',
      rowId,
      sortKey: `${this.context.sortPrefix}#${String(sourceRow).padStart(5, '0')}`,
      values: Object.fromEntries(values),
    });
    this.included.push({ sourceRow, rowId, action: 'insert' });
    this.counts.inserted += 1;
  }

  /** Solo las celdas que cambian; un campo vacío no toca la celda (D4). */
  private update(
    rowId: string,
    values: ReadonlyMap<string, CellLiteral>,
    sourceRow: number,
  ) {
    const current = this.context.rows.get(rowId) ?? {};
    const changes = [...values].filter(
      ([columnId, value]) => current[columnId] !== value,
    );
    for (const [columnId, value] of changes) {
      this.operations.push({ type: 'set_cell', rowId, columnId, value });
    }
    const action = changes.length > 0 ? 'update' : 'unchanged';
    this.included.push({ sourceRow, rowId, action });
    this.counts[action === 'update' ? 'updated' : 'unchanged'] += 1;
  }

  private headerOf(columnId: string) {
    return this.targets.find(({ column }) => column.id === columnId)?.header;
  }

  private indexSheetKeys(columnId: string) {
    for (const [rowId, values] of this.context.rows) {
      const value = values[columnId];
      if (typeof value === 'string' || typeof value === 'boolean') {
        const key = String(value);
        this.sheetKeys.set(key, [...(this.sheetKeys.get(key) ?? []), rowId]);
      }
    }
  }

  /** Se cuentan ya convertidas: es el valor que se compara con la hoja. */
  private countFileKeys(target: Target) {
    for (const fields of this.context.table.rows) {
      const converted = convert(
        target.column,
        fields[target.index],
        this.context.options,
      );
      if (converted.kind === 'value') {
        const key = String(converted.value);
        this.fileKeys.set(key, (this.fileKeys.get(key) ?? 0) + 1);
      }
    }
  }
}

/**
 * Campo del archivo → valor canónico de la columna (D4, D13). Nada se
 * redondea ni se recorta: lo que no tiene la forma exacta es inválido. Un
 * campo ausente (una celda de XLSX que no existe) es vacío.
 */
export function convert(
  column: WorksheetColumn,
  field: ImportField | undefined,
  options: Pick<ImportOptions, 'decimalSeparator' | 'booleanLabels'>,
): Converted {
  if (field === undefined || field === '') {
    return { kind: 'empty' };
  }
  if (isTypedCell(field)) {
    return convertTyped(column, field);
  }
  return canonicalOrInvalid(column, candidateValue(column, field, options));
}

/** Un error de fórmula no es un vacío: la fila tiene un problema con su código. */
function convertTyped(column: WorksheetColumn, cell: TypedCell): Converted {
  if (cell.kind === 'error') {
    return { kind: 'invalid', code: ErrorCodes.XLSX_CELL_ERROR };
  }
  if (cell.kind === 'uncalculated') {
    return { kind: 'invalid', code: ErrorCodes.XLSX_FORMULA_NOT_CALCULATED };
  }
  return canonicalOrInvalid(column, typedCandidate(column, cell));
}

function canonicalOrInvalid(
  column: WorksheetColumn,
  candidate: CellLiteral | null,
): Converted {
  return candidate !== null && isCanonicalValue(column, candidate)
    ? { kind: 'value', value: candidate }
    : { kind: 'invalid' };
}

function candidateValue(
  column: WorksheetColumn,
  raw: string,
  options: Pick<ImportOptions, 'decimalSeparator' | 'booleanLabels'>,
): CellLiteral | null {
  switch (column.type) {
    case 'decimal':
      return decimalOf(raw, options.decimalSeparator);
    case 'boolean':
      return booleanOf(raw, options.booleanLabels);
    case 'selection':
      return column.options?.find(({ label }) => label === raw)?.id ?? null;
    default:
      return raw;
  }
}

/**
 * Una celda con tipo solo entra en una columna de su tipo, o en una de texto
 * con el texto que se ve. Un número no se convierte en fecha ni al revés: en
 * XLSX, una fecha es un número con estilo de fecha, y ese estilo ya se leyó.
 */
function typedCandidate(
  column: WorksheetColumn,
  cell: TypedCell,
): CellLiteral | null {
  switch (column.type) {
    case 'text':
      return cell.text;
    case 'integer':
    case 'decimal':
      return cell.kind === 'number' ? cell.text : null;
    case 'date':
      return cell.kind === 'date' ? cell.text : null;
    case 'boolean':
      return cell.kind === 'boolean' ? cell.text === 'true' : null;
    case 'selection':
      return (
        column.options?.find(({ label }) => label === cell.text)?.id ?? null
      );
    default:
      return null;
  }
}

/** Con coma decimal, «1,50» es «1.50»; un punto en ese modo es un error. */
function decimalOf(raw: string, separator: '.' | ','): string | null {
  if (separator === '.') {
    return raw;
  }
  return raw.includes('.') ? null : raw.replace(',', '.');
}

function booleanOf(
  raw: string,
  labels: ImportOptions['booleanLabels'],
): boolean | null {
  if (labels.true.includes(raw)) {
    return true;
  }
  if (labels.false.includes(raw)) {
    return false;
  }
  return null;
}
