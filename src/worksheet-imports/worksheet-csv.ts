import { parse } from 'csv-parse/sync';
import { createHash } from 'node:crypto';
import { ErrorCodes } from '../common/http/error-codes.js';
import { ApplicationFailure } from '../common/http/public-error.js';
import { IMPORT_LIMITS } from '../catalog-import/import.types.js';
import type { ImportTable } from './worksheet-imports.types.js';

export type CsvDelimiter = 'comma' | 'semicolon';

const MAX_HEADER_LENGTH = 128;

/**
 * Lee el CSV de una hoja (plan imports&exports 01, D2). Mismas reglas que el
 * catálogo: UTF-8 estricto, BOM fuera, todo como texto y sin recortar. A
 * diferencia del catálogo, no exige una columna ID y una fila con otro número
 * de campos es un error con su número de fila. Al primer problema lanza.
 */
export function readWorksheetCsv(
  content: Buffer,
  delimiter: CsvDelimiter,
): ImportTable {
  if (content.length > IMPORT_LIMITS.fileBytes) {
    throw new ApplicationFailure(ErrorCodes.IMPORT_FILE_TOO_LARGE);
  }
  const records = parseRecords(decodeUtf8(content), delimiter);
  const [headers, ...rows] = records;
  if (!headers || rows.length === 0) {
    throw new ApplicationFailure(ErrorCodes.CSV_EMPTY);
  }
  assertValidHeaders(headers);
  if (rows.length > IMPORT_LIMITS.rows) {
    throw new ApplicationFailure(ErrorCodes.IMPORT_ROW_LIMIT, {
      sourceRow: IMPORT_LIMITS.rows + 1,
    });
  }
  return {
    format: 'csv',
    headers,
    rows,
    fileHash: createHash('sha256').update(content).digest('hex'),
    fileBytes: content.length,
  };
}

function decodeUtf8(content: Buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    throw new ApplicationFailure(ErrorCodes.CSV_INVALID_ENCODING);
  }
}

function parseRecords(text: string, delimiter: CsvDelimiter): string[][] {
  let records: unknown;
  try {
    records = parse(text, {
      bom: true,
      columns: false,
      delimiter: delimiter === 'semicolon' ? ';' : ',',
      cast: false,
      cast_date: false,
      trim: false,
      skip_empty_lines: true,
      relax_column_count: false,
      max_record_size: IMPORT_LIMITS.recordSize,
    });
  } catch (error) {
    throw new ApplicationFailure(ErrorCodes.CSV_INVALID, {
      ...failedRowOf(error),
    });
  }
  if (!isTextTable(records)) {
    throw new ApplicationFailure(ErrorCodes.CSV_INVALID);
  }
  return records;
}

/**
 * `csv-parse` cuenta los registros ya leídos, cabecera incluida: el que falla
 * es la fila de datos con ese mismo número.
 */
function failedRowOf(error: unknown): { sourceRow?: number } {
  const records = (error as { records?: unknown }).records;
  return typeof records === 'number' && records >= 1
    ? { sourceRow: records }
    : {};
}

/** PostgreSQL no admite el carácter NUL en `text` ni en `jsonb`. */
function isTextTable(value: unknown): value is string[][] {
  return (
    Array.isArray(value) &&
    value.every(
      (record: unknown) =>
        Array.isArray(record) &&
        record.every(
          (field: unknown) =>
            typeof field === 'string' && !field.includes('\0'),
        ),
    )
  );
}

function assertValidHeaders(headers: readonly string[]) {
  const hasTooManyColumns = headers.length > IMPORT_LIMITS.columns;
  const hasInvalidName = headers.some(
    (header) => !header.trim() || header.length > MAX_HEADER_LENGTH,
  );
  const hasRepeatedName = new Set(headers).size !== headers.length;
  if (hasTooManyColumns || hasInvalidName || hasRepeatedName) {
    throw new ApplicationFailure(ErrorCodes.CSV_HEADERS_INVALID);
  }
}
