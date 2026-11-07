import { ErrorCodes, type ErrorCode } from '../common/http/error-codes.js';
import { IMPORT_LIMITS } from '../catalog-import/import.types.js';
import {
  ADDABLE_COLUMN_TYPES,
  type AddableColumnType,
} from '../changesets/changeset-schema.js';
import { WORKSHEET_LIMITS } from '../worksheets/worksheet-columns.js';
import type { CsvDelimiter } from './worksheet-csv.js';
import type { ImportFormat } from './worksheet-imports.types.js';

/** Una cabecera del archivo va a una columna existente o a una nueva (D3). */
export type ColumnMapping =
  | Readonly<{ header: string; columnId: string }>
  | Readonly<{
      header: string;
      newColumn: Readonly<{
        name: string;
        type: AddableColumnType;
        options?: readonly Readonly<{ label: string }>[];
      }>;
    }>;

export type BooleanLabels = Readonly<{
  true: readonly string[];
  false: readonly string[];
}>;

/**
 * Lo que pide la persona; se guarda tal cual como procedencia. Cada formato
 * lleva solo sus opciones: `delimiter` el CSV, `sheet` y `headerRow` el XLSX.
 */
export type ImportOptions = CsvImportOptions | XlsxImportOptions;

export type CsvImportOptions = CommonOptions &
  Readonly<{ format: 'csv'; delimiter: CsvDelimiter }>;

export type XlsxImportOptions = CommonOptions &
  Readonly<{
    format: 'xlsx';
    /** `null` solo vale para un libro con una hoja (D11). */
    sheet: string | null;
    /** Fila de Excel de las cabeceras; las anteriores no se leen. */
    headerRow: number;
  }>;

type CommonOptions = Readonly<{
  title: string;
  mode: 'append' | 'upsert';
  /** Solo en `upsert`: la columna existente que identifica cada fila (D5). */
  matchColumnId: string | null;
  decimalSeparator: '.' | ',';
  booleanLabels: BooleanLabels;
  columns: readonly ColumnMapping[];
  /** Filas de origen (desde 1) que la persona deja fuera a sabiendas (D6). */
  excludeRows: readonly number[];
}>;

export type OptionsIssue = Readonly<{ field: string; code: ErrorCode }>;

export type ParsedOptions =
  | Readonly<{ ok: true; options: ImportOptions }>
  | Readonly<{ ok: false; issues: readonly OptionsIssue[] }>;

const DEFAULT_BOOLEAN_LABELS: BooleanLabels = {
  true: ['true'],
  false: ['false'],
};
const MAX_LABELS = 10;
const MAX_LABEL_LENGTH = 64;
const MAX_TITLE_LENGTH = 200;
/** Las hojas de Excel tienen como mucho 31 caracteres en el nombre. */
const MAX_SHEET_NAME_LENGTH = 31;
/** Las cabeceras no pueden quedar por debajo del máximo de filas de datos. */
const MAX_HEADER_ROW = 1000;
const DEFAULT_TITLES: Record<ImportFormat, string> = {
  csv: 'Importar CSV',
  xlsx: 'Importar XLSX',
};
/** Opciones que solo tienen sentido en un formato. */
const FORMAT_OPTIONS: Record<ImportFormat, readonly string[]> = {
  csv: ['delimiter'],
  xlsx: ['sheet', 'headerRow'],
};
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Valida el campo `options` del formulario, ya convertido de JSON. Solo la
 * forma: si las cabeceras y las columnas existen lo decide el planificador,
 * que conoce el archivo y la hoja. Una opción de otro formato (`delimiter` en
 * un XLSX, `sheet` en un CSV) es un error y no se ignora. Nunca lanza.
 */
