import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { AuthenticatedIdentity } from '../auth/authenticated-request.js';
import { IMPORT_LIMITS } from '../catalog-import/import.types.js';
import { rowCountChange } from '../changesets/changeset-diff.js';
import { normalizeOperations } from '../changesets/changeset-operations.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes, type ErrorCode } from '../common/http/error-codes.js';
import {
  fetchWindow,
  resolvePage,
  toPage,
  type PageRequest,
} from '../common/http/pagination.js';
import {
  ApplicationFailure,
  publicError,
} from '../common/http/public-error.js';
import { UsersService } from '../users/users.service.js';
import {
  exceedsRowLimit,
  normalizeName,
} from '../worksheets/worksheet-columns.js';
import type { ProjectScope } from '../worksheets/worksheets.types.js';
import {
  isHeaderRow,
  parseImportOptions,
  type CsvImportOptions,
  type ImportOptions,
  type XlsxImportOptions,
} from './import-options.js';
import { withTemplate, type MappingTemplate } from './import-mapping.js';
import {
  ImportMappingsRepository,
  type ImportMapping,
} from './import-mappings.repository.js';
import {
  planImport,
  type IncludedRow,
  type RowProblem,
} from './import-plan.js';
import { readWorksheetCsv, type CsvDelimiter } from './worksheet-csv.js';
import { WorksheetImportsRepository } from './worksheet-imports.repository.js';
import {
  displayText,
  type ImportFormat,
  type ImportPreview,
  type ImportTable,
  type TemplateCoverage,
} from './worksheet-imports.types.js';
import {
  isCompoundFile,
  isXlsxContent,
  readWorksheetXlsx,
} from './worksheet-xlsx.js';

/** Como mucho se devuelven estos problemas; el informe guarda el total. */
const MAX_REPORTED_PROBLEMS = 500;
const MAX_FIELD_LENGTH = 128;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cómo leer el archivo: las opciones propias de su formato (D11). */
type FileChoice =
  | Pick<CsvImportOptions, 'format' | 'delimiter'>
  | Pick<XlsxImportOptions, 'format' | 'sheet' | 'headerRow'>;

/** Lo leído; en un libro de varias hojas sin hoja elegida, `table` es `null`. */
type FileRead = Readonly<{
  table: ImportTable | null;
  sheets?: readonly string[];
  sheet?: string | null;
}>;

/** Campos de texto de la vista previa, tal como llegan del formulario. */
export type PreviewFields = Readonly<{
  delimiter?: string;
  sheet?: string;
  headerRow?: string;
  /** Una plantilla de mapeo de la hoja (H3), para ver si encaja con el archivo. */
  mappingId?: string;
}>;

/**
 * Importar un CSV o un XLSX a un borrador de hoja (plan imports&exports 01,
 * E5.1 y E5.2). Nada oficial cambia aquí: el resultado es un borrador que
 * sigue el flujo de E4.
 */
@Injectable()
export class WorksheetImportsService {
  constructor(
    private readonly usersService: UsersService,
    private readonly repository: WorksheetImportsRepository,
    private readonly mappings: ImportMappingsRepository,
  ) {}

  /**
   * Cabeceras, muestra y mapeo sugerido por nombre; no guarda nada. De un
   * libro con varias hojas y sin `sheet`, solo la lista para elegir.
   */
  async preview(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    worksheetId: string,
    file: Buffer,
    fields: PreviewFields,
  ): Promise<ImportPreview> {
    const user = await this.usersService.findCurrent(identity);
    const head = await this.requireHead(user.id, scope, worksheetId);
    const template = await this.findTemplate(
      user.id,
      scope,
      worksheetId,
      fields.mappingId,
    );
    const choice = previewChoiceOf(formatOf(file), fields);
    const read = await readImportFile(file, choice);
    const { table } = read;
    if (!table) {
      return sheetListPreview(file, read);
    }
    const columns = await this.repository.findColumns(
      scope,
      worksheetId,
      head.schemaVersion,
    );

    const writableByName = new Map(
      columns
        .filter((column) => column.type !== 'calculated')
        .map((column) => [normalizeName(column.name), column.id]),
    );
    return {
      format: table.format,
      ...(read.sheets ? { sheets: read.sheets, sheet: read.sheet } : {}),
      fileHash: table.fileHash,
      fileBytes: table.fileBytes,
      rows: table.rows.length,
      headers: table.headers,
      sample: table.rows
        .slice(0, IMPORT_LIMITS.sampleRows)
        .map((row) => row.map(displayText)),
      suggestedColumns: table.headers.flatMap((header) => {
        const columnId = writableByName.get(normalizeName(header));
        return columnId ? [{ header, columnId }] : [];
      }),
      ...(template ? { template: coverageOf(template, table.headers) } : {}),
    };
  }

