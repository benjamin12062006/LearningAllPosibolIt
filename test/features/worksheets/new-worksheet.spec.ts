import { describe, expect, it } from '@jest/globals';
import {
  buildNewWorksheet,
  duplicateColumnPositions,
} from '../../../src/worksheets/new-worksheet.js';
import type { ColumnDefinition } from '../../../src/worksheets/worksheet-columns.js';

const columns: ColumnDefinition[] = [
  { name: 'SKU', type: 'text', required: true },
  { name: 'Precio', type: 'decimal', required: false },
  { name: 'Alta', type: 'date', required: false },
];

describe('Fábrica de una hoja nueva', () => {
  it('da a cada columna un ID propio, su posición y su nombre normalizado', () => {
    const worksheet = buildNewWorksheet('Inventario', columns);

    expect(worksheet.columns).toEqual([
      expect.objectContaining({
        name: 'SKU',
        nameNormalized: 'sku',
        position: 0,
      }),
      expect.objectContaining({ name: 'Precio', type: 'decimal', position: 1 }),
      expect.objectContaining({ name: 'Alta', type: 'date', position: 2 }),
    ]);
    const ids = new Set(worksheet.columns.map(({ columnId }) => columnId));
    expect(ids.size).toBe(columns.length);
    expect(ids.has(worksheet.worksheetId)).toBe(false);
  });

  it('nace con esquema 1 y una revisión 1 vacía', () => {
    const worksheet = buildNewWorksheet(' Inventario ', []);

    expect(worksheet.nameNormalized).toBe('inventario');
    expect(worksheet.schemaVersion).toBe(1);
    expect(worksheet.initialRevision).toEqual({
      revisionId: expect.any(String),
      sequence: 1,
      schemaVersion: 1,
      rowCount: 0,
    });
  });

  it('dos hojas con las mismas columnas no comparten IDs', () => {
    const first = buildNewWorksheet('A', columns);
    const second = buildNewWorksheet('A', columns);

    expect(second.worksheetId).not.toBe(first.worksheetId);
    expect(second.columns[0].columnId).not.toBe(first.columns[0].columnId);
  });

  it('señala las columnas repetidas sin distinguir mayúsculas ni espacios de los extremos', () => {
    expect(duplicateColumnPositions(columns)).toEqual([]);
    expect(
      duplicateColumnPositions([
        ...columns,
        { name: ' precio ', type: 'integer', required: false },
        { name: 'SKU', type: 'text', required: false },
      ]),
    ).toEqual([3, 4]);
  });
});
