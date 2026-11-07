import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { createHash } from 'node:crypto';
import {
  appendFile,
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

const CSV_KEY = /^[0-9a-f-]{36}\.csv$/;
const XLSX_KEY = /^[0-9a-f-]{36}\.xlsx$/;
const PARTS = [Buffer.from('sku,precio\r\n'), Buffer.from('007,10.50\r\n')];

describe('ArtifactStore: exportaciones de hojas por trozos (E5.3, D20)', () => {
  let root: string;
  let store: ArtifactStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'artifact-worksheet-exports-'));
    store = new ArtifactStore({ root });
    await store.onModuleInit();
  });
  afterEach(async () => {
    await chmod(join(root, 'worksheet-exports'), 0o700).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });

  it('guarda los trozos en worksheet-exports con tamaño y SHA-256, y devuelve lo que devuelve quien escribe', async () => {
    const { file, result } = await store.writeWorksheetExport(
      'csv',
      async (sink) => {
        for (const part of PARTS) await sink.write(part);
        return { rows: 1 };
      },
    );
    const content = Buffer.concat(PARTS);

    expect(result).toEqual({ rows: 1 });
    expect(file.key).toMatch(CSV_KEY);
    expect(file.byteSize).toBe(content.length);
    expect(file.checksum).toBe(
      createHash('sha256').update(content).digest('hex'),
    );
    expect(await readFile(join(root, 'worksheet-exports', file.key))).toEqual(
      content,
    );
    expect(
      (await stat(join(root, 'worksheet-exports', file.key))).mode & 0o777,
    ).toBe(0o600);
    expect(await readdir(join(root, 'tmp'))).toEqual([]);
  });

  it('la extensión sigue al formato', async () => {
    const { file } = await store.writeWorksheetExport('xlsx', async (sink) => {
      await sink.write(Buffer.from('PK'));
    });
    expect(file.key).toMatch(XLSX_KEY);
  });

  it('si quien escribe falla, no queda nada y el error sigue', async () => {
    const failure = new Error('límite');
    await expect(
      store.writeWorksheetExport('csv', async (sink) => {
        await sink.write(PARTS[0]);
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await readdir(join(root, 'tmp'))).toEqual([]);
    expect(await readdir(join(root, 'worksheet-exports'))).toEqual([]);
  });

  it('si no puede enlazar en worksheet-exports, borra el temporal', async () => {
    await chmod(join(root, 'worksheet-exports'), 0o500);

    await expect(
      store.writeWorksheetExport('csv', async (sink) => {
        await sink.write(PARTS[0]);
      }),
    ).rejects.toMatchObject({ code: 'EACCES' });
    expect(await readdir(join(root, 'tmp'))).toEqual([]);
  });

  it('si lo guardado no coincide con lo escrito, lo borra y falla', async () => {
    // Alguien añade bytes al temporal por detrás: la relectura lo detecta.
    await expect(
      store.writeWorksheetExport('csv', async (sink) => {
        await sink.write(PARTS[0]);
        const [temporary] = await readdir(join(root, 'tmp'));
        await appendFile(join(root, 'tmp', temporary), 'extra');
      }),
    ).rejects.toThrow('El archivo guardado no coincide con el generado.');
    expect(await readdir(join(root, 'worksheet-exports'))).toEqual([]);
    expect(await readdir(join(root, 'tmp'))).toEqual([]);
  });

  it('lista solo sus claves, abre, borra y no falla si ya no existe', async () => {
    const { file } = await store.writeWorksheetExport('csv', async (sink) => {
      await sink.write(PARTS[0]);
    });
    await writeFile(join(root, 'worksheet-exports', 'nota.txt'), 'no');

    expect((await store.listWorksheetExports()).map(({ key }) => key)).toEqual([
      file.key,
    ]);
    const chunks: Buffer[] = [];
    for await (const chunk of await store.openWorksheetExport(file.key)) {
      chunks.push(Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks)).toEqual(PARTS[0]);

    await store.removeWorksheetExport(file.key);
    await store.removeWorksheetExport(file.key);
    expect(await store.listWorksheetExports()).toEqual([]);
  });

  it('no abre claves de otra carpeta ni que salen de la suya', async () => {
    for (const key of [
      '00000000-0000-4000-8000-000000000001.tsv',
      '../exports/x.csv',
    ]) {
      await expect(store.openWorksheetExport(key)).rejects.toThrow(
        'Clave de artefacto inválida.',
      );
    }
  });
});
