import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { createHash } from 'node:crypto';
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

const EXPORT_KEY = /^[0-9a-f-]{36}\.tsv$/;
const IMPORT_KEY = '00000000-0000-4000-8000-000000000001.csv';
const OTHER_EXPORT_KEY = '00000000-0000-4000-8000-000000000002.tsv';
const TSV = Buffer.from('id\ttitle\nSKU-1\tMesa\n', 'utf8');

describe('ArtifactStore: TSV de las exportaciones', () => {
  let root: string;
  let store: ArtifactStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'artifact-exports-'));
    store = new ArtifactStore({ root });
    await store.onModuleInit();
  });
  afterEach(async () => {
    await chmod(join(root, 'exports'), 0o700).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });

  it('crea la carpeta exports con permisos solo para el propietario', async () => {
    const info = await stat(join(root, 'exports'));

    expect(info.mode & 0o777).toBe(0o700);
  });

  it('guarda el TSV en exports y devuelve clave, tamaño y SHA-256', async () => {
    const written = await store.writeExport(TSV);

    expect(written.key).toMatch(EXPORT_KEY);
    expect(written.byteSize).toBe(TSV.length);
    expect(written.checksum).toBe(
      createHash('sha256').update(TSV).digest('hex'),
    );
    expect(await readFile(join(root, 'exports', written.key))).toEqual(TSV);
  });

  it('el archivo es privado y no deja nada en tmp', async () => {
    const written = await store.writeExport(TSV);
    const info = await stat(join(root, 'exports', written.key));

    expect(info.mode & 0o777).toBe(0o600);
    expect(await readdir(join(root, 'tmp'))).toEqual([]);
  });

  it('cada escritura usa una clave nueva', async () => {
    const first = await store.writeExport(TSV);
    const second = await store.writeExport(TSV);

    expect(first.key).not.toBe(second.key);
    expect((await readdir(join(root, 'exports'))).sort()).toEqual(
      [first.key, second.key].sort(),
    );
  });

  it('si no puede enlazar en exports, borra el temporal', async () => {
    await chmod(join(root, 'exports'), 0o500);

    await expect(store.writeExport(TSV)).rejects.toMatchObject({
      code: 'EACCES',
    });
    expect(await readdir(join(root, 'tmp'))).toEqual([]);
  });

  it('si lo guardado no coincide con lo generado, lo borra y falla', async () => {
    // Un tamaño falso basta para que la verificación no coincida: se escriben
    // los bytes reales, pero se espera uno más.
    const content = Buffer.from(TSV);
    Object.defineProperty(content, 'length', { value: TSV.length + 1 });

    await expect(store.writeExport(content)).rejects.toThrow(
      'El archivo guardado no coincide con el generado.',
    );
    expect(await readdir(join(root, 'exports'))).toEqual([]);
    expect(await readdir(join(root, 'tmp'))).toEqual([]);
  });

  it('lista solo los TSV de exports, con su fecha', async () => {
    const written = await store.writeExport(TSV);
    await writeFile(join(root, 'exports', IMPORT_KEY), 'csv fuera de sitio');
    await writeFile(join(root, 'exports', 'nota.txt'), 'no es un artefacto');

    const listed = await store.listExports();

    expect(listed.map((artifact) => artifact.key)).toEqual([written.key]);
    expect(listed[0].modifiedAt).toBeGreaterThan(0);
  });

  it('borra un TSV y no falla si ya no existe', async () => {
    const written = await store.writeExport(TSV);

    await store.removeExport(written.key);
    await store.removeExport(written.key);

    expect(await readdir(join(root, 'exports'))).toEqual([]);
  });

  describe('abrir un TSV para descargarlo', () => {
    async function readAll(stream: NodeJS.ReadableStream) {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    }

    it('devuelve el contenido guardado', async () => {
      const written = await store.writeExport(TSV);

      expect(await readAll(await store.openExport(written.key))).toEqual(TSV);
    });

    it('si falta el archivo, falla al abrir con ENOENT', async () => {
      await expect(store.openExport(OTHER_EXPORT_KEY)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    });

    it('no abre claves de otra carpeta ni que salen de exports', async () => {
      for (const key of [IMPORT_KEY, '../artifacts/x.tsv']) {
        await expect(store.openExport(key)).rejects.toThrow(
          'Clave de artefacto inválida.',
        );
      }
    });
  });

  describe('cada carpeta solo acepta su tipo de clave', () => {
    it('las importaciones no leen ni borran TSV', async () => {
      expect(() => store.openRead(OTHER_EXPORT_KEY)).toThrow(
        'Clave de artefacto inválida.',
      );
      await expect(store.removeArtifact(OTHER_EXPORT_KEY)).rejects.toThrow(
        'Clave de artefacto inválida.',
      );
    });

    it('las exportaciones no borran CSV ni claves que salen de su carpeta', async () => {
      for (const key of [IMPORT_KEY, '../artifacts/x.tsv', 'nota.txt']) {
        await expect(store.removeExport(key)).rejects.toThrow(
          'Clave de artefacto inválida.',
        );
      }
    });

    it('tmp acepta los dos tipos', async () => {
      await expect(store.removeTemporary(IMPORT_KEY)).resolves.toBeUndefined();
      await expect(
        store.removeTemporary(OTHER_EXPORT_KEY),
      ).resolves.toBeUndefined();
    });

    it('listar importaciones ignora los TSV', async () => {
      await store.writeExport(TSV);
      await writeFile(join(root, 'artifacts', OTHER_EXPORT_KEY), 'tsv fuera');

      expect(await store.listArtifacts()).toEqual([]);
    });
  });
});
