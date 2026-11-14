import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { type Bucket, Storage } from '@google-cloud/storage';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';
import { isMissingFile } from '../../../src/artifacts/artifact.store.js';
import { CloudStorageArtifactStore } from '../../../src/artifacts/cloud-storage.artifact-store.js';
import { IMPORT_LIMITS } from '../../../src/catalog-import/import.types.js';

/**
 * Contrato de `CloudStorageArtifactStore` contra un bucket real (deploys, plan
 * 06, D7). Solo corre con `ARTIFACT_TEST_BUCKET`, un bucket de pruebas: cuesta
 * céntimos y necesita las credenciales de Google de quien lo ejecuta (ADC).
 * Cada prueba usa claves nuevas y borra lo que crea.
 */
const bucketName = process.env.ARTIFACT_TEST_BUCKET?.trim();
const describeWithBucket = bucketName ? describe : describe.skip;

const TSV = Buffer.from('id\ttitle\nSKU-1\tMesa\n', 'utf8');
const CSV = 'id,title\nSKU-1,Mesa\n';

describeWithBucket('CloudStorageArtifactStore contra un bucket real', () => {
  let bucket: Bucket;
  let store: CloudStorageArtifactStore;
  const created: string[] = [];

  beforeAll(() => {
    bucket = new Storage().bucket(bucketName ?? '');
    store = new CloudStorageArtifactStore(bucket);
  });
  afterAll(async () => {
    for (const name of created) {
      await bucket.file(name).delete({ ignoreNotFound: true });
    }
  });

  /** Recuerda el objeto para borrarlo al final aunque la prueba falle. */
  function track(folder: string, key: string) {
    created.push(`${folder}/${key}`);
    return key;
  }

  async function exists(folder: string, key: string) {
    const [found] = await bucket.file(`${folder}/${key}`).exists();
    return found;
  }

  async function failureOf(operation: Promise<unknown>) {
    return operation.then(
      () => undefined,
      (error: unknown) => error,
    );
  }

  describe('importaciones', () => {
    it('recibe en tmp/, acepta en artifacts/ y el worker lo lee igual', async () => {
      const upload = await store.receive(Readable.from([Buffer.from(CSV)]));
      track('tmp', upload.filename);
      const key = track('artifacts', `${randomUUID()}.csv`);

      await store.finalize(upload.filename, key);

      expect(upload.size).toBe(Buffer.byteLength(CSV));
      expect(upload.hash).toBe(createHash('sha256').update(CSV).digest('hex'));
      expect(await text(store.openRead(key))).toBe(CSV);
      expect(await exists('tmp', upload.filename)).toBe(false);
      expect((await store.listArtifacts()).map(({ key: k }) => k)).toContain(
        key,
      );
    });

    it('rechaza el byte de más y no deja temporal', async () => {
      const tooLarge = Readable.from(
        (function* () {
          const chunk = Buffer.alloc(1_048_576, 0x61);
          for (let sent = 0; sent <= IMPORT_LIMITS.fileBytes; ) {
            yield chunk;
            sent += chunk.length;
          }
        })(),
      );
      const before = new Set(await tmpKeys());

      await expect(store.receive(tooLarge)).rejects.toMatchObject({
        detail: { code: 'IMPORT_FILE_TOO_LARGE' },
      });
      const leftovers = (await tmpKeys()).filter((key) => !before.has(key));
      expect(leftovers).toEqual([]);
    });

    it('no reemplaza un artefacto que ya existe con esa clave', async () => {
      const key = track('artifacts', `${randomUUID()}.csv`);
      await bucket.file(`artifacts/${key}`).save('original');
      const upload = await store.receive(Readable.from([Buffer.from(CSV)]));
      track('tmp', upload.filename);

      await expect(store.finalize(upload.filename, key)).rejects.toMatchObject({
        code: 412,
      });
      expect(await text(store.openRead(key))).toBe('original');
    });

    it('leer un artefacto ausente falla con «no existe»', async () => {
      const error = await failureOf(
        text(store.openRead(`${randomUUID()}.csv`)),
      );

      expect(isMissingFile(error)).toBe(true);
    });

    it('cancelar la lectura con la señal corta la descarga', async () => {
      const upload = await store.receive(Readable.from([Buffer.from(CSV)]));
      track('tmp', upload.filename);
      const key = track('artifacts', `${randomUUID()}.csv`);
      await store.finalize(upload.filename, key);
      const controller = new AbortController();
      controller.abort();

      const error = await failureOf(
        text(store.openRead(key, controller.signal)),
      );

      expect(error).toMatchObject({ name: 'AbortError' });
    });
  });

  describe('exportaciones y versiones del feed', () => {
    it('guarda el TSV verificado y lo abre antes de responder', async () => {
      const written = await store.writeExport(TSV);
      track('exports', written.key);

      expect(written.byteSize).toBe(TSV.length);
      expect(await text(await store.openExport(written.key))).toBe(
        TSV.toString(),
      );
      expect((await store.listExports()).map(({ key }) => key)).toContain(
        written.key,
      );
    });

    it('abrir una exportación ausente falla al abrir con «no existe»', async () => {
      const error = await failureOf(store.openExport(`${randomUUID()}.tsv`));

      expect(isMissingFile(error)).toBe(true);
    });

    it('la versión del feed sobrevive al borrado de la exportación', async () => {
      const written = await store.writeExport(TSV);
      track('exports', written.key);
      const versionKey = track('feeds', `${randomUUID()}.tsv`);

      await store.linkFeedVersion(written.key, versionKey, written);
      await store.removeExport(written.key);

      expect(await text(await store.openFeedVersion(versionKey))).toBe(
        TSV.toString(),
      );
      expect(isMissingFile(await failureOf(store.openExport(written.key)))).toBe(
        true,
      );
    });

    it('publicar sin el archivo de la exportación es «no existe» y no crea la versión', async () => {
      const versionKey = track('feeds', `${randomUUID()}.tsv`);

      const error = await failureOf(
        store.linkFeedVersion(`${randomUUID()}.tsv`, versionKey, {
          byteSize: TSV.length,
          checksum: 'x',
        }),
      );

      expect(isMissingFile(error)).toBe(true);
      expect(await exists('feeds', versionKey)).toBe(false);
    });

    it('no reemplaza una versión que ya existe con esa clave', async () => {
      const written = await store.writeExport(TSV);
      track('exports', written.key);
      const versionKey = track('feeds', `${randomUUID()}.tsv`);
      await bucket.file(`feeds/${versionKey}`).save('otro');

      await expect(
        store.linkFeedVersion(written.key, versionKey, written),
      ).rejects.toMatchObject({ code: 412 });
      expect(await text(await store.openFeedVersion(versionKey))).toBe('otro');
    });

    it('si lo guardado no coincide con lo esperado, lo borra y falla', async () => {
      const written = await store.writeExport(TSV);
      track('exports', written.key);
      const versionKey = track('feeds', `${randomUUID()}.tsv`);

      await expect(
        store.linkFeedVersion(written.key, versionKey, {
          byteSize: written.byteSize,
          checksum: '0'.repeat(64),
        }),
      ).rejects.toThrow('no coincide');
      expect(await exists('feeds', versionKey)).toBe(false);
    });
  });

  describe('exportaciones de hojas por trozos', () => {
    it('sube por trozos sin perder bytes y devuelve lo que devuelve write', async () => {
      const chunk = Buffer.alloc(65_536, 0x62);
      const chunks = 48;
      const expected = createHash('sha256');
      for (let index = 0; index < chunks; index += 1) {
        expected.update(chunk);
      }

      const { file, result } = await store.writeWorksheetExport(
        'csv',
        async (sink) => {
          for (let index = 0; index < chunks; index += 1) {
            await sink.write(chunk);
          }
          return 'escrito';
        },
      );
      track('worksheet-exports', file.key);

      expect(result).toBe('escrito');
      expect(file.byteSize).toBe(chunk.length * chunks);
      expect(file.checksum).toBe(expected.digest('hex'));
      const stored = await text(await store.openWorksheetExport(file.key));
      expect(stored.length).toBe(chunk.length * chunks);
    });

    it('si write falla a mitad, no queda ningún objeto', async () => {
      const before = new Set(await keysIn('worksheet-exports'));

      await expect(
        store.writeWorksheetExport('xlsx', async (sink) => {
          await sink.write(Buffer.from('mitad'));
          throw new Error('fallo al generar');
        }),
      ).rejects.toThrow('fallo al generar');
      const leftovers = (await keysIn('worksheet-exports')).filter(
        (key) => !before.has(key),
      );
      expect(leftovers).toEqual([]);
    });
  });

  describe('borrado y claves', () => {
    it('borrar un objeto que ya no existe no es un error', async () => {
      await expect(
        store.removeStored('feeds', `${randomUUID()}.tsv`),
      ).resolves.toBeUndefined();
    });

    it('rechaza claves que podrían salir de su carpeta', async () => {
      await expect(store.openExport('../tmp/x.tsv')).rejects.toThrow(
        'Clave de artefacto inválida.',
      );
      expect(() => store.openRead('nota.txt')).toThrow(
        'Clave de artefacto inválida.',
      );
    });
  });

  async function tmpKeys() {
    return keysIn('tmp');
  }

  async function keysIn(folder: string) {
    const [objects] = await bucket.getFiles({ prefix: `${folder}/` });
    return objects.map((object) => object.name);
  }
});
