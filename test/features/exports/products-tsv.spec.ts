import { describe, expect, it } from '@jest/globals';
import {
  hasTabOrLineBreak,
  startsWithQuote,
} from '../../../src/evaluations/engine/google-merchant.profile.js';
import {
  buildProductsTsv,
  type ExportableRow,
} from '../../../src/exports/products-tsv.js';

const REQUIRED_VALUES = {
  title: 'Mesa de roble',
  description: 'Mesa de comedor de roble macizo',
  link: 'https://tienda.test/mesa',
  image_link: 'https://tienda.test/mesa.jpg',
  price: '15.00 USD',
  availability: 'in_stock',
};

const TABLE: ExportableRow = {
  externalId: '00123',
  values: { ...REQUIRED_VALUES, brand: 'Robles' },
};

const CHAIR: ExportableRow = {
  externalId: '00124',
  values: {
    ...REQUIRED_VALUES,
    title: 'Silla',
    condition: 'new',
  },
};

const REQUIRED_HEADER =
  'title\tdescription\tlink\timage_link\tprice\tavailability';

/** Cada carácter que Google no admite dentro de un valor (D5). */
const REJECTED_CHARACTERS = [
  '\t',
  '\n',
  '\r',
  '\v',
  '\f',
  '\u0085',
  '\u2028',
  '\u2029',
];

function linesOf(content: Buffer) {
  return content.toString('utf8').split('\n');
}

