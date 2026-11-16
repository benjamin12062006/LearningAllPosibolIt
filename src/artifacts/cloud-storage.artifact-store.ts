import type { Bucket, File } from '@google-cloud/storage';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import {
  addAbortSignal,
  PassThrough,
  Transform,
  type Readable,
  type Writable,
} from 'node:stream';
import { pipeline } from 'node:stream/promises';
// Mismo límite y mismo error de subida que `ArtifactStore.receive`.
import {
  IMPORT_LIMITS,
  ImportFailure,
  type StoredUpload,
} from '../catalog-import/import.types.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import {
  type ArtifactStore,
  type FinalFolder,
  type Folder,
  isSameContent,
  isValidKey,
  sha256,
  type StoredArtifact,
  type StoredFolder,
  type WorksheetExportExtension,
  type WrittenArtifact,
} from './artifact.store.js';
import { ArtifactNotFoundError, type ByteSink } from './artifacts.types.js';

/**
 * Lo que las features usan de `ArtifactStore`. Este almacén lo cumple con los
 * mismos tipos; `onModuleInit` sobra porque el bucket no tiene carpetas que crear.
 */
type ArtifactOperations = Omit<ArtifactStore, 'onModuleInit'>;

/**
 * Cloud Storage responde 404 si el objeto no existe y 412 si una precondición
 * falla (por ejemplo, `ifGenerationMatch: 0` con el objeto ya creado).
 */
const NOT_FOUND = 404;

/**
 * `ifGenerationMatch: 0` solo deja escribir si el objeto todavía no existe
 * (fuentes de despliegue, ficha 03, F12). Es lo que hacían `open(…, 'wx')` y
 * `link` en disco: una colisión no reemplaza nada.
 */
const ONLY_IF_NEW = { preconditionOpts: { ifGenerationMatch: 0 } } as const;

/**
 * Los archivos privados en un bucket de Cloud Storage, para Cloud Run, que no
 * tiene disco persistente (deploys, plan 06, D7). Mantiene las garantías de
 * `ArtifactStore` con las equivalencias de un almacén de objetos:
 *
 * - Las carpetas son prefijos del nombre del objeto (`tmp/`, `exports/`…).
 * - Nada se reemplaza: escrituras y copias usan `ONLY_IF_NEW`.
 * - El segundo nombre de un archivo (aceptar una subida o publicar una versión
 *   del feed) es una copia dentro del bucket, porque no hay enlaces duros.
 * - No hace falta `fsync`: un objeto solo aparece cuando su subida terminó
 *   entera. Por eso los archivos que genera la API se escriben directamente con
 *   su nombre final, sin pasar por `tmp/`.
 * - Se relee lo guardado antes de devolverlo, como en disco.
 * - Un objeto ausente es `ArtifactNotFoundError`, que `isMissingFile` reconoce.
 */
export class CloudStorageArtifactStore implements ArtifactOperations {
  constructor(private readonly bucket: Bucket) {}

  // ---------------------------------------------------------------------------
  // Importaciones: subida en tmp/, aceptación en artifacts/ y lectura del worker.
  // ---------------------------------------------------------------------------

  /** Sube a `tmp/` mientras cuenta los bytes y calcula su hash. */
  async receive(source: Readable, signal?: AbortSignal) {
    const filename = `${randomUUID()}.csv`;
    let size = 0;
    const hash = createHash('sha256');

    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > IMPORT_LIMITS.fileBytes) {
          return callback(new ImportFailure(ErrorCodes.IMPORT_FILE_TOO_LARGE));
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    try {
      await pipeline(source, meter, this.newObject('tmp', filename), {
        signal,
      });
      return { filename, size, hash: hash.digest('hex') };
    } catch (error) {
      await this.removeTemporary(filename);
      throw error;
    }
  }

  /** Como `ArtifactStore.writeImportUpload`: un CSV de la API queda como una subida. */
  async writeImportUpload<Result>(
    write: (sink: ByteSink) => Promise<Result>,
  ): Promise<Readonly<{ upload: StoredUpload; result: Result }>> {
    const { file, result } = await this.writeInChunks(
      'tmp',
      `${randomUUID()}.csv`,
      write,
    );
    const upload = {
      filename: file.key,
      size: file.byteSize,
      hash: file.checksum,
    };
    return { upload, result };
  }

  /** Copia la subida a `artifacts/` y borra el temporal. */
  async finalize(temporary: string, key: string) {
    await this.copyIfNew('tmp', temporary, 'artifacts', key);
    try {
      await this.removeTemporary(temporary);
    } catch (error) {
      // La copia es de esta operación y todavía no tiene referencia en SQL.
      await this.remove('artifacts', key);
      throw error;
    }
  }

