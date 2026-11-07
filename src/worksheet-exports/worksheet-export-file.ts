import type { ByteSink } from '../artifacts/artifacts.types.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { evaluateRow } from '../worksheets/row-evaluation.js';
import type { StoredRow } from '../worksheets/worksheet-rows.repository.js';
import type { WorksheetColumn } from '../worksheets/worksheets.types.js';
import { exportCell, type ExportCell } from './export-cells.js';
import {
  CSV_BOM,
  csvHeader,
  csvRecord,
  type CsvWriteOptions,
} from './export-csv.js';
import {
  writeXlsxPackage,
  xlsxSheetXml,
  type CellPage,
} from './export-xlsx.js';
import { WORKSHEET_EXPORT_LIMITS } from './worksheet-exports.types.js';

/** Qué archivo se escribe y con qué columnas. */
export type ExportFilePlan = Readonly<{
  /** `null` para XLSX. */
  csv: CsvWriteOptions | null;
  sheetName: string;
  /** Columnas que se exportan, en el orden del archivo. */
  selected: readonly WorksheetColumn[];
  /** Todas las de la revisión: una calculada puede leer una no exportada. */
  all: readonly WorksheetColumn[];
}>;

export type ExportFileSummary = Readonly<{
  rowCount: number;
  problemCellCount: number;
}>;

/**
 * Escribe el archivo de una exportación página a página (D17–D20): cada fila
 * se evalúa (las calculadas, con su resultado), se convierte en celdas y se
 * serializa; nunca está la hoja entera en memoria. Si el contenido pasa del
 * límite, se detiene con 413 y el almacén descarta lo escrito.
 */
export async function writeExportFile(
  sink: ByteSink,
  plan: ExportFilePlan,
  rows: AsyncIterable<readonly StoredRow[]>,
): Promise<ExportFileSummary> {
  const tally = new ExportTally();
  const pages = cellPages(plan, rows, tally);
  const header = plan.selected.map((column) => column.name);

  if (plan.csv) {
    await writeCsv(sink, plan.csv, header, pages, tally);
  } else {
    await writeXlsxPackage(
      sink,
      plan.sheetName,
      measured(xlsxSheetXml(header, pages), tally),
    );
  }
  return tally.summary();
}

async function writeCsv(
  sink: ByteSink,
  options: CsvWriteOptions,
  header: readonly string[],
  pages: AsyncIterable<CellPage>,
  tally: ExportTally,
) {
  await sink.write(tally.measure(CSV_BOM + csvHeader(header, options)));
  for await (const page of pages) {
    const records = page.map((cells) => csvRecord(cells, options));
    await sink.write(tally.measure(records.join('')));
  }
}

async function* cellPages(
  plan: ExportFilePlan,
  rows: AsyncIterable<readonly StoredRow[]>,
  tally: ExportTally,
): AsyncGenerator<CellPage> {
  const selectedIds = plan.selected.map((column) => column.id);
  for await (const page of rows) {
    yield page.map((row) => {
      const { values, problems } = evaluateRow(
        plan.all,
        row.cellValues,
        selectedIds,
      );
      tally.addRow(problems.length);
      return plan.selected.map((column): ExportCell =>
        exportCell(column, values[column.id]),
      );
    });
  }
}

async function* measured(
  chunks: AsyncIterable<string>,
  tally: ExportTally,
): AsyncGenerator<Buffer> {
  for await (const chunk of chunks) {
    yield tally.measure(chunk);
  }
}

/** Filas, celdas con problema y bytes de contenido, con el límite de D20. */
class ExportTally {
  private rowCount = 0;
  private problemCellCount = 0;
  private contentBytes = 0;

  addRow(problemCells: number) {
    this.rowCount += 1;
    this.problemCellCount += problemCells;
  }

  /** El trozo ya codificado; lanza si con él se pasa del límite. */
  measure(text: string): Buffer {
    const chunk = Buffer.from(text, 'utf8');
    this.contentBytes += chunk.length;
    if (this.contentBytes > WORKSHEET_EXPORT_LIMITS.contentBytes) {
      throw apiError(ErrorCodes.WORKSHEET_EXPORT_TOO_LARGE);
    }
    return chunk;
  }

  summary(): ExportFileSummary {
    return {
      rowCount: this.rowCount,
      problemCellCount: this.problemCellCount,
    };
  }
}
