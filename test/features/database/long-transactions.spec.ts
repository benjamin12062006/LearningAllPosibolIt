import { describe, expect, it } from '@jest/globals';
import { ChangesetsRepository } from '../../../src/changesets/changesets.repository.js';
import type { PrismaService } from '../../../src/database/prisma.service.js';
import {
  LONG_TRANSACTION,
  LONG_TRANSACTION_TIMEOUT_MS,
} from '../../../src/database/transaction-timeouts.js';
import { WorksheetImportsRepository } from '../../../src/worksheet-imports/worksheet-imports.repository.js';

const SCOPE = { organizationId: 'org', projectId: 'project' };
const HEAD = { id: 'rev', sequence: 1, schemaVersion: 1, rowCount: 0 };

/**
 * Un Prisma que solo apunta con qué opciones se abre cada transacción y no
 * ejecuta nada: aquí importa el plazo, no lo que hace la transacción.
 */
function recordingPrisma() {
  const options: unknown[] = [];
  const prisma = {
    $transaction: async (_work: unknown, transactionOptions?: unknown) => {
      options.push(transactionOptions);
      throw new Error('solo se apunta');
    },
  };
  // Los repositorios solo llaman a `$transaction` en estos métodos.
  return { prisma: prisma as unknown as PrismaService, options };
}

async function optionsOf(call: (prisma: PrismaService) => Promise<unknown>) {
  const { prisma, options } = recordingPrisma();
  await expect(call(prisma)).rejects.toThrow('solo se apunta');
  return options;
}

describe('Plazo de las transacciones con un borrador entero (C4 del plan de cierre)', () => {
  it('es de 30 s: más de cuatro veces la peor transacción medida', () => {
    expect(LONG_TRANSACTION).toEqual({ timeout: 30_000 });
    expect(LONG_TRANSACTION_TIMEOUT_MS).toBeGreaterThan(4 * 7_300);
  });

  it('crear una importación lo usa', async () => {
    const options = await optionsOf((prisma) =>
      new WorksheetImportsRepository(prisma).create('actor', SCOPE, {
        worksheetId: 'sheet',
        head: HEAD,
        title: 'Importación',
        operations: [],
        record: {
          format: 'csv',
          fileHash: 'a'.repeat(64),
          fileBytes: 1,
          options: {},
          report: {},
          excludedRows: [],
          includedHash: 'b'.repeat(64),
        },
        // La transacción no llega a ejecutarse: basta con algo que pase por
        // una importación; el contenido no importa.
      } as never),
    );
    expect(options).toEqual([LONG_TRANSACTION]);
  });

  it.each([
    ['submit', (r: ChangesetsRepository) => r.submit('a', SCOPE, 'c', 1, 'h')],
    ['reopen', (r: ChangesetsRepository) => r.reopen('a', SCOPE, 'c', 1)],
    ['cancel', (r: ChangesetsRepository) => r.cancel('a', SCOPE, 'c')],
    [
      'rebase',
      (r: ChangesetsRepository) =>
        r.rebase('a', SCOPE, 'c', {
          expectedVersion: 1,
          head: HEAD,
          operations: [],
        }),
    ],
    [
      'decide',
      (r: ChangesetsRepository) =>
        r.decide('a', SCOPE, 'c', {
          decision: 'accept',
          contentHash: 'h',
          draftVersion: 1,
          expectedHeadRevisionId: 'rev',
          reason: null,
        }),
    ],
    [
      'apply',
      (r: ChangesetsRepository) =>
        r.apply('a', SCOPE, 'c', {
          idempotencyKey: 'k',
          payloadHash: 'p',
          contentHash: 'h',
          expectedHeadRevisionId: 'rev',
        }),
    ],
    [
      'markConflicted',
      (r: ChangesetsRepository) => r.markConflicted(SCOPE, 'c', 'a'),
    ],
  ])('el borrador: %s lo usa', async (_name, call) => {
    const options = await optionsOf((prisma) =>
      call(new ChangesetsRepository(prisma)),
    );
    expect(options).toEqual([LONG_TRANSACTION]);
  });

  it('crear un borrador a mano y guardarlo con PUT siguen con el plazo de Prisma (como mucho 1 MiB)', async () => {
    const created = await optionsOf((prisma) =>
      new ChangesetsRepository(prisma).create('a', SCOPE, {
        worksheetId: 'sheet',
        title: 'Cambio',
        source: 'manual',
        base: HEAD,
        operations: [],
      }),
    );
    const saved = await optionsOf((prisma) =>
      new ChangesetsRepository(prisma).saveOperations('a', SCOPE, 'c', 1, []),
    );
    expect([...created, ...saved]).toEqual([undefined, undefined]);
  });
});
