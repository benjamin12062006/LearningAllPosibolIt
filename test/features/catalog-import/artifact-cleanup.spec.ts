import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ArtifactCleanupService,
  ORPHAN_MIN_AGE_MS,
} from '../../../src/catalog-import/artifact-cleanup.service.js';
import { ArtifactStore } from '../../../src/artifacts/artifact.store.js';
import type { CatalogImportRepository } from '../../../src/catalog-import/catalog-import.repository.js';
import type { CatalogImportOptions } from '../../../src/catalog-import/import.types.js';

describe('Limpieza de archivos sin referencia', () => {
  let root: string;
  let options: CatalogImportOptions;
  let store: ArtifactStore;
  let referenced: Set<string>;
  let cleanup: ArtifactCleanupService;
  const referencedKey = '00000000-0000-4000-8000-000000000001.csv';
  const orphanKey = '00000000-0000-4000-8000-000000000002.csv';
  const recentOrphanKey = '00000000-0000-4000-8000-000000000003.csv';
  const now = Date.now();

  async function writeArtifact(key: string, modifiedAt: number) {
    const path = join(root, 'artifacts', key);
    await writeFile(path, 'id\n1\n');
    await utimes(path, modifiedAt / 1000, modifiedAt / 1000);
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'catalog-cleanup-'));
    options = { autoStart: true, pollMs: 1000, shutdownMs: 1000 };
    store = new ArtifactStore({ root });
    await store.onModuleInit();
    referenced = new Set([referencedKey]);
    const repository = {
      findReferencedArtifactKeys: async (keys: string[]) =>
        new Set(keys.filter((key) => referenced.has(key))),
    } as unknown as CatalogImportRepository;
    cleanup = new ArtifactCleanupService(store, repository, options);

    const old = now - ORPHAN_MIN_AGE_MS - 1000;
    await writeArtifact(referencedKey, old);
    await writeArtifact(orphanKey, old);
    await writeArtifact(recentOrphanKey, now - 1000);
    await writeFile(join(root, 'artifacts', 'nota.txt'), 'no es un artefacto');
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('borra solo los artefactos antiguos que ningún snapshot referencia', async () => {
    await expect(cleanup.removeOrphanArtifacts(now)).resolves.toBe(1);
    expect((await readdir(join(root, 'artifacts'))).sort()).toEqual(
      [referencedKey, recentOrphanKey, 'nota.txt'].sort(),
    );
  });

  it('al arrancar no se ejecuta sin autoStart y un fallo no impide arrancar', async () => {
    const disabled = new ArtifactCleanupService(
      store,
      {} as CatalogImportRepository,
      { ...options, autoStart: false },
    );
    await expect(disabled.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(await readdir(join(root, 'artifacts'))).toHaveLength(4);

    const failing = new ArtifactCleanupService(
      store,
      {
        findReferencedArtifactKeys: async () => {
          throw new Error('Base inaccesible');
        },
      } as unknown as CatalogImportRepository,
      options,
    );
    const logError = jest
      .spyOn(failing['logger'], 'error')
      .mockImplementation(() => undefined);
    await expect(failing.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledWith({
      code: 'IMPORT_ORPHAN_CLEANUP_FAILED',
    });
    expect(await readdir(join(root, 'artifacts'))).toHaveLength(4);
  });
});
