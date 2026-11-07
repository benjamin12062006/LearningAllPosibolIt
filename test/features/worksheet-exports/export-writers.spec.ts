import { describe, expect, it } from '@jest/globals';
import { createHash } from 'node:crypto';
import type { ByteSink } from '../../../src/artifacts/artifacts.types.js';
import { CALCULATION_ENGINE } from '../../../src/worksheets/formula.js';
import type { StoredRow } from '../../../src/worksheets/worksheet-rows.repository.js';
import type { WorksheetColumn } from '../../../src/worksheets/worksheets.types.js';
import {
  exportCell,
  type ExportCell,
} from '../../../src/worksheet-exports/export-cells.js';
import {
  csvHeader,
  csvRecord,
  type CsvWriteOptions,
} from '../../../src/worksheet-exports/export-csv.js';
import {
  columnLetters,
  escapeCellText,
  excelSerial,
  excelSheetName,
  writeXlsxPackage,
  xlsxSheetXml,
  type CellPage,
} from '../../../src/worksheet-exports/export-xlsx.js';
import {
  writeExportFile,
  type ExportFilePlan,
} from '../../../src/worksheet-exports/worksheet-export-file.js';
import { WORKSHEET_EXPORT_LIMITS } from '../../../src/worksheet-exports/worksheet-exports.types.js';
import { readWorksheetXlsx } from '../../../src/worksheet-imports/worksheet-xlsx.js';

function column(
  id: string,
  type: WorksheetColumn['type'],
  extra: Partial<WorksheetColumn> = {},
): WorksheetColumn {
  return { id, name: id, type, position: 0, required: false, ...extra };
}

const TEXT = column('texto', 'text');
const INTEGER = column('entero', 'integer');
const DECIMAL = column('decimal', 'decimal');
const DATE = column('fecha', 'date');
const BOOLEAN = column('activo', 'boolean');
const STATE = column('estado', 'selection', {
  options: [
    { id: '00000000-0000-4000-8000-0000000000a1', label: 'Nuevo' },
    { id: '00000000-0000-4000-8000-0000000000a2', label: '=Usado' },
  ],
});
const DOUBLE = column('doble', 'calculated', {
  formula: {
    engine: CALCULATION_ENGINE,
    expression: { op: 'mul', args: [{ column: 'decimal' }, { value: '2' }] },
    scale: 2,
    rounding: 'half_up',
  },
});

const CSV: CsvWriteOptions = { delimiter: ',', formulas: 'escape' };

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

async function* pagesOf(...pages: CellPage[]) {
  yield* pages;
}

async function xlsxOf(header: string[], ...pages: CellPage[]) {
  const { sink, content } = memorySink();
  async function* chunks() {
    for await (const text of xlsxSheetXml(header, pagesOf(...pages))) {
      yield Buffer.from(text, 'utf8');
    }
  }
  await writeXlsxPackage(sink, 'Datos', chunks());
  return content();
}

describe('exportCell: cada valor conserva su tipo sin perder nada (D17)', () => {
  it('vacío, texto tal cual y booleano', () => {
    expect(exportCell(TEXT, null)).toEqual({ kind: 'empty' });
    expect(exportCell(TEXT, undefined)).toEqual({ kind: 'empty' });
    expect(exportCell(TEXT, ' 007 ')).toEqual({ kind: 'text', text: ' 007 ' });
    expect(exportCell(BOOLEAN, false)).toEqual({
      kind: 'boolean',
      value: false,
    });
  });

  it('número si cabe en 15 cifras significativas; si no, texto exacto (F69)', () => {
    expect(exportCell(INTEGER, '123456789012345')).toEqual({
      kind: 'number',
      text: '123456789012345',
    });
    expect(exportCell(INTEGER, '1234567890123456')).toEqual({
      kind: 'text',
      text: '1234567890123456',
    });
    // Ceros a la izquierda y ceros finales decimales no son cifras que guardar.
    expect(exportCell(DECIMAL, '-00012.3456789012345000')).toEqual({
      kind: 'number',
      text: '-00012.3456789012345000',
    });
    expect(exportCell(DECIMAL, '12345678901234567.89')).toEqual({
      kind: 'text',
      text: '12345678901234567.89',
    });
  });

  it('fecha desde el 1900-03-01; antes, texto (la serie 60 no existe)', () => {
    expect(exportCell(DATE, '1900-03-01')).toEqual({
      kind: 'date',
      text: '1900-03-01',
    });
    expect(exportCell(DATE, '1900-02-28')).toEqual({
      kind: 'text',
      text: '1900-02-28',
    });
  });

  it('selección por su etiqueta y calculada por su resultado', () => {
    expect(exportCell(STATE, '00000000-0000-4000-8000-0000000000a1')).toEqual({
      kind: 'text',
      text: 'Nuevo',
    });
    expect(exportCell(DOUBLE, '21.00')).toEqual({
      kind: 'number',
      text: '21.00',
    });
  });

  it('un valor guardado sin la forma de su columna se ve como texto, no desaparece', () => {
    expect(exportCell(INTEGER, 'doce')).toEqual({ kind: 'text', text: 'doce' });
    expect(exportCell(TEXT, 5)).toEqual({ kind: 'text', text: '5' });
  });
});