  openRead(key: string, signal?: AbortSignal): Readable {
    const object = this.object('artifacts', key);
    if (signal?.aborted) {
      // Evita abrir la descarga si el consumidor ya canceló la lectura.
      return addAbortSignal(signal, new PassThrough());
    }
    const content = readObject(object);
    if (signal) {
      addAbortSignal(signal, content);
    }
    return content;
  }

  listArtifacts(): Promise<StoredArtifact[]> {
    return this.list('artifacts');
  }

  removeArtifact(key: string) {
    return this.remove('artifacts', key);
  }

  // ---------------------------------------------------------------------------
  // Temporales.
  // ---------------------------------------------------------------------------

  removeTemporary(key: string) {
    return this.remove('tmp', key);
  }

  // ---------------------------------------------------------------------------
  // Exportaciones: TSV generados por la API en exports/.
  // ---------------------------------------------------------------------------

  /** Guarda el TSV y lo relee: SQL solo referencia archivos verificados. */
  async writeExport(content: Buffer): Promise<WrittenArtifact> {
    const written = {
      key: `${randomUUID()}.tsv`,
      byteSize: content.length,
      checksum: sha256(content),
    };

    await this.object('exports', written.key).save(content, {
      ...ONLY_IF_NEW,
      resumable: false,
    });
    await this.verifyStored('exports', written);

    return written;
  }

  /** Comprueba que existe antes de que Nest empiece a responder. */
  openExport(key: string): Promise<Readable> {
    return this.openExisting('exports', key);
  }

  listExports(): Promise<StoredArtifact[]> {
    return this.list('exports');
  }

  removeExport(key: string) {
    return this.remove('exports', key);
  }

  // ---------------------------------------------------------------------------
  // Versiones del feed: copias de TSV de exportaciones en feeds/.
  // ---------------------------------------------------------------------------

  /**
   * Da al TSV de la exportación el nombre `feeds/<versionKey>` copiándolo dentro
   * del bucket. Como con el enlace duro, borrar la exportación no borra la
   * versión. Se relee antes de devolverlo.
   */
  async linkFeedVersion(
    exportKey: string,
    versionKey: string,
    expected: Pick<WrittenArtifact, 'byteSize' | 'checksum'>,
  ): Promise<WrittenArtifact> {
    const linked = {
      key: versionKey,
      byteSize: expected.byteSize,
      checksum: expected.checksum,
    };

    await this.copyIfNew('exports', exportKey, 'feeds', versionKey);
    await this.verifyStored('feeds', linked);

    return linked;
  }

  openFeedVersion(key: string): Promise<Readable> {
    return this.openExisting('feeds', key);
  }

  listFeedVersions(): Promise<StoredArtifact[]> {
    return this.list('feeds');
  }

  removeFeedVersion(key: string) {
    return this.remove('feeds', key);
  }

  // ---------------------------------------------------------------------------
  // Exportaciones de hojas: CSV y XLSX generados por trozos (E5.3).
  // ---------------------------------------------------------------------------

  /** Sube por trozos, sin tener el archivo entero en memoria, y lo relee. */
  async writeWorksheetExport<Result>(
    extension: WorksheetExportExtension,
    write: (sink: ByteSink) => Promise<Result>,
  ): Promise<Readonly<{ file: WrittenArtifact; result: Result }>> {
    const key = `${randomUUID()}.${extension}`;
    const written = await this.writeInChunks('worksheet-exports', key, write);
    await this.verifyInChunks('worksheet-exports', written.file);
    return written;
  }

  openWorksheetExport(key: string): Promise<Readable> {
    return this.openExisting('worksheet-exports', key);
  }

  listWorksheetExports(): Promise<StoredArtifact[]> {
    return this.list('worksheet-exports');
  }

  removeWorksheetExport(key: string) {
    return this.remove('worksheet-exports', key);
  }

  /** Lo usa el relay del outbox, igual que en disco. */
  removeStored(folder: FinalFolder, key: string) {
    return this.remove(folder, key);
  }

  // ---------------------------------------------------------------------------
  // Operaciones sobre objetos.
  // ---------------------------------------------------------------------------

  private object(folder: Folder, key: string): File {
    if (!isValidKey(folder, key)) {
      throw new Error('Clave de artefacto inválida.');
    }
    return this.bucket.file(`${folder}/${key}`);
  }

  /** Subida de un objeto nuevo; si ya existe, falla sin tocarlo. */
  private newObject(folder: Folder, key: string): Writable {
    return this.object(folder, key).createWriteStream({
      ...ONLY_IF_NEW,
      // Los archivos de la API caben en una petición (50 MiB como mucho).
      resumable: false,
    });
  }

