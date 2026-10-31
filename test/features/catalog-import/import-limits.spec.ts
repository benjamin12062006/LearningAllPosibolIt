import { describe, expect, it } from '@jest/globals';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { IMPORT_LIMITS } from '../../../src/catalog-import/import.types.js';

describe('Límites de importación', () => {
  it('IMPORT_LIMITS coincide con los CHECK de la migración (cambiar uno exige cambiar el otro)', async () => {
    const sql = await readFile(
      resolve(
        'prisma/migrations/20261026000100_create_catalog_import/migration.sql',
      ),
      'utf8',
    );
    expect(sql).toContain(`row_count BETWEEN 1 AND ${IMPORT_LIMITS.rows}`);
    expect(sql).toContain(`byte_size BETWEEN 0 AND ${IMPORT_LIMITS.fileBytes}`);
  });
});
