import { describe, expect, it } from '@jest/globals';
import { compareProducts } from '../../../src/feed-viewer/tsv-comparison.js';
import type { TsvTable } from '../../../src/feed-viewer/tsv-page.js';

const COLUMNS = ['id', 'title', 'price', 'availability'];

/** Una tabla con una fila por producto: `[id, title, price, availability]`. */
function table(rows: string[][], columns = COLUMNS): TsvTable {
  return {
    columns,
    products: rows.map((cells, index) => ({
      line: index + 2,
      values: Object.fromEntries(
        columns.map((column, position) => [column, cells[position]]),
      ),
    })),
  };
}

const published = table([
  ['A', 'Mesa', '10.00 USD', 'in_stock'],
  ['B', 'Silla', '20.00 USD', 'in_stock'],
  ['C', 'Sofá', '30.00 USD', 'in_stock'],
  ['D', 'Lámpara', '40.00 USD', 'in_stock'],
]);

describe('compareProducts', () => {
  it('dos archivos iguales no tienen cambios', () => {
    expect(compareProducts(published, published)).toEqual({
      counts: { added: 0, removed: 0, modified: 0, unchanged: 4 },
      changedFields: [],
      changes: [],
    });
  });

  it('distingue añadidos, retirados, modificados e iguales por id', () => {
    const candidate = table([
      ['A', 'Mesa', '10.00 USD', 'in_stock'],
      ['B', 'Silla', '25.00 USD', 'in_stock'],
      ['D', 'Lámpara', '40.00 USD', 'out_of_stock'],
      ['E', 'Cama', '50.00 USD', 'in_stock'],
    ]);

    const comparison = compareProducts(published, candidate);

    expect(comparison.counts).toEqual({
      added: 1,
      removed: 1,
      modified: 2,
      unchanged: 1,
    });
    expect(comparison.changes).toEqual([
      {
        id: 'B',
        change: 'modified',
        fields: [{ field: 'price', before: '20.00 USD', after: '25.00 USD' }],
      },
      {
        id: 'D',
        change: 'modified',
        fields: [
          { field: 'availability', before: 'in_stock', after: 'out_of_stock' },
        ],
      },
      { id: 'E', change: 'added', fields: [] },
      { id: 'C', change: 'removed', fields: [] },
    ]);
  });

  it('cuenta cuántos productos cambian cada campo, del que más al que menos', () => {
    const candidate = table([
      ['A', 'Mesa', '11.00 USD', 'in_stock'],
      ['B', 'Silla', '21.00 USD', 'out_of_stock'],
      ['C', 'Sofá grande', '31.00 USD', 'in_stock'],
      ['D', 'Lámpara', '40.00 USD', 'in_stock'],
    ]);

    const comparison = compareProducts(published, candidate);

    expect(comparison.changedFields).toEqual([
      { field: 'price', productCount: 3 },
      // Empate: por nombre.
      { field: 'availability', productCount: 1 },
      { field: 'title', productCount: 1 },
    ]);
    expect(comparison.counts.modified).toBe(3);
  });

  it('el orden de las filas no es un cambio', () => {
    const reordered = table([...published.products].reverse().map(cellsOf));

    expect(compareProducts(published, reordered).counts).toEqual({
      added: 0,
      removed: 0,
      modified: 0,
      unchanged: 4,
    });
  });

  it('una columna que solo está en un archivo cambia de nulo a su valor', () => {
    const before = table([['A', 'Mesa']], ['id', 'title']);
    const after = table([['A', 'Mesa', 'Acme']], ['id', 'title', 'brand']);

    expect(compareProducts(before, after).changes).toEqual([
      {
        id: 'A',
        change: 'modified',
        fields: [{ field: 'brand', before: null, after: 'Acme' }],
      },
    ]);
    expect(compareProducts(after, before).changes).toEqual([
      {
        id: 'A',
        change: 'modified',
        fields: [{ field: 'brand', before: 'Acme', after: null }],
      },
    ]);
  });

  it('un valor vacío no es lo mismo que una columna ausente', () => {
    const before = table([['A', 'Mesa', '']], ['id', 'title', 'brand']);
    const after = table([['A', 'Mesa']], ['id', 'title']);

    expect(compareProducts(before, after).changes[0].fields).toEqual([
      { field: 'brand', before: '', after: null },
    ]);
  });

  it('el id distingue mayúsculas: «a» y «A» son productos distintos', () => {
    const candidate = table([['a', 'Mesa', '10.00 USD', 'in_stock']]);
    const onlyA = table([['A', 'Mesa', '10.00 USD', 'in_stock']]);

    expect(compareProducts(onlyA, candidate).counts).toEqual({
      added: 1,
      removed: 1,
      modified: 0,
      unchanged: 0,
    });
  });

  it('contra un archivo sin productos, todo es añadido o todo retirado', () => {
    const empty = table([]);

    expect(compareProducts(empty, published).counts.added).toBe(4);
    expect(compareProducts(published, empty).counts.removed).toBe(4);
  });
});

function cellsOf(product: TsvTable['products'][number]) {
  return COLUMNS.map((column) => product.values[column]);
}
