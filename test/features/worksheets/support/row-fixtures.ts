import type { Pool } from 'pg';
import type { Worksheet } from '../../../../src/worksheets/worksheets.types.js';

/**
 * Filas preparadas con SQL directo: todavía no hay ruta que escriba filas (las
 * escribirá el apply de E4). Dos revisiones:
 *
 * - Revisión 1: A, B, C y D.
 * - Revisión 2: B cambia de precio, C se borra (tombstone) y entra E.
 */
export const ROW_IDS = {
  a: '00000000-0000-4000-8000-0000000000a1',
  b: '00000000-0000-4000-8000-0000000000b1',
  c: '00000000-0000-4000-8000-0000000000c1',
  d: '00000000-0000-4000-8000-0000000000d1',
  e: '00000000-0000-4000-8000-0000000000e1',
} as const;

export const SECOND_REVISION_ID = '00000000-0000-4000-8000-0000000002a2';

/** Columnas de la hoja que espera `seedTwoRevisions`, en este orden. */
export const FIXTURE_COLUMNS = [
  { name: 'SKU', type: 'text' },
  { name: 'Precio', type: 'decimal' },
  { name: 'Cantidad', type: 'integer' },
  { name: 'Alta', type: 'date' },
  { name: 'Activo', type: 'boolean' },
] as const;

export type FixtureColumnIds = Readonly<{
  sku: string;
  price: string;
  quantity: string;
  since: string;
  active: string;
}>;

export function columnIdsOf(worksheet: Worksheet): FixtureColumnIds {
  const [sku, price, quantity, since, active] = worksheet.columns.map(
    ({ id }) => id,
  );
  return { sku, price, quantity, since, active };
}

export async function seedTwoRevisions(
  pool: Pool,
  worksheet: Worksheet,
  organizationId: string,
  createdBy: string,
) {
  const c = columnIdsOf(worksheet);
  const insert = (
    rowId: string,
    from: number,
    to: number | null,
    sortKey: string,
    values: Record<string, unknown>,
    isDeleted = false,
  ) =>
    pool.query(
      `INSERT INTO estadistica_forms.worksheet_row_versions
         (organization_id, worksheet_id, row_id, from_sequence, to_sequence,
          sort_key, cell_values, is_deleted)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        organizationId,
        worksheet.id,
        rowId,
        from,
        to,
        sortKey,
        JSON.stringify(values),
        isDeleted,
      ],
    );

  await pool.query(
    `INSERT INTO estadistica_forms.worksheet_revisions
       (id, organization_id, worksheet_id, sequence, schema_version, source,
        row_count, created_by, created_at)
     VALUES ($1, $2, $3, 2, 1, 'changeset', 4, $4, '2026-11-04T12:00:00.000Z')`,
    [SECOND_REVISION_ID, organizationId, worksheet.id, createdBy],
  );

  await insert(ROW_IDS.a, 1, null, 'a', {
    [c.sku]: 'A-001',
    [c.price]: '10.50',
    [c.quantity]: '3',
    [c.since]: '2026-01-05',
    [c.active]: true,
  });
  // B: el precio cambia en la revisión 2. Cantidad no tiene clave: es null.
  await insert(ROW_IDS.b, 1, 2, 'b', {
    [c.sku]: 'B-002',
    [c.price]: '9.99',
    [c.since]: '2026-02-01',
    [c.active]: false,
  });
  await insert(ROW_IDS.b, 2, null, 'b', {
    [c.sku]: 'B-002',
    [c.price]: '12.00',
    [c.since]: '2026-02-01',
    [c.active]: false,
  });
  // C: texto vacío, que no es null; se borra en la revisión 2.
  await insert(ROW_IDS.c, 1, 2, 'c', {
    [c.sku]: '',
    [c.price]: '100',
    [c.quantity]: '0',
  });
  await insert(ROW_IDS.c, 2, null, 'c', {}, true);
  // D: comodines en el texto y un precio mal guardado que debe leerse null.
  await insert(ROW_IDS.d, 1, null, 'd', {
    [c.sku]: '50%_off',
    [c.price]: 'abc',
    [c.quantity]: '7',
  });
  await insert(ROW_IDS.e, 2, null, 'e', {
    [c.sku]: 'E-005',
    [c.price]: '1.5',
  });

  await pool.query(
    `UPDATE estadistica_forms.worksheet_revisions SET row_count = 4
     WHERE worksheet_id = $1 AND sequence = 1`,
    [worksheet.id],
  );
  await pool.query(
    `UPDATE estadistica_forms.worksheets
     SET head_revision_id = $2, generation = 2
     WHERE id = $1`,
    [worksheet.id, SECOND_REVISION_ID],
  );
}
