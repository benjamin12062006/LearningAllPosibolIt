import { ErrorCodes } from '../common/http/error-codes.js';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parse } from 'csv-parse';
import {
  IMPORT_LIMITS,
  ImportFailure,
  type ImportRow,
} from './import.types.js';

type CsvEvent =
  | { kind: 'headers'; headers: string[] }
  | { kind: 'row'; row: ImportRow }
  | { kind: 'complete'; count: number; hash: string; bytes: number };

export async function* parseCatalogCsv(
  source: AsyncIterable<Buffer>,
  options: {
    idColumn: string;
    delimiter: 'comma' | 'semicolon';
    signal?: AbortSignal;
  },
): AsyncGenerator<CsvEvent> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const hash = createHash('sha256');
  let bytes = 0;
  async function* decode() {
    for await (const chunk of source) {
      options.signal?.throwIfAborted();
      bytes += chunk.length;
      if (bytes > IMPORT_LIMITS.fileBytes)
        throw new ImportFailure(ErrorCodes.IMPORT_FILE_TOO_LARGE);
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
  const parser = parse({
    bom: true,
    columns: false,
    delimiter: options.delimiter === 'semicolon' ? ';' : ',',
    cast: false,
    cast_date: false,
    trim: false,
    skip_empty_lines: true,
    relax_column_count: true,
    max_record_size: IMPORT_LIMITS.recordSize,
  });
  const pumping = pipeline(Readable.from(decode()), parser);
  void pumping.catch(() => undefined);
  let headers: string[] | undefined;
  let idIndex = -1;
  let count = 0;
  const ids = new Set<string>();
  try {
    for await (const raw of parser) {
      options.signal?.throwIfAborted();
      const record: unknown = raw;
      if (
        !Array.isArray(record) ||
        !record.every(
          (value: unknown) =>
            typeof value === 'string' && !value.includes('\0'),
        )
      )
        throw new ImportFailure(ErrorCodes.CSV_INVALID);
      const fields = record as string[];
      if (!headers) {
        if (
          fields.length > IMPORT_LIMITS.columns ||
          fields.some((field) => !field.trim() || field.length > 128) ||
          new Set(fields).size !== fields.length
        )
          throw new ImportFailure(ErrorCodes.CSV_HEADERS_INVALID);
        headers = fields;
        idIndex = headers.indexOf(options.idColumn);
        if (idIndex < 0)
          throw new ImportFailure(ErrorCodes.CSV_COLUMN_MISSING, {
            field: options.idColumn,
          });
        yield { kind: 'headers', headers };
        continue;
      }
      count++;
      if (count > IMPORT_LIMITS.rows)
        throw new ImportFailure(ErrorCodes.IMPORT_ROW_LIMIT, {
          sourceRow: count,
        });
      if (fields.length !== headers.length)
        throw new ImportFailure(ErrorCodes.CSV_INVALID, {
          sourceRow: count,
        });
      const externalId = fields[idIndex];
      if (!externalId.trim())
        throw new ImportFailure(ErrorCodes.CSV_ID_MISSING, {
          sourceRow: count,
          field: options.idColumn,
        });
      if (ids.has(externalId))
        throw new ImportFailure(ErrorCodes.CSV_DUPLICATE_ID, {
          sourceRow: count,
          field: options.idColumn,
        });
      ids.add(externalId);
      yield {
        kind: 'row',
        row: {
          sourceRow: count,
          externalId,
          originalValues: Object.fromEntries(
            headers.map((header, index) => [header, fields[index]]),
          ),
        },
      };
    }
    await pumping;
    if (!headers || count === 0) throw new ImportFailure(ErrorCodes.CSV_EMPTY);
    yield { kind: 'complete', count, hash: hash.digest('hex'), bytes };
  } catch (error) {
    if (error instanceof ImportFailure) throw error;
    if (options.signal?.aborted)
      throw new ImportFailure(ErrorCodes.IMPORT_INTERRUPTED);
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new ImportFailure(ErrorCodes.IMPORT_ARTIFACT_MISSING);
    if (
      ['EACCES', 'EPERM', 'EIO'].includes(
        (error as NodeJS.ErrnoException).code ?? '',
      )
    )
      throw new ImportFailure(ErrorCodes.IMPORT_ARTIFACT_UNAVAILABLE);
    throw new ImportFailure(
      ErrorCodes.CSV_INVALID,
      headers ? { sourceRow: count + 1 } : {},
    );
  } finally {
    parser.destroy();
    await pumping.catch(() => undefined);
  }
}