  /**
   * Lee el archivo, aplica el mapeo y crea la importación con su borrador.
   * Filas con problemas sin excluir → 422 con cada problema; nada que cambiar
   * o pasar de 5.000 filas → 409; en todos los casos no se guarda nada.
   */
  async create(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    worksheetId: string,
    file: Buffer,
    rawOptions: string | undefined,
    mappingId?: string,
  ) {
    const format = formatOf(file);
    const user = await this.usersService.findCurrent(identity);
    const template = await this.findTemplate(
      user.id,
      scope,
      worksheetId,
      mappingId,
    );
    const options = parseOptionsField(rawOptions, format, template?.mapping);
    const head = await this.requireHead(user.id, scope, worksheetId);
    const { table } = await readImportFile(file, options);
    if (!table) {
      throw apiError(ErrorCodes.XLSX_SHEET_REQUIRED);
    }
    const [columns, rows] = await Promise.all([
      this.repository.findColumns(scope, worksheetId, head.schemaVersion),
      options.mode === 'upsert'
        ? this.repository.findAllRowsAt(scope, worksheetId, head.sequence)
        : Promise.resolve(new Map()),
    ]);

    const plan = planImport({
      table,
      columns,
      rows,
      options,
      sortPrefix: new Date().toISOString(),
    });
    if (!plan.ok) {
      throw issuesError(plan.code, plan.issues);
    }
    if (plan.problems.length > 0) {
      throw rowProblemsError(plan.problems);
    }
    const operations = verifiedOperations(plan.operations, columns, rows);
    if (operations.length === 0) {
      throw apiError(ErrorCodes.IMPORT_NOTHING_TO_CHANGE);
    }
    // Un borrador que no se podrá aplicar no se crea; aplicar lo vuelve a
    // comprobar, porque la hoja puede crecer mientras tanto.
    if (exceedsRowLimit(head.rowCount + rowCountChange(operations, rows))) {
      throw apiError(ErrorCodes.WORKSHEET_ROW_LIMIT_EXCEEDED);
    }

    return this.repository.create(user.id, scope, {
      worksheetId,
      head,
      title: options.title,
      operations,
      record: {
        format: table.format,
        fileHash: table.fileHash,
        fileBytes: table.fileBytes,
        options,
        report: plan.report,
        excludedRows: plan.excluded,
        includedHash: includedHashOf(table.fileHash, plan.included),
      },
    });
  }

  async find(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    importId: string,
  ) {
    const user = await this.usersService.findCurrent(identity);
    const found = await this.repository.find(user.id, scope, importId);
    if (!found) {
      throw apiError(ErrorCodes.WORKSHEET_IMPORT_NOT_FOUND);
    }
    return found;
  }

  /** Importaciones de una hoja (H2), también de una archivada. */
  async findByWorksheet(
    identity: AuthenticatedIdentity,
    scope: ProjectScope,
    worksheetId: string,
    query?: Partial<PageRequest>,
  ) {
    const user = await this.usersService.findCurrent(identity);
    await this.requireHead(user.id, scope, worksheetId);

    const page = resolvePage(query);
    const rows = await this.repository.findByWorksheet(
      user.id,
      scope,
      worksheetId,
      fetchWindow(page),
    );
    return toPage(rows, page);
  }

  /**
   * La plantilla pedida, si es de esta hoja. Una de otra hoja responde como una
   * que no existe: sus columnas no tendrían sentido aquí.
   */
  private async findTemplate(
    userId: string,
    scope: ProjectScope,
    worksheetId: string,
    mappingId: string | undefined,
  ): Promise<ImportMapping | null> {
    if (mappingId === undefined) {
      return null;
    }
    if (!UUID_PATTERN.test(mappingId)) {
      throw optionsError(['mappingId']);
    }
    const mapping = await this.mappings.find(userId, scope, mappingId);
    if (!mapping || mapping.worksheetId !== worksheetId) {
      throw apiError(ErrorCodes.IMPORT_MAPPING_NOT_FOUND);
    }
    return mapping;
  }

  private async requireHead(
    userId: string,
    scope: ProjectScope,
    worksheetId: string,
  ) {
    const head = await this.repository.findHead(userId, scope, worksheetId);
    if (!head) {
      throw apiError(ErrorCodes.WORKSHEET_NOT_FOUND);
    }
    return head;
  }
}

/**
 * El formato sale de los primeros bytes (D11): un ZIP es un XLSX y lo demás,
 * CSV. Un contenedor CFB es un Office cifrado o un `.xls`: no se intenta leer.
 */
function formatOf(file: Buffer): ImportFormat {
  if (isCompoundFile(file)) {
    throw new ApplicationFailure(ErrorCodes.XLSX_ENCRYPTED);
  }
  return isXlsxContent(file) ? 'xlsx' : 'csv';
}

async function readImportFile(
  file: Buffer,
  choice: FileChoice,
): Promise<FileRead> {
  if (choice.format === 'csv') {
    return { table: readWorksheetCsv(file, choice.delimiter) };
  }
  return readWorksheetXlsx(file, choice);
}

/** Libro de varias hojas sin elegir: lo justo para elegir la hoja. */
function sheetListPreview(file: Buffer, read: FileRead): ImportPreview {
  return {
    format: 'xlsx',
    sheets: read.sheets ?? [],
    sheet: null,
    fileHash: createHash('sha256').update(file).digest('hex'),
    fileBytes: file.length,
    rows: 0,
    headers: [],
    sample: [],
    suggestedColumns: [],
  };
}

