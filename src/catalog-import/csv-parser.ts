import { parse, type Parser } from 'csv-parse';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ErrorCodes } from '../common/http/error-codes.js';
import {
  IMPORT_LIMITS,
  ImportFailure,
  type ImportDelimiter,
  type ImportRow,
} from './import.types.js';

type CsvEvent =
  | { kind: 'headers'; headers: string[] }
  | { kind: 'row'; row: ImportRow }
  | { kind: 'complete'; count: number; hash: string; bytes: number };

type ParseOptions = {
  idColumn: string;
  delimiter: ImportDelimiter;
  signal?: AbortSignal;
};

const MAX_HEADER_LENGTH = 128;

/** Errores del sistema de archivos que indican que el artefacto existe pero no se puede leer. */
const UNREADABLE_FILE_CODES = ['EACCES', 'EPERM', 'EIO'];

/**
 * Lee el CSV en streaming y produce, en orden: las cabeceras, cada fila válida
 * y un resumen final (filas, hash y bytes leídos) para comprobar la integridad.
 * Al primer problema lanza un `ImportFailure` con la fila afectada.
 */
export async function* parseCatalogCsv(
  source: AsyncIterable<Buffer>,
  options: ParseOptions,
): AsyncGenerator<CsvEvent> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const hash = createHash('sha256');
  let bytes = 0;

  async function* decodeUtf8() {
    for await (const chunk of source) {
      options.signal?.throwIfAborted();
      bytes += chunk.length;
      if (bytes > IMPORT_LIMITS.fileBytes) {
        throw new ImportFailure(ErrorCodes.IMPORT_FILE_TOO_LARGE);
      }
      hash.update(chunk);
      try {
        yield decoder.decode(chunk, { stream: true });
      } catch {
        throw new ImportFailure(ErrorCodes.CSV_INVALID_ENCODING);
      }
    }
    try {
      yield decoder.decode();
    } catch {
      throw new ImportFailure(ErrorCodes.CSV_INVALID_ENCODING);
    }
  }

  const parser = createRecordParser(options.delimiter);
  const pumping = pipeline(Readable.from(decodeUtf8()), parser);
  // El error real se recoge al leer `parser`; esto evita un rechazo sin manejar.
  void pumping.catch(() => undefined);

  let headers: string[] | undefined;
  let idIndex = -1;
  let count = 0;
  const seenIds = new Set<string>();

  try {
    for await (const record of parser) {
      options.signal?.throwIfAborted();
      const fields = readFields(record);

      if (!headers) {
        assertValidHeaders(fields);
        headers = fields;
        idIndex = findIdColumn(headers, options.idColumn);
        yield { kind: 'headers', headers };
        continue;
      }

      count++;
      assertRowFits(fields, headers, count);
      const externalId = fields[idIndex];
      assertNewExternalId(externalId, seenIds, count, options.idColumn);
      seenIds.add(externalId);
      yield {
        kind: 'row',
        row: toImportRow(headers, fields, count, externalId),
      };
    }

    await pumping;
    if (!headers || count === 0) {
      throw new ImportFailure(ErrorCodes.CSV_EMPTY);
    }
    yield { kind: 'complete', count, hash: hash.digest('hex'), bytes };
  } catch (error) {
    const failedRow = headers ? count + 1 : undefined;
    throw toImportFailure(error, options.signal, failedRow);
  } finally {
    parser.destroy();
    await pumping.catch(() => undefined);
  }
}

/** Todo se lee como texto tal cual: sin convertir tipos ni recortar espacios. */
function createRecordParser(delimiter: ImportDelimiter): Parser {
  return parse({
    bom: true,
    columns: false,
    delimiter: delimiter === 'semicolon' ? ';' : ',',
    cast: false,
    cast_date: false,
    trim: false,
    skip_empty_lines: true,
    relax_column_count: true,
    max_record_size: IMPORT_LIMITS.recordSize,
  });
}

function readFields(record: unknown): string[] {
  if (!isTextRecord(record)) {
    throw new ImportFailure(ErrorCodes.CSV_INVALID);
  }
  return record;
}

/** PostgreSQL no admite el carácter NUL en `text` ni en `jsonb`. */
function isTextRecord(record: unknown): record is string[] {
  return (
    Array.isArray(record) &&
    record.every(
      (value: unknown) => typeof value === 'string' && !value.includes('\0'),
    )
  );
}

function assertValidHeaders(headers: string[]) {
  const hasTooManyColumns = headers.length > IMPORT_LIMITS.columns;
  const hasInvalidName = headers.some(
    (header) => !header.trim() || header.length > MAX_HEADER_LENGTH,
  );
  const hasRepeatedName = new Set(headers).size !== headers.length;

  if (hasTooManyColumns || hasInvalidName || hasRepeatedName) {
    throw new ImportFailure(ErrorCodes.CSV_HEADERS_INVALID);
  }
}

function findIdColumn(headers: string[], idColumn: string) {
  const index = headers.indexOf(idColumn);
  if (index < 0) {
    throw new ImportFailure(ErrorCodes.CSV_COLUMN_MISSING, {
      field: idColumn,
    });
  }
  return index;
}

function assertRowFits(fields: string[], headers: string[], sourceRow: number) {
  if (sourceRow > IMPORT_LIMITS.rows) {
    throw new ImportFailure(ErrorCodes.IMPORT_ROW_LIMIT, { sourceRow });
  }
  if (fields.length !== headers.length) {
    throw new ImportFailure(ErrorCodes.CSV_INVALID, { sourceRow });
  }
}

function assertNewExternalId(
  externalId: string,
  seenIds: Set<string>,
  sourceRow: number,
  idColumn: string,
) {
  if (!externalId.trim()) {
    throw new ImportFailure(ErrorCodes.CSV_ID_MISSING, {
      sourceRow,
      field: idColumn,
    });
  }
  if (seenIds.has(externalId)) {
    throw new ImportFailure(ErrorCodes.CSV_DUPLICATE_ID, {
      sourceRow,
      field: idColumn,
    });
  }
}

function toImportRow(
  headers: string[],
  fields: string[],
  sourceRow: number,
  externalId: string,
): ImportRow {
  return {
    sourceRow,
    externalId,
    originalValues: Object.fromEntries(
      headers.map((header, index) => [header, fields[index]]),
    ),
  };
}

/** Los fallos propios pasan tal cual; el resto se traduce a un error público. */
function toImportFailure(
  error: unknown,
  signal: AbortSignal | undefined,
  failedRow: number | undefined,
): ImportFailure {
  if (error instanceof ImportFailure) {
    return error;
  }
  if (signal?.aborted) {
    return new ImportFailure(ErrorCodes.IMPORT_INTERRUPTED);
  }

  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') {
    return new ImportFailure(ErrorCodes.IMPORT_ARTIFACT_MISSING);
  }
  if (UNREADABLE_FILE_CODES.includes(code ?? '')) {
    return new ImportFailure(ErrorCodes.IMPORT_ARTIFACT_UNAVAILABLE);
  }
  if (failedRow !== undefined) {
    return new ImportFailure(ErrorCodes.CSV_INVALID, { sourceRow: failedRow });
  }
  return new ImportFailure(ErrorCodes.CSV_INVALID, {});
}
