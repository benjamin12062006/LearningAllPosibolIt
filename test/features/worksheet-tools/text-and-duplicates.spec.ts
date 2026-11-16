import { describe, expect, it } from '@jest/globals';
import { transformOf } from '../../../src/worksheet-tools/worksheet-tools.dto.js';
import { planTransform } from '../../../src/worksheet-tools/worksheet-transform.js';
import { DuplicateFinder } from '../../../src/worksheets/row-duplicates.js';
import type { WorksheetColumn } from '../../../src/worksheets/worksheets.types.js';

const text: WorksheetColumn = {
  id: 'c-text',
  name: 'Precio',
  type: 'text',
  position: 0,
  required: false,
};

function replaceText(find: string, replace: string, match: string) {
  const apply = planTransform(
    text,
    transformOf({ kind: 'replace_text', find, replace, match }),
  );
  if (!apply) throw new Error('replace_text no aplica a texto');
  return apply;
}

describe('replace_text: cambiar un fragmento y conservar el resto', () => {
  it('sufijo, prefijo y cualquier aparición', () => {
    expect(replaceText('USD', 'BOB', 'suffix')('59.99 USD')).toBe('59.99 BOB');
    expect(replaceText('USD', 'BOB', 'suffix')('USD 59.99')).toBe('USD 59.99');
    expect(replaceText('USD', 'BOB', 'prefix')('USD 59.99')).toBe('BOB 59.99');
    expect(replaceText('USD', 'BOB', 'prefix')('59.99 USD')).toBe('59.99 USD');
    expect(replaceText('-', '/', 'contains')('A-1-2')).toBe('A/1/2');
    // Distingue mayúsculas, como replace_exact.
    expect(replaceText('usd', 'BOB', 'suffix')('59.99 USD')).toBe('59.99 USD');
    expect(replaceText('USD', '', 'suffix')('59.99 USD')).toBe('59.99 ');
    expect(replaceText('USD', 'BOB', 'suffix')(null)).toBeNull();
  });

  it('solo en columnas de texto y con una forma cerrada', () => {
    const decimal = { ...text, type: 'decimal' } as WorksheetColumn;
    expect(
      planTransform(decimal, {
        kind: 'replace_text',
        find: '5',
        replace: '6',
        match: 'suffix',
      }),
    ).toBeNull();
    for (const input of [
      { kind: 'replace_text', find: '', replace: 'x', match: 'suffix' },
      { kind: 'replace_text', find: 'a', replace: 'b', match: 'middle' },
      { kind: 'replace_text', find: 'a', replace: 1, match: 'suffix' },
      { kind: 'replace_text', find: 'a', replace: 'b' },
      {
        kind: 'replace_text',
        find: 'a',
        replace: 'b',
        match: 'suffix',
        extra: 1,
      },
    ]) {
      expect(() => transformOf(input)).toThrow();
    }
  });
});

describe('Duplicados por una clave de columnas', () => {
  const rows = [
    { rowId: 'r1', cellValues: { ref: 'R-1', name: 'Tornillo' } },
    { rowId: 'r2', cellValues: { ref: 'R-2', name: 'Arandela' } },
    { rowId: 'r3', cellValues: { ref: ' r-1 ', name: 'Tornillo' } },
    { rowId: 'r4', cellValues: { ref: 'R-1', name: 'Tuerca' } },
    { rowId: 'r5', cellValues: { name: 'Sin clave' } },
    { rowId: 'r6', cellValues: { ref: '', name: 'Vacía' } },
  ];

  function scan(criterion: ConstructorParameters<typeof DuplicateFinder>[0]) {
    const finder = new DuplicateFinder(criterion);
    // En dos páginas, como la recorre el servicio.
    finder.add(rows.slice(0, 3));
    finder.add(rows.slice(3));
    return finder.result();
  }

  it('exacto conserva la primera; normalizado agrupa espacios y mayúsculas', () => {
    expect(
      scan({ columnIds: ['ref'], comparison: 'exact', keep: 'first' }),
    ).toEqual({
      groups: [{ key: { ref: 'R-1' }, keepRowId: 'r1', removeRowIds: ['r4'] }],
      rowsWithEmptyKey: 2,
    });
    expect(
      scan({ columnIds: ['ref'], comparison: 'normalized', keep: 'last' })
        .groups,
    ).toEqual([
      { key: { ref: 'R-1' }, keepRowId: 'r4', removeRowIds: ['r1', 'r3'] },
    ]);
  });

  it('una clave de varias columnas exige que coincidan todas', () => {
    expect(
      scan({
        columnIds: ['ref', 'name'],
        comparison: 'normalized',
        keep: 'first',
      }).groups,
    ).toEqual([
      {
        key: { ref: 'R-1', name: 'Tornillo' },
        keepRowId: 'r1',
        removeRowIds: ['r3'],
      },
    ]);
  });
});
