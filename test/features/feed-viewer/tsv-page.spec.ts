import { describe, expect, it } from '@jest/globals';
import { Readable } from 'node:stream';
import {
  findTsvProduct,
  readTsvPage,
} from '../../../src/feed-viewer/tsv-page.js';

const HEADER = 'id\tbrand\ttitle\tprice';

function tsv(...lines: string[]) {
  return Readable.from([`${lines.join('\n')}\n`]);
}

function products(count: number) {
  return Array.from(
    { length: count },
    (_, index) => `SKU-${index + 1}\tMarca\tProducto ${index + 1}\t9.99 EUR`,
  );
}

const firstPage = { limit: 20, offset: 0 };

describe('readTsvPage', () => {
  it('devuelve la cabecera como columnas y cada línea con su número y sus celdas', async () => {
    const page = await readTsvPage(
      tsv(
        HEADER,
        'A1\t\tZapatilla roja\t59.90 EUR',
        'A2\tNike\tGorra\t15.00 EUR',
      ),
      firstPage,
    );

    expect(page).toEqual({
      columns: ['id', 'brand', 'title', 'price'],
      products: [
        {
          line: 2,
          values: {
            id: 'A1',
            brand: '',
            title: 'Zapatilla roja',
            price: '59.90 EUR',
          },
        },
        {
          line: 3,
          values: {
            id: 'A2',
            brand: 'Nike',
            title: 'Gorra',
            price: '15.00 EUR',
          },
        },
      ],
      page: { limit: 20, offset: 0, hasMore: false },
    });
  });

  it('pagina con limit y offset y sabe si hay más', async () => {
    const lines = [HEADER, ...products(5)];

    const first = await readTsvPage(tsv(...lines), { limit: 2, offset: 0 });
    const last = await readTsvPage(tsv(...lines), { limit: 2, offset: 4 });
    const beyond = await readTsvPage(tsv(...lines), { limit: 2, offset: 10 });

    expect(first.products.map((product) => product.line)).toEqual([2, 3]);
    expect(first.page.hasMore).toBe(true);
    expect(last.products.map((product) => product.line)).toEqual([6]);
    expect(last.page.hasMore).toBe(false);
    expect(beyond.products).toEqual([]);
    expect(beyond.page.hasMore).toBe(false);
  });

  it('la página exacta del final no dice que haya más', async () => {
    const page = await readTsvPage(tsv(HEADER, ...products(4)), {
      limit: 2,
      offset: 2,
    });

    expect(page.products).toHaveLength(2);
    expect(page.page.hasMore).toBe(false);
  });

  it('busca en id y en título sin distinguir mayúsculas, y pagina lo encontrado', async () => {
    const lines = [
      HEADER,
      'Z-1\tMarca\tZapatilla roja\t1 EUR',
      'G-1\tMarca\tGorra\t1 EUR',
      'Z-2\tMarca\tZAPATILLA azul\t1 EUR',
      'X-9\tzapatilla\tCalcetín\t1 EUR',
      'z-3\tMarca\tBota\t1 EUR',
    ];

    const byTitle = await readTsvPage(tsv(...lines), {
      ...firstPage,
      search: 'zapatilla',
    });
    const byId = await readTsvPage(tsv(...lines), {
      ...firstPage,
      search: 'z-',
    });
    const secondMatch = await readTsvPage(tsv(...lines), {
      limit: 1,
      offset: 1,
      search: 'zapatilla',
    });

    // La marca no cuenta: solo id y título.
    expect(byTitle.products.map((product) => product.values.id)).toEqual([
      'Z-1',
      'Z-2',
    ]);
    expect(byId.products.map((product) => product.values.id)).toEqual([
      'Z-1',
      'Z-2',
      'z-3',
    ]);
    expect(secondMatch.products.map((product) => product.line)).toEqual([4]);
    expect(secondMatch.page.hasMore).toBe(false);
  });

  it('una búsqueda vacía no filtra', async () => {
    const page = await readTsvPage(tsv(HEADER, ...products(3)), {
      ...firstPage,
      search: '',
    });

    expect(page.products).toHaveLength(3);
  });

  it('una línea con otro número de campos es un archivo dañado', async () => {
    await expect(
      readTsvPage(tsv(HEADER, 'A1\tMarca\tSolo tres'), firstPage),
    ).rejects.toThrow('La línea 2 del TSV no tiene el número de campos');
  });

  it('un archivo vacío no tiene columnas ni productos', async () => {
    const page = await readTsvPage(Readable.from([]), firstPage);

    expect(page).toEqual({
      columns: [],
      products: [],
      page: { limit: 20, offset: 0, hasMore: false },
    });
  });

  it('deja de leer al llenar la página y cierra el archivo', async () => {
    let produced = 0;
    async function* endless() {
      yield `${HEADER}\n`;
      for (;;) {
        produced += 1;
        yield `SKU-${produced}\tMarca\tProducto\t1 EUR\n`;
      }
    }
    const content = Readable.from(endless());

    const page = await readTsvPage(content, { limit: 3, offset: 2 });

    expect(page.products.map((product) => product.line)).toEqual([4, 5, 6]);
    expect(page.page.hasMore).toBe(true);
    expect(content.destroyed).toBe(true);
    // Lee lo justo (página + una), con el margen del búfer del stream.
    expect(produced).toBeLessThan(100);
  });
});

