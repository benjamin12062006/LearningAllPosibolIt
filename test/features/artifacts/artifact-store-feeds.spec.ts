import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import {
  chmod,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '../../../src/artifacts/artifact.store.js';

const VERSION_KEY = '00000000-0000-4000-8000-000000000010.tsv';
const OTHER_VERSION_KEY = '00000000-0000-4000-8000-000000000011.tsv';
const TSV = Buffer.from('id\ttitle\nSKU-1\tMesa\n', 'utf8');

describe('ArtifactStore: archivos de las versiones del feed', () => {
  let root: string;
  let store: ArtifactStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'artifact-feeds-'));
    store = new ArtifactStore({ root });
    await store.onModuleInit();
  });
  afterEach(async () => {
    await chmod(join(root, 'feeds'), 0o700).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });

  async function exported() {
    return store.writeExport(TSV);
  }

  it('crea la carpeta feeds con permisos solo para el propietario', async () => {
    const info = await stat(join(root, 'feeds'));

    expect(info.mode & 0o777).toBe(0o700);
  });

  it('enlaza el TSV de la exportación como archivo de la versión, sin copiarlo', async () => {
    const written = await exported();

    const linked = await store.linkFeedVersion(written.key, VERSION_KEY, {
      byteSize: written.byteSize,
      checksum: written.checksum,
    });

    expect(linked).toEqual({
      key: VERSION_KEY,
      byteSize: written.byteSize,
      checksum: written.checksum,
    });
    const exportInfo = await stat(join(root, 'exports', written.key));
    const versionInfo = await stat(join(root, 'feeds', VERSION_KEY));
    expect(versionInfo.ino).toBe(exportInfo.ino);
    expect(versionInfo.nlink).toBe(2);
    expect(versionInfo.mode & 0o777).toBe(0o600);
  });

  it('borrar la exportación no borra el archivo de la versión (F30)', async () => {
    const written = await exported();
    await store.linkFeedVersion(written.key, VERSION_KEY, written);

    await store.removeExport(written.key);

    expect(await readFile(join(root, 'feeds', VERSION_KEY))).toEqual(TSV);
  });

  it('no reemplaza una versión que ya existe con esa clave', async () => {
    const written = await exported();
    await writeFile(join(root, 'feeds', VERSION_KEY), 'otro');

    await expect(
      store.linkFeedVersion(written.key, VERSION_KEY, written),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(join(root, 'feeds', VERSION_KEY), 'utf8')).toBe(
      'otro',
    );
  });

  it('si la exportación no tiene archivo, falla con ENOENT y no deja nada', async () => {
    const written = await exported();
    await store.removeExport(written.key);

    await expect(
      store.linkFeedVersion(written.key, VERSION_KEY, written),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(join(root, 'feeds'))).toEqual([]);
  });

  it('si el archivo no coincide con lo esperado, retira el enlace y falla', async () => {
    const written = await exported();

    await expect(
      store.linkFeedVersion(written.key, VERSION_KEY, {
        byteSize: written.byteSize,
        checksum: '0'.repeat(64),
      }),
    ).rejects.toThrow('El archivo guardado no coincide con el generado.');
    expect(await readdir(join(root, 'feeds'))).toEqual([]);
    expect(await readFile(join(root, 'exports', written.key))).toEqual(TSV);
  });

  it('una exportación puede dar archivo a varias versiones', async () => {
    const written = await exported();

    await store.linkFeedVersion(written.key, VERSION_KEY, written);
    await store.linkFeedVersion(written.key, OTHER_VERSION_KEY, written);

    expect((await readdir(join(root, 'feeds'))).sort()).toEqual(
      [VERSION_KEY, OTHER_VERSION_KEY].sort(),
    );
  });

  it('abre el archivo de una versión antes de leerlo y lo lista para la limpieza', async () => {
    const written = await exported();
    await store.linkFeedVersion(written.key, VERSION_KEY, written);

    const stream = await store.openFeedVersion(VERSION_KEY);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);

    expect(Buffer.concat(chunks)).toEqual(TSV);
    expect(await store.listFeedVersions()).toEqual([
      { key: VERSION_KEY, modifiedAt: expect.any(Number) },
    ]);
  });

  it('abrir una versión sin archivo falla al abrir, con ENOENT', async () => {
    await expect(store.openFeedVersion(VERSION_KEY)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('borrar una versión que ya no existe no es un error', async () => {
    await expect(store.removeFeedVersion(VERSION_KEY)).resolves.toBeUndefined();
  });

  it('rechaza claves que podrían salir de la carpeta', async () => {
    const written = await exported();

    await expect(
      store.linkFeedVersion(written.key, '../exports/x.tsv', written),
    ).rejects.toThrow('Clave de artefacto inválida.');
    await expect(store.removeFeedVersion('x.csv')).rejects.toThrow(
      'Clave de artefacto inválida.',
    );
  });
});