  /**
   * Sube lo que `write` genera mientras se genera. Si `write` o la subida
   * fallan, no queda objeto: la subida se cancela y se borra por si acaso.
   */
  private async writeInChunks<Result>(
    folder: Folder,
    key: string,
    write: (sink: ByteSink) => Promise<Result>,
  ): Promise<Readonly<{ file: WrittenArtifact; result: Result }>> {
    const chunks = new PassThrough();
    const hash = createHash('sha256');
    let byteSize = 0;
    const sink: ByteSink = {
      write: async (chunk) => {
        hash.update(chunk);
        byteSize += chunk.length;
        await writeRespectingBackpressure(chunks, chunk);
      },
    };

    try {
      // A la vez: quien genera escribe en `chunks` y la subida los va leyendo.
      const [result] = await Promise.all([
        generate(write, sink, chunks),
        pipeline(chunks, this.newObject(folder, key)),
      ]);
      return { file: { key, byteSize, checksum: hash.digest('hex') }, result };
    } catch (error) {
      await this.remove(folder, key);
      throw error;
    }
  }

  /** Copia que no reemplaza el destino; un origen ausente es `ArtifactNotFoundError`. */
  private async copyIfNew(
    fromFolder: Folder,
    fromKey: string,
    toFolder: StoredFolder,
    toKey: string,
  ) {
    try {
      await this.object(fromFolder, fromKey).copy(
        this.object(toFolder, toKey),
        ONLY_IF_NEW,
      );
    } catch (error) {
      throw asArtifactError(error);
    }
  }

  /** Comprueba que el objeto existe y lo abre (como `open` antes de responder). */
  private async openExisting(folder: StoredFolder, key: string) {
    const object = this.object(folder, key);
    const [exists] = await object.exists();
    if (!exists) {
      throw new ArtifactNotFoundError();
    }
    return readObject(object);
  }

  private async list(folder: StoredFolder): Promise<StoredArtifact[]> {
    const prefix = `${folder}/`;
    const [objects] = await this.bucket.getFiles({ prefix });
    const stored: StoredArtifact[] = [];
    for (const object of objects) {
      const key = object.name.slice(prefix.length);
      if (isValidKey(folder, key)) {
        stored.push({ key, modifiedAt: modifiedAtOf(object) });
      }
    }
    return stored;
  }

  /** Borrar un objeto que ya no existe no es un error. */
  private async remove(folder: Folder, key: string) {
    await this.object(folder, key).delete({ ignoreNotFound: true });
  }

  /** Si no coincide, se borra: queda sin referencia en SQL. */
  private async verifyStored(folder: StoredFolder, written: WrittenArtifact) {
    const [stored] = await this.object(folder, written.key).download();
    if (isSameContent(stored, written)) {
      return;
    }
    await this.remove(folder, written.key);
    throw new Error('El archivo guardado no coincide con el generado.');
  }

  /** Como `verifyStored`, pero leyendo por trozos: el archivo puede ser grande. */
  private async verifyInChunks(folder: StoredFolder, written: WrittenArtifact) {
    const hash = createHash('sha256');
    let byteSize = 0;
    for await (const chunk of readObject(this.object(folder, written.key))) {
      if (Buffer.isBuffer(chunk)) {
        hash.update(chunk);
        byteSize += chunk.length;
      }
    }
    const matches =
      byteSize === written.byteSize && hash.digest('hex') === written.checksum;
    if (matches) {
      return;
    }
    await this.remove(folder, written.key);
    throw new Error('El archivo guardado no coincide con el generado.');
  }
}

/**
 * Lee el objeto con los errores que esperan las features: si no existe, el
 * stream falla con `ArtifactNotFoundError`. Cerrar el resultado cancela la
 * descarga.
 */
function readObject(object: File): Readable {
  const download = object.createReadStream();
  const content = new PassThrough();
  download.on('error', (error) => content.destroy(asArtifactError(error)));
  content.on('close', () => download.destroy());
  return download.pipe(content);
}

/** Ejecuta `write` y cierra `chunks`, con error si `write` falla, para que la subida termine. */
async function generate<Result>(
  write: (sink: ByteSink) => Promise<Result>,
  sink: ByteSink,
  chunks: PassThrough,
): Promise<Result> {
  try {
    const result = await write(sink);
    chunks.end();
    return result;
  } catch (error) {
    chunks.destroy(asError(error));
    throw error;
  }
}

/** Espera a `drain` si el buffer está lleno, para no acumular el archivo en memoria. */
async function writeRespectingBackpressure(stream: Writable, chunk: Buffer) {
  if (!stream.write(chunk)) {
    await once(stream, 'drain');
  }
}

/** Fecha de la última escritura, para la limpieza de huérfanos. */
function modifiedAtOf(object: File) {
  return Date.parse(object.metadata.updated ?? '');
}

/** Un 404 de Cloud Storage pasa a `ArtifactNotFoundError`; lo demás, sin cambios. */
function asArtifactError(error: unknown): Error {
  if (isNotFound(error)) {
    return new ArtifactNotFoundError();
  }
  return asError(error);
}

function isNotFound(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === NOT_FOUND
  );
}

function asError(error: unknown) {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}