describe('CSV: RFC 4180 y política contra fórmulas (D18, F8, F66)', () => {
  const text = (value: string): ExportCell => ({ kind: 'text', text: value });

  it('comillas solo cuando hacen falta, comillas duplicadas y CRLF al final', () => {
    expect(
      csvRecord(
        [text('a,b'), text('di "hola"'), text('dos\nlíneas'), text('simple')],
        CSV,
      ),
    ).toBe('"a,b","di ""hola""","dos\nlíneas",simple\r\n');
  });

  it('con punto y coma, la coma ya no obliga a entrecomillar', () => {
    const options: CsvWriteOptions = { delimiter: ';', formulas: 'escape' };
    expect(csvRecord([text('a,b'), text('c;d')], options)).toBe(
      'a,b;"c;d"\r\n',
    );
  });

  it('con escape, un apóstrofo delante de cada inicio peligroso, también de ancho completo', () => {
    const dangerous = [
      '=1+1',
      '+1',
      '-1+1',
      '@SUM(A1)',
      '\tA',
      '\rA',
      '\nA',
      '\uFF1D1',
      '\uFF0B1',
      '\uFF0D1',
      '\uFF20A',
    ];
    for (const value of dangerous) {
      const field = csvRecord([text(value)], CSV).replace(/\r\n$/, '');
      expect(field.replace(/^"|"$/g, '')).toBe(`'${value}`);
    }
    expect(csvRecord([text('precio = 3')], CSV)).toBe('precio = 3\r\n');
  });

  it('números, fechas y booleanos no se tocan: -5 es un número, no una fórmula', () => {
    expect(
      csvRecord(
        [
          { kind: 'number', text: '-5' },
          { kind: 'date', text: '2026-11-07' },
          { kind: 'boolean', value: true },
          { kind: 'empty' },
        ],
        CSV,
      ),
    ).toBe('-5,2026-11-07,true,\r\n');
  });

  it('con keep, el texto sale tal cual; la cabecera sigue la misma política', () => {
    const keep: CsvWriteOptions = { delimiter: ',', formulas: 'keep' };
    expect(csvRecord([text('=1+1')], keep)).toBe('=1+1\r\n');
    expect(csvHeader(['=Total', 'SKU'], CSV)).toBe("'=Total,SKU\r\n");
  });
});

