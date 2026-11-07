import type { ByteSink } from '../artifacts/artifacts.types.js';
import { IMPORT_LIMITS } from '../catalog-import/import.types.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes, type ErrorCode } from '../common/http/error-codes.js';
import { cellText, exportCell } from '../worksheet-exports/export-cells.js';
import {
  CSV_BOM,
  csvHeader,
  csvRecord,
  type CsvWriteOptions,
} from '../worksheet-exports/export-csv.js';
import { evaluateRow, type RowProblem } from '../worksheets/row-evaluation.js';
import type { StoredRow } from '../worksheets/worksheet-rows.repository.js';
import type { WorksheetColumn } from '../worksheets/worksheets.types.js';
import { WORKSHEET_CATALOG_LIMITS } from './worksheet-catalog-snapshots.types.js';

/**
 * El CSV que lee la importación de catálogo (D26): coma, como un CSV subido, y
 * los textos tal cual. Sin el apóstrofo contra fórmulas de E5.3: cambiaría los
 * datos que llegan al feed ([12]).
 */
const CATALOG_CSV: CsvWriteOptions = { delimiter: ',', formulas: 'keep' };

/** Qué columnas forman el snapshot y cuál da el identificador de cada producto. */
export type CatalogCsvPlan = Readonly<{
  idColumn: WorksheetColumn;
  /** En el orden del CSV; incluyen `idColumn`. */
  selected: readonly WorksheetColumn[];
  /** Todas las de la revisión: una calculada puede leer una no elegida. */
  all: readonly WorksheetColumn[];
}>;

/** Algo que la importación de catálogo rechazaría; sin columna, la fila entera. */
export type CatalogRowProblem = Readonly<{
  rowId: string;
  columnId?: string;
  code: ErrorCode;
}>;

export type CatalogCsvSummary = Readonly<{
  rowCount: number;
  /** Los primeros `reportedProblems`. */
  problems: readonly CatalogRowProblem[];
}>;

/**
 * Escribe la revisión como el CSV de una importación de catálogo, página a
 * página, y comprueba a la vez lo que el worker de importaciones rechazaría
 * después de responder (D25): identificador vacío o repetido, celdas con
 * problema y registros de más de 1 MiB. Al pasar de 10 MiB se detiene con 413.
 * Quien llama decide qué hacer con los problemas.
 */
export async function writeCatalogCsv(
  sink: ByteSink,
  plan: CatalogCsvPlan,
  rows: AsyncIterable<readonly StoredRow[]>,
): Promise<CatalogCsvSummary> {
  const check = new CatalogCheck(plan.idColumn.id);
  const header = plan.selected.map((column) => column.name);
  await sink.write(check.measure(CSV_BOM + csvHeader(header, CATALOG_CSV)));

  for await (const page of rows) {
    const records = page.map((row) => catalogRecord(plan, row, check));
    await sink.write(check.measure(records.join('')));
  }
  return check.summary();
}

/** El registro de una fila con el texto de E5.3 de cada celda (D26). */
function catalogRecord(
  plan: CatalogCsvPlan,
  row: StoredRow,
  check: CatalogCheck,
) {
  const selectedIds = plan.selected.map((column) => column.id);
  const { values, problems } = evaluateRow(
    plan.all,
    row.cellValues,
    selectedIds,
  );
  const cells = plan.selected.map((column) =>
    exportCell(column, values[column.id]),
  );
  const record = csvRecord(cells, CATALOG_CSV);
  const idCell = cells[selectedIds.indexOf(plan.idColumn.id)];

  check.addRow(row.rowId, {
    cellProblems: problems,
    externalId: idCell ? cellText(idCell) : '',
    recordBytes: Buffer.byteLength(record, 'utf8'),
  });
  return record;
}

/**
 * Lo que se comprueba mientras se escribe: filas, identificadores vistos,
 * problemas y bytes del archivo, con los límites de la importación de catálogo
 * (`IMPORT_LIMITS`).
 */
class CatalogCheck {
  private rowCount = 0;
  private fileBytes = 0;
  private readonly seenIds = new Set<string>();
  private readonly problems: CatalogRowProblem[] = [];

  constructor(private readonly idColumnId: string) {}

  /** El trozo ya codificado; lanza si con él el archivo pasa de 10 MiB. */
  measure(text: string): Buffer {
    const chunk = Buffer.from(text, 'utf8');
    this.fileBytes += chunk.length;
    if (this.fileBytes > IMPORT_LIMITS.fileBytes) {
      throw apiError(ErrorCodes.WORKSHEET_CATALOG_TOO_LARGE);
    }
    return chunk;
  }

  addRow(
    rowId: string,
    row: Readonly<{
      cellProblems: readonly RowProblem[];
      externalId: string;
      recordBytes: number;
    }>,
  ) {
    this.rowCount += 1;
    for (const { columnId, code } of row.cellProblems) {
      this.report({ rowId, columnId, code });
    }
    // Si la celda del identificador ya tiene un problema, basta con ese.
    const idHasProblem = row.cellProblems.some(
      ({ columnId }) => columnId === this.idColumnId,
    );
    if (!idHasProblem) {
      this.checkExternalId(rowId, row.externalId);
    }
    if (row.recordBytes > IMPORT_LIMITS.recordSize) {
      this.report({ rowId, code: ErrorCodes.CATALOG_RECORD_TOO_LARGE });
    }
  }

  summary(): CatalogCsvSummary {
    return { rowCount: this.rowCount, problems: this.problems };
  }

  /** La misma regla que `parseCatalogCsv`: no vacío tras quitar espacios y único. */
  private checkExternalId(rowId: string, externalId: string) {
    const columnId = this.idColumnId;
    if (!externalId.trim()) {
      this.report({ rowId, columnId, code: ErrorCodes.CATALOG_ID_MISSING });
      return;
    }
    if (this.seenIds.has(externalId)) {
      this.report({ rowId, columnId, code: ErrorCodes.CATALOG_ID_DUPLICATE });
      return;
    }
    this.seenIds.add(externalId);
  }

  private report(problem: CatalogRowProblem) {
    if (this.problems.length < WORKSHEET_CATALOG_LIMITS.reportedProblems) {
      this.problems.push(problem);
    }
  }
}
