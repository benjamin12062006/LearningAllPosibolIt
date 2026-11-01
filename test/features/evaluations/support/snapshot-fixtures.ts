import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Ruleset } from '../../../../src/evaluations/engine/ruleset.js';

/** Cabeceras del CSV de prueba; coinciden con las columnas de `CATALOG_RULESET`. */
export const CATALOG_HEADERS = [
  'SKU',
  'Nombre',
  'Descripción',
  'URL',
  'Imagen',
  'Precio',
  'Stock',
  'Marca',
];

/** Mapeo de `CATALOG_HEADERS` y una regla de cada tipo. */
export const CATALOG_RULESET: Ruleset = {
  mapping: [
    { attribute: 'title', column: 'Nombre' },
    { attribute: 'description', column: 'Descripción' },
    { attribute: 'link', column: 'URL' },
    { attribute: 'image_link', column: 'Imagen' },
    { attribute: 'price', column: 'Precio' },
    { attribute: 'availability', column: 'Stock' },
    { attribute: 'brand', column: 'Marca' },
  ],
  rules: [
    { type: 'clean_text', attributes: ['title', 'brand'] },
    { type: 'build_title', template: '{brand} {title}' },
    {
      type: 'exclude_when',
      attribute: 'brand',
      operator: 'is_empty',
      value: '',
    },
  ],
};

/** Fila de catálogo válida con los valores que cambie cada prueba. */
export function catalogValues(
  sku: string,
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    SKU: sku,
    Nombre: `Mesa ${sku}`,
    Descripción: 'Mesa de roble para seis personas.',
    URL: `https://tienda.example/${sku}`,
    Imagen: `https://tienda.example/${sku}.jpg`,
    Precio: '149.90',
    Stock: 'in_stock',
    Marca: 'Acme',
    ...overrides,
  };
}

/**
 * Inserta por SQL un snapshot `ready` con sus filas, como lo dejaría una
 * importación terminada, sin pasar por el parser ni por el almacenamiento.
 */
export async function insertReadySnapshot(
  pool: Pool,
  projectId: string,
  rows: Record<string, string>[],
  options: { currency?: string; headers?: string[] } = {},
) {
  const snapshotId = randomUUID();
  const configuration = {
    country: 'US',
    currency: options.currency ?? 'USD',
    channelProfile: 'google_merchant',
  };
  await pool.query(
    `INSERT INTO estadistica_forms.catalog_snapshots
       (id, project_id, id_column, delimiter, headers, source_hash, artifact_key,
        byte_size, original_name, project_configuration, status, row_count,
        created_at, finished_at)
     VALUES ($1, $2, 'SKU', 'comma', $3::jsonb, $4, $5, 100, 'catalogo.csv',
             $6::jsonb, 'ready', $7, '2026-11-01T00:00:00.000Z',
             '2026-11-01T00:00:01.000Z')`,
    [
      snapshotId,
      projectId,
      JSON.stringify(options.headers ?? CATALOG_HEADERS),
      'a'.repeat(64),
      `${randomUUID()}.csv`,
      JSON.stringify(configuration),
      rows.length,
    ],
  );
  // Una sola sentencia para todas las filas: con 5.000, una por fila haría que
  // la preparación pesara más que la evaluación que se quiere medir.
  await pool.query(
    `INSERT INTO estadistica_forms.catalog_rows
       (snapshot_id, source_row, external_id, original_values)
     SELECT $1, ordinality, value ->> 'SKU', value
     FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY`,
    [snapshotId, JSON.stringify(rows)],
  );
  return snapshotId;
}

/** Catálogo con una fila de cada resultado: válida, inválida y excluida. */
export function mixedCatalog(size: number) {
  return Array.from({ length: size }, (_, index) => {
    const sku = `SKU-${index + 1}`;
    if (index % 3 === 1) return catalogValues(sku, { Precio: '1,50' });
    if (index % 3 === 2) return catalogValues(sku, { Marca: ' ' });
    return catalogValues(sku);
  });
}
