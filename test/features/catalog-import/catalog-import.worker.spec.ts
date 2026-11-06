import { describe, expect, it, jest } from '@jest/globals';
import { Readable } from 'node:stream';
import { Test } from '@nestjs/testing';
import { CatalogImportWorker } from '../../../src/catalog-import/catalog-import.worker.js';
import { CatalogImportRepository } from '../../../src/catalog-import/catalog-import.repository.js';
import { ArtifactStore } from '../../../src/artifacts/artifact.store.js';
import type { ClaimedImport } from '../../../src/catalog-import/import.types.js';
import { CATALOG_IMPORT_OPTIONS } from '../../../src/catalog-import/import.types.js';

describe('Cierre del worker', () => {
  it('aborta un stream activo al vencer el plazo y lo devuelve a la cola sin reclamar otro trabajo', async () => {
    let markEntered: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const job: ClaimedImport = {
      id: 'job',
      snapshotId: 'snapshot',
      projectId: 'project',
      requestId: 'request',
      artifactKey: 'key',
      sourceHash: 'hash',
      byteSize: 0,
      idColumn: 'id',
      delimiter: 'comma',
      token: 'token',
      attempts: 0,
      leaseMs: 60_000,
    };
    const repository: jest.Mocked<
      Pick<
        CatalogImportRepository,
        'recoverExpiredLeases' | 'claim' | 'release' | 'fail'
      >
    > = {
      recoverExpiredLeases: jest
        .fn<CatalogImportRepository['recoverExpiredLeases']>()
        .mockResolvedValue(0),
      claim: jest.fn<CatalogImportRepository['claim']>().mockResolvedValue(job),
      release: jest
        .fn<CatalogImportRepository['release']>()
        .mockResolvedValue(true),
      fail: jest.fn<CatalogImportRepository['fail']>().mockResolvedValue(true),
    };
    const store: Pick<ArtifactStore, 'openRead'> = {
      openRead(_key, signal) {
        markEntered();
        return new Readable({ read() {}, signal });
      },
    };
    // Los métodos no usados no se simulan: el cierre solo reclama, lee y suelta.
    const module = await Test.createTestingModule({
      providers: [
        CatalogImportWorker,
        { provide: CatalogImportRepository, useValue: repository },
        { provide: ArtifactStore, useValue: store },
        {
          provide: CATALOG_IMPORT_OPTIONS,
          useValue: {
            autoStart: false,
            pollMs: 1000,
            shutdownMs: 1,
          },
        },
      ],
    }).compile();
    const worker = module.get(CatalogImportWorker);
    const processing = worker.runUntilIdle();
    await entered;
    await worker.onModuleDestroy();
    await processing;
    expect(repository.release).toHaveBeenCalledWith(job);
    expect(repository.fail).not.toHaveBeenCalled();
    expect(repository.claim).toHaveBeenCalledTimes(1);
    await module.close();
  });
});
