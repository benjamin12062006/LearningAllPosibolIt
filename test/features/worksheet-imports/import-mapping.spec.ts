import { describe, expect, it } from '@jest/globals';
import {
  parseMappingTemplate,
  unknownTemplateColumns,
  withTemplate,
  type MappingTemplate,
} from '../../../src/worksheet-imports/import-mapping.js';
import type { WorksheetColumn } from '../../../src/worksheets/worksheets.types.js';

const SKU = '00000000-0000-4000-8000-0000000000a1';
const PRICE = '00000000-0000-4000-8000-0000000000a2';
const TOTAL = '00000000-0000-4000-8000-0000000000a3';

const COLUMNS: WorksheetColumn[] = [
  { id: SKU, name: 'SKU', type: 'text', position: 0, required: true },
  { id: PRICE, name: 'Precio', type: 'decimal', position: 1, required: false },
  {
    id: TOTAL,
    name: 'Total',
    type: 'calculated',
    position: 2,
    required: false,
    formula: {
      engine: 'calc-v1',
      expression: { column: PRICE },
      scale: 2,
      rounding: 'half_up',
    },
  },
];

const TEMPLATE: MappingTemplate = {
  mode: 'upsert',
  matchColumnId: SKU,
  decimalSeparator: ',',
  booleanLabels: { true: ['sí'], false: ['no'] },
  columns: [
    { header: 'sku', columnId: SKU },
    { header: 'precio', columnId: PRICE },
  ],
};

describe('parseMappingTemplate', () => {
  it('acepta el mapeo y rellena lo que falta como una importación', () => {
    const parsed = parseMappingTemplate({
      mode: 'append',
      columns: [{ header: 'sku', columnId: SKU }],
    });

    expect(parsed).toEqual({
      ok: true,
      template: {
        mode: 'append',
        matchColumnId: null,
        decimalSeparator: '.',
        booleanLabels: { true: ['true'], false: ['false'] },
        columns: [{ header: 'sku', columnId: SKU }],
      },
    });
  });

  it('una plantilla completa sale tal cual', () => {
    expect(parseMappingTemplate(TEMPLATE)).toEqual({
      ok: true,
      template: TEMPLATE,
    });
  });

  it('las opciones del archivo no son de la plantilla', () => {
    const parsed = parseMappingTemplate({
      ...TEMPLATE,
      title: 'Marzo',
      excludeRows: [2],
      delimiter: 'semicolon',
      sheet: 'Hoja1',
    });

    expect(parsed).toEqual({
      ok: false,
      issues: ['title', 'excludeRows', 'delimiter', 'sheet'].map((key) => ({
        field: `mapping.${key}`,
        code: 'IMPORT_OPTIONS_INVALID',
      })),
    });
  });

  it('con las mismas reglas que una importación, cada problema con su campo', () => {
    const parsed = parseMappingTemplate({
      mode: 'upsert',
      matchColumnId: null,
      columns: [],
    });

    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? [] : parsed.issues.map((issue) => issue.field)).toEqual([
      'mapping.matchColumnId',
      'mapping.columns',
    ]);
    expect(parseMappingTemplate([TEMPLATE]).ok).toBe(false);
    expect(parseMappingTemplate(null).ok).toBe(false);
  });
});

describe('unknownTemplateColumns', () => {
  it('sin problemas si todas las columnas existen y se pueden escribir', () => {
    expect(unknownTemplateColumns(TEMPLATE, COLUMNS)).toEqual([]);
  });

  it('marca las columnas que no existen, las calculadas y la clave', () => {
    const issues = unknownTemplateColumns(
      {
        ...TEMPLATE,
        matchColumnId: '00000000-0000-4000-8000-0000000000ff',
        columns: [
          { header: 'sku', columnId: SKU },
          { header: 'total', columnId: TOTAL },
          { header: 'otra', columnId: '00000000-0000-4000-8000-0000000000fe' },
          { header: 'nueva', newColumn: { name: 'Nueva', type: 'text' } },
        ],
      },
      COLUMNS,
    );

    expect(issues).toEqual([
      { field: 'mapping.columns.1', code: 'IMPORT_MAPPING_INVALID' },
      { field: 'mapping.columns.2', code: 'IMPORT_MAPPING_INVALID' },
      { field: 'mapping.matchColumnId', code: 'IMPORT_MAPPING_INVALID' },
    ]);
  });
});

describe('withTemplate', () => {
  it('la plantilla pone el mapeo y la petición lo que depende del archivo', () => {
    const merged = withTemplate(TEMPLATE, {
      title: 'Marzo',
      excludeRows: [3],
      delimiter: 'semicolon',
    });

    expect(merged).toEqual({
      ok: true,
      raw: {
        ...TEMPLATE,
        title: 'Marzo',
        excludeRows: [3],
        delimiter: 'semicolon',
      },
    });
  });

  it('sin opciones propias basta la plantilla', () => {
    expect(withTemplate(TEMPLATE, undefined)).toEqual({
      ok: true,
      raw: TEMPLATE,
    });
  });

  it('repetir en la petición algo de la plantilla es un error, no una mezcla', () => {
    expect(withTemplate(TEMPLATE, { columns: [], mode: 'append' })).toEqual({
      ok: false,
      issues: [
        { field: 'columns', code: 'IMPORT_OPTIONS_INVALID' },
        { field: 'mode', code: 'IMPORT_OPTIONS_INVALID' },
      ],
    });
    expect(withTemplate(TEMPLATE, ['no es un objeto']).ok).toBe(false);
  });
});