export function parseImportOptions(
  raw: unknown,
  format: ImportFormat,
): ParsedOptions {
  const issues: OptionsIssue[] = [];
  const report = (field: string) =>
    issues.push({ field, code: ErrorCodes.IMPORT_OPTIONS_INVALID });

  if (!isRecord(raw)) {
    return {
      ok: false,
      issues: [{ field: 'options', code: ErrorCodes.IMPORT_OPTIONS_INVALID }],
    };
  }
  const known = [
    'title',
    'mode',
    'matchColumnId',
    'decimalSeparator',
    'booleanLabels',
    'columns',
    'excludeRows',
    ...FORMAT_OPTIONS[format],
  ];
  for (const key of Object.keys(raw)) {
    if (!known.includes(key)) report(key);
  }

  const title = raw.title ?? DEFAULT_TITLES[format];
  if (!isText(title, MAX_TITLE_LENGTH)) report('title');
  const formatOptions =
    format === 'csv'
      ? parseCsvOptions(raw, report)
      : parseXlsxOptions(raw, report);
  const mode = raw.mode;
  if (mode !== 'append' && mode !== 'upsert') report('mode');
  const matchColumnId = raw.matchColumnId ?? null;
  const needsKey = mode === 'upsert';
  const hasValidKey = needsKey ? isUuid(matchColumnId) : matchColumnId === null;
  if (!hasValidKey) report('matchColumnId');
  const decimalSeparator = raw.decimalSeparator ?? '.';
  if (decimalSeparator !== '.' && decimalSeparator !== ',') {
    report('decimalSeparator');
  }
  const booleanLabels = raw.booleanLabels ?? DEFAULT_BOOLEAN_LABELS;
  if (!isBooleanLabels(booleanLabels)) report('booleanLabels');
  const columns = raw.columns;
  if (
    !Array.isArray(columns) ||
    columns.length === 0 ||
    columns.length > IMPORT_LIMITS.columns
  ) {
    report('columns');
  } else {
    columns.forEach((mapping, index) => {
      if (!isColumnMapping(mapping)) report(`columns.${index}`);
    });
  }
  const excludeRows = raw.excludeRows ?? [];
  if (!isRowList(excludeRows)) report('excludeRows');

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  const common: CommonOptions = {
    title: (title as string).trim(),
    mode: mode as ImportOptions['mode'],
    matchColumnId: matchColumnId as string | null,
    decimalSeparator: decimalSeparator as ImportOptions['decimalSeparator'],
    booleanLabels: booleanLabels as BooleanLabels,
    columns: columns as ColumnMapping[],
    excludeRows: excludeRows as number[],
  };
  return { ok: true, options: { ...common, ...formatOptions } };
}

function parseCsvOptions(
  raw: Record<string, unknown>,
  report: (field: string) => void,
) {
  const delimiter = raw.delimiter ?? 'comma';
  if (delimiter !== 'comma' && delimiter !== 'semicolon') report('delimiter');
  return { format: 'csv' as const, delimiter: delimiter as CsvDelimiter };
}

function parseXlsxOptions(
  raw: Record<string, unknown>,
  report: (field: string) => void,
) {
  const sheet = raw.sheet ?? null;
  if (sheet !== null && !isText(sheet, MAX_SHEET_NAME_LENGTH)) report('sheet');
  const headerRow = raw.headerRow ?? 1;
  if (!isHeaderRow(headerRow)) report('headerRow');
  return {
    format: 'xlsx' as const,
    sheet: sheet as string | null,
    headerRow: headerRow as number,
  };
}

/** Fila de Excel de las cabeceras: de 1 a 1.000. */
export function isHeaderRow(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_HEADER_ROW
  );
}

/** Etiquetas no vacías y una misma etiqueta no puede ser verdadera y falsa. */
function isBooleanLabels(value: unknown): value is BooleanLabels {
  if (!isRecord(value) || !hasOnlyKeys(value, ['true', 'false'])) {
    return false;
  }
  const isLabelList = (list: unknown): list is string[] =>
    Array.isArray(list) &&
    list.length >= 1 &&
    list.length <= MAX_LABELS &&
    list.every((label) => isText(label, MAX_LABEL_LENGTH));
  if (!isLabelList(value.true) || !isLabelList(value.false)) {
    return false;
  }
  const falseLabels = new Set(value.false);
  return value.true.every((label) => !falseLabels.has(label));
}

function isColumnMapping(value: unknown): value is ColumnMapping {
  if (!isRecord(value) || !isText(value.header, 128)) {
    return false;
  }
  if ('columnId' in value) {
    return hasOnlyKeys(value, ['header', 'columnId']) && isUuid(value.columnId);
  }
  return (
    hasOnlyKeys(value, ['header', 'newColumn']) && isNewColumn(value.newColumn)
  );
}

function isNewColumn(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['name', 'type', 'options']) &&
    isText(value.name, WORKSHEET_LIMITS.nameLength) &&
    (ADDABLE_COLUMN_TYPES as readonly unknown[]).includes(value.type) &&
    (value.options === undefined ||
      (Array.isArray(value.options) &&
        value.options.every(
          (option) =>
            isRecord(option) &&
            hasOnlyKeys(option, ['label']) &&
            isText(option.label, WORKSHEET_LIMITS.nameLength),
        )))
  );
}

/** Filas de origen distintas, de 1 a 5.000. */
function isRowList(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length <= IMPORT_LIMITS.rows &&
    value.every(
      (row) => Number.isInteger(row) && row >= 1 && row <= IMPORT_LIMITS.rows,
    ) &&
    new Set(value).size === value.length
  );
}

/** Texto con algo más que espacios y de longitud acotada. */
function isText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length >= 1 &&
    value.length <= maxLength
  );
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}
