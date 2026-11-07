import { describe, expect, it } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import type { ByteSink } from '../../../src/artifacts/artifacts.types.js';
import { parseCatalogCsv } from '../../../src/catalog-import/csv-parser.js';
import { IMPORT_LIMITS } from '../../../src/catalog-import/import.types.js';
import { publicError } from '../../../src/common/http/public-error.js';
import {
  writeCatalogCsv,
  type CatalogCsvPlan,
} from '../../../src/worksheet-catalog-snapshots/catalog-csv.js';
import { WORKSHEET_CATALOG_LIMITS } from '../../../src/worksheet-catalog-snapshots/worksheet-catalog-snapshots.types.js';
import { CALCULATION_ENGINE } from '../../../src/worksheets/formula.js';
import type { StoredRow } from '../../../src/worksheets/worksheet-rows.repository.js';
import type { WorksheetColumn } from '../../../src/worksheets/worksheets.types.js';

function column(
  id: string,
  type: WorksheetColumn['type'],
  extra: Partial<WorksheetColumn> = {},
): WorksheetColumn {
  return { id, name: id, type, position: 0, required: false, ...extra };
}

const SKU = column('sku', 'text', { name: 'SKU' });
const PRICE = column('precio', 'decimal', { name: 'Precio' });
const DATE = column('fecha', 'date', { name: 'Fecha' });
const ACTIVE = column('activo', 'boolean', { name: 'Activo' });
const STATE = column('estado', 'selection', {
  name: 'Estado',
  options: [{ id: '00000000-0000-4000-8000-0000000000a1', label: '=Usado' }],
});
const PER_UNIT = column('unidad', 'calculated', {
  name: 'Unidad',
  formula: {
    engine: CALCULATION_ENGINE,
    expression: {
      op: 'div',
      args: [{ column: 'precio' }, { column: 'cantidad' }],
    },
    scale: 2,
    rounding: 'half_up',
  },
});
const QUANTITY = column('cantidad', 'integer', { name: 'Cantidad' });
const NOTE = column('nota', 'text', { name: 'Nota' });

/** Bytes de la marca de orden de bytes en UTF-8. */
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function planOf(
  selected: readonly WorksheetColumn[],
  all: readonly WorksheetColumn[] = selected,
): CatalogCsvPlan {
  return { idColumn: SKU, selected, all };
}

/** Destino en memoria: junta los trozos como los guardaría el almacén. */
function memorySink() {
  const chunks: Buffer[] = [];
  const sink: ByteSink = {
    write: async (chunk) => {
      chunks.push(chunk);
    },
  };
  return { sink, content: () => Buffer.concat(chunks) };
}

async function* rowsOf(...pages: StoredRow[][]) {
  yield* pages;
}

/** Lee el CSV con el parser real del catálogo, como lo hará su worker. */
async function readAsCatalog(content: Buffer) {
  async function* source() {
    yield content;
  }
  const rows: Record<string, string>[] = [];
  let headers: string[] = [];
  for await (const event of parseCatalogCsv(source(), {
    idColumn: 'SKU',
    delimiter: 'comma',
  })) {
    if (event.kind === 'headers') headers = event.headers;
    if (event.kind === 'row') rows.push(event.row.originalValues);
  }
  return { headers, rows };
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return { status: error.getStatus(), body: error.getResponse() };
    }
    throw error;
  }
  throw new Error('Se esperaba un error');
}