/**
 * Los campos de la vista previa de cada formato; uno del otro formato es un
 * error, como en `options`. `delimiter` mantiene su código de E5.1.
 */
function previewChoiceOf(
  format: ImportFormat,
  fields: PreviewFields,
): FileChoice {
  const foreign: readonly (keyof PreviewFields)[] =
    format === 'csv' ? ['sheet', 'headerRow'] : ['delimiter'];
  const present = foreign.filter((field) => fields[field] !== undefined);
  if (present.length > 0) {
    throw optionsError(present);
  }
  if (format === 'csv') {
    return { format, delimiter: delimiterOf(fields.delimiter) };
  }
  const headerRow =
    fields.headerRow === undefined ? 1 : Number(fields.headerRow);
  if (!isHeaderRow(headerRow)) {
    throw optionsError(['headerRow']);
  }
  return { format, sheet: fields.sheet ?? null, headerRow };
}

function delimiterOf(value: string | undefined): CsvDelimiter {
  if (value === undefined || value === 'comma') {
    return 'comma';
  }
  if (value === 'semicolon') {
    return 'semicolon';
  }
  throw apiError(ErrorCodes.DELIMITER_INVALID);
}

function optionsError(fields: readonly string[]) {
  return issuesError(
    ErrorCodes.IMPORT_OPTIONS_INVALID,
    fields.map((field) => ({ field, code: ErrorCodes.IMPORT_OPTIONS_INVALID })),
  );
}

/**
 * El campo `options` del formulario es JSON; su forma la valida
 * `parseImportOptions`. Con plantilla, el campo es opcional y solo lleva lo que
 * depende del archivo (H3).
 */
function parseOptionsField(
  raw: string | undefined,
  format: ImportFormat,
  template: MappingTemplate | undefined,
): ImportOptions {
  const own = readJsonField(raw);
  const result = parseImportOptions(
    template ? templatedOrReject(template, own) : own,
    format,
  );
  if (!result.ok) {
    throw issuesError(ErrorCodes.IMPORT_OPTIONS_INVALID, result.issues);
  }
  return result.options;
}

/**
 * Un JSON mal formado no es «sin opciones»: con una plantilla dejaría
 * importar sin las exclusiones que la persona escribió.
 */
function readJsonField(raw: string | undefined): unknown {
  if (raw === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw optionsError(['options']);
  }
}

function templatedOrReject(template: MappingTemplate, own: unknown) {
  const merged = withTemplate(template, own);
  if (!merged.ok) {
    throw issuesError(ErrorCodes.IMPORT_OPTIONS_INVALID, merged.issues);
  }
  return merged.raw;
}

/** Qué columnas de la plantilla tienen su cabecera en este archivo. */
function coverageOf(
  template: ImportMapping,
  headers: readonly string[],
): TemplateCoverage {
  const present = new Set(headers);
  const columns = template.mapping.columns;
  return {
    id: template.id,
    name: template.name,
    columns: columns.filter((column) => present.has(column.header)),
    missingHeaders: columns
      .map((column) => column.header)
      .filter((header) => !present.has(header)),
  };
}

/**
 * Las operaciones del plan pasan por la misma normalización que un guardado
 * manual: si el planificador produjera algo que E4 no acepta, se nota aquí y
 * no al aplicar.
 */
function verifiedOperations(
  operations: Parameters<typeof normalizeOperations>[0],
  columns: Parameters<typeof normalizeOperations>[1]['columns'],
  rows: Parameters<typeof normalizeOperations>[1]['baseRows'],
) {
  const result = normalizeOperations(operations, {
    columns,
    baseRows: rows,
    defaultSortKey: () => '',
  });
  if (!result.ok) {
    throw apiError(ErrorCodes.INTERNAL_ERROR);
  }
  return result.operations;
}

/** Huella de qué filas del archivo entran y con qué `rowId` (T15). */
function includedHashOf(fileHash: string, included: readonly IncludedRow[]) {
  const canonical = [
    'worksheet-import-v1',
    fileHash,
    included.map(({ sourceRow, rowId, action }) => [sourceRow, rowId, action]),
  ];
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function issuesError(
  code: ErrorCode,
  issues: readonly Readonly<{ field: string; code: ErrorCode }>[],
) {
  return apiError(
    code,
    issues.map(({ field, code: issueCode }) => ({
      field,
      ...publicError(issueCode),
    })),
  );
}

/** `rows.<fila>.<cabecera>`, como las demás validaciones por campo. */
function rowProblemsError(problems: readonly RowProblem[]) {
  return issuesError(
    ErrorCodes.IMPORT_ROWS_INVALID,
    problems
      .slice(0, MAX_REPORTED_PROBLEMS)
      .map(({ sourceRow, field, code }) => ({
        field: `rows.${sourceRow}.${field}`.slice(0, MAX_FIELD_LENGTH),
        code,
      })),
  );
}
