import { describe, expect, it, jest } from '@jest/globals';
import type { PrismaService } from '../../../src/database/prisma.service.js';
import { Prisma } from '../../../src/generated/prisma/client.js';
import {
  WorksheetRowsRepository,
  type StoredRow,
} from '../../../src/worksheets/worksheet-rows.repository.js';

const SCOPE = { organizationId: 'org', projectId: 'project' };

function rowsNamed(count: number): StoredRow[] {
  return Array.from({ length: count }, (_, index) => ({
    rowId: `r${index + 1}`,
    cellValues: {},
  }));
}

/** El repositorio con `findRows` sobre una lista en memoria, paginada como en SQL. */
function repositoryOver(rows: readonly StoredRow[]) {
  // `pagesAt` solo llama a `findRows`: no necesita una base.
  const repository = new WorksheetRowsRepository({} as PrismaService);
  const findRows = jest
    .spyOn(repository, 'findRows')
    .mockImplementation(async ({ page }) =>
      rows.slice(page.offset, page.offset + page.limit),
    );
  return { repository, findRows };
}

async function pagesOf(repository: WorksheetRowsRepository, pageSize: number) {
  const pages: string[][] = [];
  for await (const page of repository.pagesAt({
    scope: SCOPE,
    worksheetId: 'sheet',
    sequence: 3,
    where: Prisma.sql`TRUE`,
    order: Prisma.sql`r.row_id`,
    pageSize,
  })) {
    pages.push(page.map(({ rowId }) => rowId));
  }
  return pages;
}

describe('WorksheetRowsRepository.pagesAt: todas las filas por páginas (E5.3, E5.4)', () => {
  it('recorre todas las páginas sin saltar ni repetir filas', async () => {
    const { repository, findRows } = repositoryOver(rowsNamed(5));

    expect(await pagesOf(repository, 2)).toEqual([
      ['r1', 'r2'],
      ['r3', 'r4'],
      ['r5'],
    ]);
    expect(findRows.mock.calls.map(([request]) => request.page)).toEqual([
      { limit: 2, offset: 0 },
      { limit: 2, offset: 2 },
      { limit: 2, offset: 4 },
    ]);
    expect(findRows.mock.calls[0][0]).toMatchObject({
      scope: SCOPE,
      worksheetId: 'sheet',
      sequence: 3,
    });
  });

  it('con un múltiplo exacto, la última lectura vacía no produce una página', async () => {
    const { repository } = repositoryOver(rowsNamed(4));

    expect(await pagesOf(repository, 2)).toEqual([
      ['r1', 'r2'],
      ['r3', 'r4'],
    ]);
  });

  it('sin filas, ninguna página', async () => {
    const { repository } = repositoryOver([]);

    expect(await pagesOf(repository, 2)).toEqual([]);
  });
});