describe('XLSX: texto como texto, escapes y nombres de Excel (D19)', () => {
  it('escapa XML y ST_Xstring: CR, control y _x literal; deja salto de línea y tabulador (F68)', () => {
    expect(escapeCellText('a<b>&c')).toBe('a&lt;b&gt;&amp;c');
    expect(escapeCellText('l\r\nm\tn')).toBe('l_x000D_\nm\tn');
    expect(escapeCellText('x\u0001y\uFFFE')).toBe('x_x0001_y_xFFFE_');
    expect(escapeCellText('_x0041_ y _xZZ_')).toBe('_x005F_x0041_ y _xZZ_');
  });

  it('nombre de hoja válido: sin caracteres prohibidos, 31 caracteres sin partir un emoji', () => {
    expect(excelSheetName('Ventas: 2026/11 [v2]?')).toBe(
      'Ventas_ 2026_11 _v2__',
    );
    expect(excelSheetName("'Citada'")).toBe('Citada');
    expect(excelSheetName('   ')).toBe('Hoja1');
    const long = `${'a'.repeat(30)}😀b`;
    expect(excelSheetName(long)).toBe(`${'a'.repeat(30)}😀`);
  });

  it('series del sistema 1900 y letras de columna', () => {
    expect(excelSerial('1900-03-01')).toBe(61);
    expect(excelSerial('2026-03-15')).toBe(46096);
    expect(columnLetters(0)).toBe('A');
    expect(columnLetters(25)).toBe('Z');
    expect(columnLetters(26)).toBe('AA');
    expect(columnLetters(199)).toBe('GR');
  });

  it('el lector de E5.2 recupera cada celda con su tipo: ida y vuelta exacta', async () => {
    const page: CellPage = [
      [
        { kind: 'text', text: '=1+1' },
        { kind: 'number', text: '-0.10' },
        { kind: 'date', text: '2026-03-15' },
        { kind: 'boolean', value: true },
        { kind: 'text', text: '00123' },
        { kind: 'text', text: 'línea\r\n_x0041_\u0001' },
      ],
      [{ kind: 'empty' }, { kind: 'text', text: '12345678901234567.89' }],
    ];
    const header = ['texto', 'número', 'fecha', 'activo', 'código', 'nota'];
    const read = await readWorksheetXlsx(await xlsxOf(header, page), {
      sheet: null,
      headerRow: 1,
    });

    expect(read.sheets).toEqual(['Datos']);
    expect(read.table?.headers).toEqual(header);
    expect(read.table?.rows).toEqual([
      [
        '=1+1',
        { kind: 'number', text: '-0.10' },
        { kind: 'date', text: '2026-03-15' },
        { kind: 'boolean', text: 'true' },
        '00123',
        'línea\r\n_x0041_\u0001',
      ],
      // El lector rellena hasta el ancho de la cabecera: vacío es `''`.
      ['', '12345678901234567.89', '', '', '', ''],
    ]);
  });

  it('mismo contenido, mismos bytes (D21)', async () => {
    const page: CellPage = [[{ kind: 'text', text: 'a' }]];
    const first = await xlsxOf(['texto'], page);
    const second = await xlsxOf(['texto'], page);
    expect(sha256(first)).toBe(sha256(second));
  });
});

describe('writeExportFile: páginas de filas → archivo (D17, D20)', () => {
  const plan: ExportFilePlan = {
    csv: CSV,
    sheetName: 'Productos',
    selected: [TEXT, DOUBLE],
    all: [TEXT, DECIMAL, DOUBLE],
  };

  async function* rowsOf(...pages: StoredRow[][]) {
    yield* pages;
  }

  it('evalúa las calculadas con columnas no exportadas y cuenta filas y problemas', async () => {
    const { sink, content } = memorySink();
    const summary = await writeExportFile(
      sink,
      plan,
      rowsOf(
        [{ rowId: 'r1', cellValues: { texto: 'a', decimal: '10.5' } }],
        [{ rowId: 'r2', cellValues: { texto: 'b', decimal: 'diez' } }],
      ),
    );

    expect(content().toString('utf8')).toBe(
      '\uFEFFtexto,doble\r\na,21.00\r\nb,\r\n',
    );
    expect(summary).toEqual({ rowCount: 2, problemCellCount: 1 });
  });

  it('un XLSX con la misma tabla se lee con el lector de E5.2', async () => {
    const { sink, content } = memorySink();
    await writeExportFile(
      sink,
      { ...plan, csv: null },
      rowsOf([{ rowId: 'r1', cellValues: { texto: 'a', decimal: '10.5' } }]),
    );
    const read = await readWorksheetXlsx(content(), {
      sheet: 'Productos',
      headerRow: 1,
    });
    expect(read.table?.rows).toEqual([
      ['a', { kind: 'number', text: '21.00' }],
    ]);
  });

  it('pasado el límite de contenido, se detiene con 413 (T16)', async () => {
    const huge = 'x'.repeat(8192);
    const rowsNeeded = Math.ceil(WORKSHEET_EXPORT_LIMITS.contentBytes / 8192);
    async function* manyRows() {
      for (let index = 0; index <= rowsNeeded; index += 1) {
        yield [{ rowId: `r${index}`, cellValues: { texto: huge } }];
      }
    }
    const written: number[] = [];
    const sink: ByteSink = {
      write: async (chunk) => {
        written.push(chunk.length);
      },
    };

    await expect(
      writeExportFile(sink, { ...plan, selected: [TEXT] }, manyRows()),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'WORKSHEET_EXPORT_TOO_LARGE',
      }),
    });
    const total = written.reduce((sum, length) => sum + length, 0);
    expect(total).toBeLessThanOrEqual(WORKSHEET_EXPORT_LIMITS.contentBytes);
  });
});

function sha256(content: Buffer) {
  return createHash('sha256').update(content).digest('hex');
}
