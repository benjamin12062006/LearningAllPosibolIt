import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '../../../src/artifacts/artifact.store.js';

const CSV_KEY = /^[0-9a-f-]{36}\.csv$/;
const PARTS = [Buffer.from('SKU,Precio\r\n'), Buffer.from('007,10.50\r\n')];

describe('ArtifactStore: CSV generado por la API para importarlo al catálogo (E5.4, D22)', () => {
  let root: string;
  let store: ArtifactStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'artifact-import-upload-'));
    store = new ArtifactStore({ root });
    await store.onModuleInit();
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('queda en tmp como una subida, con tamaño y SHA-256, y finalize lo enlaza en artifacts', async () => {
    const { upload, result } = await store.writeImportUpload(async (sink) => {
      for (const part of PARTS) await sink.write(part);
      return { rows: 1 };
    });
    const content = Buffer.concat(PARTS);

    expect(result).toEqual({ rows: 1 });
    expect(upload).toEqual({
      filename: expect.stringMatching(CSV_KEY),
      size: content.length,
      hash: createHash('sha256').update(content).digest('hex'),
    });
    expect(await readFile(join(root, 'tmp', upload.filename))).toEqual(content);
    expect((await stat(join(root, 'tmp', upload.filename))).mode & 0o777).toBe(
      0o600,
    );

    await store.finalize(upload.filename, upload.filename);
    expect(await readdir(join(root, 'tmp'))).toEqual([]);
    const chunks: Buffer[] = [];
    for await (const chunk of store.openRead(upload.filename)) {
      chunks.push(Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks)).toEqual(content);
  });

  it('si quien escribe falla, no queda nada y el error sigue', async () => {
    const failure = new Error('filas con problemas');
    await expect(
      store.writeImportUpload(async (sink) => {
        await sink.write(PARTS[0]);
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await readdir(join(root, 'tmp'))).toEqual([]);
    expect(await readdir(join(root, 'artifacts'))).toEqual([]);
  });
});