describe('writeCatalogCsv: revisión → CSV de una importación de catálogo (D25, D26)', () => {
  it('el parser del catálogo lee los mismos textos que E5.3, sin apóstrofo delante de las fórmulas', async () => {
    const { sink, content } = memorySink();
    const plan = planOf(
      [SKU, PRICE, DATE, ACTIVE, STATE, PER_UNIT, NOTE],
      [SKU, PRICE, DATE, ACTIVE, STATE, PER_UNIT, QUANTITY, NOTE],
    );

    const summary = await writeCatalogCsv(
      sink,
      plan,
      rowsOf(
        [
          {
            rowId: 'r1',
            cellValues: {
              sku: '  007',
              precio: '10.50',
              fecha: '1899-12-31',
              activo: true,
              estado: '00000000-0000-4000-8000-0000000000a1',
              cantidad: '4',
              nota: '=HYPERLINK("x")',
            },
          },
        ],
        [
          {
            rowId: 'r2',
            cellValues: { sku: '008', nota: 'línea\nnueva, coma' },
          },
        ],
      ),
    );

    expect(summary).toEqual({ rowCount: 2, problems: [] });
    expect(content().subarray(0, 3)).toEqual(BOM);
    expect(content().subarray(3).toString('utf8')).toBe(
      'SKU,Precio,Fecha,Activo,Estado,Unidad,Nota\r\n' +
        '  007,10.50,1899-12-31,true,=Usado,2.63,"=HYPERLINK(""x"")"\r\n' +
        '008,,,,,,"línea\nnueva, coma"\r\n',
    );
    expect(await readAsCatalog(content())).toEqual({
      headers: ['SKU', 'Precio', 'Fecha', 'Activo', 'Estado', 'Unidad', 'Nota'],
      rows: [
        {
          SKU: '  007',
          Precio: '10.50',
          Fecha: '1899-12-31',
          Activo: 'true',
          Estado: '=Usado',
          Unidad: '2.63',
          Nota: '=HYPERLINK("x")',
        },
        {
          SKU: '008',
          Precio: '',
          Fecha: '',
          Activo: '',
          Estado: '',
          Unidad: '',
          Nota: 'línea\nnueva, coma',
        },
      ],
    });
  });

  it('informa de lo que el catálogo rechazaría: identificador vacío, en blanco o repetido y celdas con problema', async () => {
    const { sink } = memorySink();
    const plan = planOf(
      [SKU, PRICE, PER_UNIT],
      [SKU, PRICE, PER_UNIT, QUANTITY],
    );

    const summary = await writeCatalogCsv(
      sink,
      plan,
      rowsOf([
        {
          rowId: 'r1',
          cellValues: { sku: 'A', precio: '1.00', cantidad: '1' },
        },
        {
          rowId: 'r2',
          cellValues: { sku: 'A', precio: '2.00', cantidad: '1' },
        },
        { rowId: 'r3', cellValues: { precio: '3.00', cantidad: '1' } },
        {
          rowId: 'r4',
          cellValues: { sku: '  ', precio: '4.00', cantidad: '1' },
        },
        {
          rowId: 'r5',
          cellValues: { sku: 'B', precio: 'diez', cantidad: '1' },
        },
        {
          rowId: 'r6',
          cellValues: { sku: 'C', precio: '6.00', cantidad: '0' },
        },
      ]),
    );

    expect(summary).toEqual({
      rowCount: 6,
      problems: [
        { rowId: 'r2', columnId: 'sku', code: 'CATALOG_ID_DUPLICATE' },
        { rowId: 'r3', columnId: 'sku', code: 'CATALOG_ID_MISSING' },
        { rowId: 'r4', columnId: 'sku', code: 'CATALOG_ID_MISSING' },
        { rowId: 'r5', columnId: 'precio', code: 'CELL_VALUE_INVALID' },
        { rowId: 'r5', columnId: 'unidad', code: 'CALC_INPUT_INVALID' },
        { rowId: 'r6', columnId: 'unidad', code: 'CALC_DIVISION_BY_ZERO' },
      ],
    });
  });

  it('si la celda del identificador ya tiene un problema, no lo repite como identificador vacío', async () => {
    const { sink } = memorySink();
    const required = { ...SKU, required: true };
    const summary = await writeCatalogCsv(
      sink,
      { idColumn: required, selected: [required], all: [required] },
      rowsOf([{ rowId: 'r1', cellValues: {} }]),
    );

    expect(summary.problems).toEqual([
      { rowId: 'r1', columnId: 'sku', code: 'CELL_REQUIRED' },
    ]);
  });

  it('una fila de más de 1 MiB es un problema de la fila entera', async () => {
    const { sink } = memorySink();
    const notes = Array.from({ length: 50 }, (_, index) =>
      column(`nota${index}`, 'text'),
    );
    // 50 celdas de 8.000 «€» (3 bytes cada uno): unos 1,2 MB.
    const cellValues = Object.fromEntries([
      ['sku', 'A'],
      ...notes.map((note) => [note.id, '€'.repeat(8_000)]),
    ]);

    const summary = await writeCatalogCsv(
      sink,
      planOf([SKU, ...notes]),
      rowsOf([{ rowId: 'r1', cellValues }]),
    );

    expect(summary.problems).toEqual([
      { rowId: 'r1', code: 'CATALOG_RECORD_TOO_LARGE' },
    ]);
  });

  it('al pasar de 10 MiB se detiene con 413 y no sigue escribiendo', async () => {
    const { sink, content } = memorySink();
    const notes = Array.from({ length: 50 }, (_, index) =>
      column(`nota${index}`, 'text'),
    );
    const bigRow = (rowId: string): StoredRow => ({
      rowId,
      cellValues: Object.fromEntries([
        ['sku', rowId],
        ...notes.map((note) => [note.id, '€'.repeat(8_000)]),
      ]),
    });
    const pages = Array.from({ length: 12 }, (_, index) => [
      bigRow(`r${index}`),
    ]);

    const failure = await failureOf(
      writeCatalogCsv(sink, planOf([SKU, ...notes]), rowsOf(...pages)),
    );

    expect(failure).toEqual({
      status: 413,
      body: publicError('WORKSHEET_CATALOG_TOO_LARGE'),
    });
    expect(content().length).toBeLessThanOrEqual(IMPORT_LIMITS.fileBytes);
  });

  it('devuelve como mucho 500 problemas, pero cuenta todas las filas', async () => {
    const { sink } = memorySink();
    const rows = Array.from({ length: 600 }, (_, index) => ({
      rowId: `r${index}`,
      cellValues: { sku: '' },
    }));

    const summary = await writeCatalogCsv(sink, planOf([SKU]), rowsOf(rows));

    expect(summary.rowCount).toBe(600);
    expect(summary.problems).toHaveLength(
      WORKSHEET_CATALOG_LIMITS.reportedProblems,
    );
  });

  it('sin filas, solo la cabecera: decide quien llama', async () => {
    const { sink, content } = memorySink();

    const summary = await writeCatalogCsv(sink, planOf([SKU]), rowsOf());

    expect(summary).toEqual({ rowCount: 0, problems: [] });
    expect(content().subarray(3).toString('utf8')).toBe('SKU\r\n');
  });
});
