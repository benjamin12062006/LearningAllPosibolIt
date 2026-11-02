import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { ArtifactStore } from '../../../src/artifacts/artifact.store.js';
import { IMPORT_LIMITS } from '../../../src/catalog-import/import.types.js';

describe('ArtifactStore privado real', () => {
  let root: string;
  let store: ArtifactStore;
  const key = '00000000-0000-4000-8000-000000000001.csv';
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'catalog-store-'));
    store = new ArtifactStore({ root });
    await store.onModuleInit();
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('finaliza sin usar nombre del cliente, con checksum y permisos privados', async () => {
    const upload = await store.receive(
      Readable.from([Buffer.from('id\n000123\n')]),
    );
    await store.finalize(upload.filename, key);
    expect(await readFile(join(root, 'artifacts', key), 'utf8')).toBe(
      'id\n000123\n',
    );
    expect(upload).toMatchObject({
      size: 10,
      hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect((await stat(join(root, 'artifacts', key))).mode & 0o777).toBe(0o600);
    expect(await readdir(join(root, 'tmp'))).toEqual([]);
  });

  it('una colisión forzada no sobrescribe el primer archivo', async () => {
    const first = await store.receive(Readable.from([Buffer.from('primero')]));
    await store.finalize(first.filename, key);
    const second = await store.receive(Readable.from([Buffer.from('segundo')]));
    await expect(store.finalize(second.filename, key)).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect(await readFile(join(root, 'artifacts', key), 'utf8')).toBe(
      'primero',
    );
    await store.removeTemporary(second.filename);
  });

  it('acepta exactamente 10 MiB y elimina el temporal al superar ese límite', async () => {
    const accepted = await store.receive(
      Readable.from([Buffer.alloc(IMPORT_LIMITS.fileBytes)]),
    );
    expect(accepted.size).toBe(IMPORT_LIMITS.fileBytes);
    await store.removeTemporary(accepted.filename);
    await expect(
      store.receive(Readable.from([Buffer.alloc(IMPORT_LIMITS.fileBytes + 1)])),
    ).rejects.toMatchObject({ detail: { code: 'IMPORT_FILE_TOO_LARGE' } });
    expect(await readdir(join(root, 'tmp'))).toEqual([]);
  });

  it('rechaza rutas externas como claves de artefacto', () => {
    expect(() => store.openRead('../../outside')).toThrow(
      'Clave de artefacto inválida',
    );
  });

  it('retira el temporal y cierra el descriptor al abortar la recepción', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      store.receive(Readable.from([Buffer.from('contenido')]), abort.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(await readdir(join(root, 'tmp'))).toEqual([]);
  });
});