describe('findTsvProduct', () => {
  it('devuelve el producto con ese id, su línea y las columnas', async () => {
    const found = await findTsvProduct(tsv(HEADER, ...products(5)), 'SKU-3');

    expect(found).toEqual({
      columns: ['id', 'brand', 'title', 'price'],
      product: {
        line: 4,
        values: {
          id: 'SKU-3',
          brand: 'Marca',
          title: 'Producto 3',
          price: '9.99 EUR',
        },
      },
    });
  });

  it('el id tiene que ser exacto: ni otra caja, ni un trozo, ni el título', async () => {
    for (const productId of ['sku-3', 'SKU-', 'SKU-33', 'Producto 3', '']) {
      const found = await findTsvProduct(
        tsv(HEADER, ...products(5)),
        productId,
      );

      expect(found.product).toBeNull();
      expect(found.columns).toEqual(['id', 'brand', 'title', 'price']);
    }
  });

  it('acepta ids con barras, espacios y signos', async () => {
    const found = await findTsvProduct(
      tsv(HEADER, 'A/1 ñ?&=#\tMarca\tMesa\t1.00 EUR'),
      'A/1 ñ?&=#',
    );

    expect(found.product?.line).toBe(2);
  });

  it('deja de leer al encontrarlo y cierra el archivo', async () => {
    let produced = 0;
    function* lines() {
      yield `${HEADER}\n`;
      for (const line of products(5_000)) {
        produced += 1;
        yield `${line}\n`;
      }
    }
    const content = Readable.from(lines());

    const found = await findTsvProduct(content, 'SKU-2');

    expect(found.product?.values.id).toBe('SKU-2');
    expect(produced).toBeLessThan(5_000);
    expect(content.destroyed).toBe(true);
  });

  it('un archivo sin productos o vacío no tiene el producto', async () => {
    expect(await findTsvProduct(tsv(HEADER), 'SKU-1')).toEqual({
      columns: ['id', 'brand', 'title', 'price'],
      product: null,
    });
    expect(await findTsvProduct(Readable.from([]), 'SKU-1')).toEqual({
      columns: [],
      product: null,
    });
  });

  it('una línea dañada antes del producto es un error del archivo', async () => {
    await expect(
      findTsvProduct(tsv(HEADER, 'A1\tsolo dos', ...products(2)), 'SKU-1'),
    ).rejects.toThrow('La línea 2 del TSV');
  });
});