describe('buildProductsTsv', () => {
  it('escribe id, los opcionales con valor y los obligatorios, en ese orden', () => {
    const tsv = buildProductsTsv([TABLE, CHAIR]);

    expect(linesOf(tsv.content)[0]).toBe(
      `id\tcondition\tbrand\t${REQUIRED_HEADER}`,
    );
  });

  it('omite los opcionales sin valor en ninguna fila, también si solo tienen espacios', () => {
    const withBlankBrand: ExportableRow = {
      externalId: '1',
      values: { ...REQUIRED_VALUES, brand: '   ' },
    };

    const tsv = buildProductsTsv([withBlankBrand]);

    expect(linesOf(tsv.content)[0]).toBe(`id\t${REQUIRED_HEADER}`);
  });

  it('deja vacía la celda de un opcional que falta en una fila', () => {
    const lines = linesOf(buildProductsTsv([TABLE, CHAIR]).content);

    expect(lines[1]).toBe(
      '00123\t\tRobles\tMesa de roble\tMesa de comedor de roble macizo\thttps://tienda.test/mesa\thttps://tienda.test/mesa.jpg\t15.00 USD\tin_stock',
    );
    expect(lines[2]).toBe(
      '00124\tnew\t\tSilla\tMesa de comedor de roble macizo\thttps://tienda.test/mesa\thttps://tienda.test/mesa.jpg\t15.00 USD\tin_stock',
    );
  });

  it('escribe vacío un opcional de solo espacios cuando la columna existe por otra fila', () => {
    const withTabBrand: ExportableRow = {
      externalId: '00125',
      values: { ...REQUIRED_VALUES, brand: '\t' },
    };

    const lines = linesOf(buildProductsTsv([TABLE, withTabBrand]).content);

    expect(lines[2].split('\t').slice(0, 2)).toEqual(['00125', '']);
    expect(lines[2].split('\t')).toHaveLength(8);
  });

  it('ninguna línea termina en tabulador y todas tienen los mismos campos', () => {
    const lines = linesOf(buildProductsTsv([TABLE, CHAIR]).content);
    const records = lines.slice(0, -1);

    expect(lines.at(-1)).toBe('');
    for (const record of records) {
      expect(record.endsWith('\t')).toBe(false);
      expect(record.split('\t')).toHaveLength(9);
    }
  });

  it('termina con un único fin de línea y cuenta los productos', () => {
    const tsv = buildProductsTsv([TABLE, CHAIR]);
    const text = tsv.content.toString('utf8');

    expect(text.endsWith('in_stock\n')).toBe(true);
    expect(text.includes('\r')).toBe(false);
    expect(tsv.rowCount).toBe(2);
  });

  it('es UTF-8 sin BOM', () => {
    const withAccent: ExportableRow = {
      externalId: 'é-1',
      values: REQUIRED_VALUES,
    };

    const tsv = buildProductsTsv([withAccent]);

    expect(tsv.content.subarray(0, 2).toString('utf8')).toBe('id');
    expect(tsv.content.includes(Buffer.from('é-1', 'utf8'))).toBe(true);
  });

  it('conserva el precio normalizado y los ceros iniciales del id', () => {
    const fields = linesOf(buildProductsTsv([TABLE]).content)[1].split('\t');

    expect(fields[0]).toBe('00123');
    expect(fields).toContain('15.00 USD');
  });

  it('acepta una comilla que no está al principio', () => {
    const quoted: ExportableRow = {
      externalId: '1',
      values: { ...REQUIRED_VALUES, title: 'Mesa "grande"' },
    };

    expect(linesOf(buildProductsTsv([quoted]).content)[1]).toContain(
      'Mesa "grande"',
    );
  });

  it('la misma entrada produce los mismos bytes', () => {
    const first = buildProductsTsv([TABLE, CHAIR]).content;
    const second = buildProductsTsv([TABLE, CHAIR]).content;

    expect(first.equals(second)).toBe(true);
  });

  describe('rechaza lo que indica un error del backend', () => {
    it('sin productos', () => {
      expect(() => buildProductsTsv([])).toThrow(
        'Un TSV de productos necesita al menos un producto.',
      );
    });

    it('un producto sin un atributo obligatorio', () => {
      const withoutPrice: ExportableRow = {
        externalId: '1',
        values: { ...REQUIRED_VALUES, price: '' },
      };

      expect(() => buildProductsTsv([withoutPrice])).toThrow(
        'Falta el atributo obligatorio price en un producto válido.',
      );
    });

    it.each(REJECTED_CHARACTERS)(
      'un valor con el carácter %j, sin copiarlo en el mensaje',
      (character) => {
        for (const row of rowsContaining(`Mesa${character}roble`)) {
          expect(() => buildProductsTsv([row])).toThrow(
            'Un valor no se puede escribir en el TSV sin escaparlo.',
          );
        }
      },
    );

    it('un valor que empieza por comilla', () => {
      for (const row of rowsContaining('"Mesa" de roble')) {
        expect(() => buildProductsTsv([row])).toThrow(
          'Un valor no se puede escribir en el TSV sin escaparlo.',
        );
      }
    });
  });

  it('mide 5.000 productos', () => {
    const rows = Array.from({ length: 5000 }, (_, index) => ({
      externalId: `SKU-${String(index).padStart(5, '0')}`,
      values: {
        ...REQUIRED_VALUES,
        title: `Mesa de roble ${index}`,
        description: 'Mesa de comedor de roble macizo. '.repeat(6),
        brand: 'Robles',
      },
    }));

    const started = performance.now();
    const tsv = buildProductsTsv(rows);
    const durationMs = Math.round(performance.now() - started);

    expect(linesOf(tsv.content)).toHaveLength(5000 + 2);
    process.stdout.write(
      `${JSON.stringify({
        benchmark: 'products-tsv-5000-rows',
        durationMs,
        bytes: tsv.content.length,
      })}\n`,
    );
  });
});

describe('caracteres que no caben en un TSV', () => {
  it.each(REJECTED_CHARACTERS)(
    '%j es tabulador o salto de línea',
    (character) => {
      expect(hasTabOrLineBreak(`a${character}b`)).toBe(true);
    },
  );

  it('un espacio normal no lo es', () => {
    expect(hasTabOrLineBreak('Mesa de roble')).toBe(false);
  });

  it('solo una comilla inicial cuenta', () => {
    expect(startsWithQuote('"Mesa"')).toBe(true);
    expect(startsWithQuote('Mesa "grande"')).toBe(false);
    expect(startsWithQuote(' "Mesa"')).toBe(false);
  });
});

/** El mismo valor en cada columna de texto libre: id, title, description y brand. */
function rowsContaining(value: string): ExportableRow[] {
  return [
    { externalId: value, values: REQUIRED_VALUES },
    { externalId: '1', values: { ...REQUIRED_VALUES, title: value } },
    { externalId: '1', values: { ...REQUIRED_VALUES, description: value } },
    { externalId: '1', values: { ...REQUIRED_VALUES, brand: value } },
  ];
}
