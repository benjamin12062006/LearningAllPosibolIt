import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  link,
  mkdir,
  open,
  readdir,
  readFile,
  stat,
  unlink,
} from 'node:fs/promises';
import { join } from 'node:path';
import { Transform, Writable, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
// `receive` es la subida de una importación, el único tipo de subida que hay:
// su límite y su error son los de `catalog-import`.
import {
  IMPORT_LIMITS,
  ImportFailure,
} from '../catalog-import/import.types.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import {
  ARTIFACT_STORE_OPTIONS,
  type ArtifactStoreOptions,
} from './artifacts.types.js';

type Folder = 'tmp' | 'artifacts' | 'exports' | 'feeds';

/** Carpetas donde un archivo queda guardado (no temporal). */
type FinalFolder = Exclude<Folder, 'tmp'>;

export type StoredArtifact = { key: string; modifiedAt: number };

/** Un archivo generado por la API, ya guardado y verificado. */
export type WrittenArtifact = Readonly<{
  key: string;
  byteSize: number;
  checksum: string;
}>;

/**
 * `<uuid>.csv` (importaciones) y `<uuid>.tsv` (exportaciones y versiones del
 * feed): impiden que una clave salga de su carpeta (`../`) o apunte a otro
 * archivo.
 */
const IMPORT_KEY_PATTERN = /^[0-9a-f-]{36}\.csv$/;
const TSV_KEY_PATTERN = /^[0-9a-f-]{36}\.tsv$/;

/** `tmp/` recibe los dos tipos; cada carpeta final, solo el suyo. */
const KEY_PATTERNS: Record<Folder, readonly RegExp[]> = {
  tmp: [IMPORT_KEY_PATTERN, TSV_KEY_PATTERN],
  artifacts: [IMPORT_KEY_PATTERN],
  exports: [TSV_KEY_PATTERN],
  feeds: [TSV_KEY_PATTERN],
};

/**
 * Archivos privados. Las subidas de las importaciones llegan a `tmp/` y, al
 * aceptarse, se enlazan en `artifacts/`, que es lo que lee el worker. Los TSV de
 * las exportaciones se escriben en `tmp/` y se enlazan en `exports/`. Al
 * publicar, el TSV de una exportación se enlaza también en `feeds/` como
 * archivo propio de la versión del feed.
 */
@Injectable()
export class ArtifactStore implements OnModuleInit {
  constructor(
    @Inject(ARTIFACT_STORE_OPTIONS)
    private readonly options: ArtifactStoreOptions,
  ) {}

  async onModuleInit() {
    for (const folder of ['', 'tmp', 'artifacts', 'exports', 'feeds']) {
      await mkdir(join(this.options.root, folder), {
        recursive: true,
        mode: 0o700,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Importaciones: subida en tmp/, aceptación en artifacts/ y lectura del worker.
  // ---------------------------------------------------------------------------

  /** Guarda la subida en `tmp/` mientras cuenta los bytes y calcula su hash. */
  async receive(source: Readable, signal?: AbortSignal) {
    const filename = `${randomUUID()}.csv`;
    const file = await open(this.pathOf('tmp', filename), 'wx', 0o600);
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
      const destination = new Writable({
        write(chunk: Buffer, _encoding, callback) {
          void file.writeFile(chunk).then(
            () => callback(),
            (error: Error) => callback(error),
          );
        },
      });
      await pipeline(source, meter, destination, { signal });
      await file.sync();
      return { filename, size, hash: hash.digest('hex') };
    } catch (error) {
      await this.removeTemporary(filename);
      throw error;
    } finally {
      await file.close();
    }
  }

  finalize(temporary: string, key: string) {
    return this.linkInto('artifacts', temporary, key);
  }

  openRead(key: string, signal?: AbortSignal): Readable {
    return createReadStream(this.pathOf('artifacts', key), { signal });
  }

  /** Artefactos guardados y la fecha de su última escritura, para la limpieza. */
  listArtifacts(): Promise<StoredArtifact[]> {
    return this.list('artifacts');
  }

  removeArtifact(key: string) {
    return this.remove('artifacts', key);
  }

  // ---------------------------------------------------------------------------
  // Temporales: los usan las dos features.
  // ---------------------------------------------------------------------------

  removeTemporary(key: string) {
    return this.remove('tmp', key);
  }

  // ---------------------------------------------------------------------------
  // Exportaciones: TSV generados por la API en exports/.
  // ---------------------------------------------------------------------------

  /**
   * Guarda un TSV generado por la API (plan de reviews y exports, D6). Solo lo
   * deja en `exports/` si al releerlo coincide en tamaño y SHA-256 con lo
   * generado: el archivo queda completo y verificado antes de que SQL lo
   * referencie (invariante 5 de docs-diagrams/06).
   */
  async writeExport(content: Buffer): Promise<WrittenArtifact> {
    const written = {
      key: `${randomUUID()}.tsv`,
      byteSize: content.length,
      checksum: sha256(content),
    };

    await this.writeTemporary(written.key, content);
    await this.moveToExports(written.key);
    await this.verifyStored('exports', written);

    return written;
  }

  /**
   * Abre el TSV antes de entregarlo: si falta, el error llega aquí y no cuando
   * Nest ya empezó a responder, donde Express lo convertiría en un 400
   * (plan de reviews y exports, R2; F22). El descriptor se cierra al terminar o
   * al cancelarse la lectura.
   */
  async openExport(key: string): Promise<Readable> {
    const file = await open(this.pathOf('exports', key), 'r');
    return file.createReadStream();
  }

  /** TSV guardados y la fecha de su última escritura, para la limpieza. */
  listExports(): Promise<StoredArtifact[]> {
    return this.list('exports');
  }

  removeExport(key: string) {
    return this.remove('exports', key);
  }

  // ---------------------------------------------------------------------------
  // Versiones del feed: enlaces de TSV de exportaciones en feeds/.
  // ---------------------------------------------------------------------------

  /**
   * Da al TSV de una exportación un segundo nombre, `feeds/<versionKey>`, sin
   * copiar bytes (plan feeds&publications, D5; F30). Borrar después la
   * exportación no borra el archivo de la versión. Se relee antes de devolverlo:
   * la versión solo se publica con un archivo completo y verificado.
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

    // `link` es exclusivo: una colisión no reemplaza un archivo ya existente.
    await link(
      this.pathOf('exports', exportKey),
      this.pathOf('feeds', versionKey),
    );
    try {
      await this.syncDirectory('feeds');
    } catch (error) {
      await this.removeFeedVersion(versionKey);
      throw error;
    }
    await this.verifyStored('feeds', linked);

    return linked;
  }

  /** Abre el archivo antes de responder, por el mismo motivo que `openExport`. */
  async openFeedVersion(key: string): Promise<Readable> {
    const file = await open(this.pathOf('feeds', key), 'r');
    return file.createReadStream();
  }

  /** Archivos de versiones y la fecha de su última escritura, para la limpieza. */
  listFeedVersions(): Promise<StoredArtifact[]> {
    return this.list('feeds');
  }

  removeFeedVersion(key: string) {
    return this.remove('feeds', key);
  }

  private async linkInto(folder: FinalFolder, temporary: string, key: string) {
    // `link` es exclusivo: una colisión no reemplaza un archivo ya existente.
    await link(this.pathOf('tmp', temporary), this.pathOf(folder, key));
    try {
      await this.syncDirectory(folder);
      await this.removeTemporary(temporary);
    } catch (error) {
      // El enlace es de esta operación y todavía no tiene referencia en SQL.
      await this.remove(folder, key);
      throw error;
    }
  }

  private async list(folder: FinalFolder): Promise<StoredArtifact[]> {
    const names = await readdir(join(this.options.root, folder));
    const stored: StoredArtifact[] = [];
    for (const key of names) {
      if (!isValidKey(folder, key)) {
        continue;
      }
      try {
        const info = await stat(this.pathOf(folder, key));
        stored.push({ key, modifiedAt: info.mtimeMs });
      } catch (error) {
        // Pudo borrarse entre `readdir` y `stat`.
        if (!isMissingFile(error)) {
          throw error;
        }
      }
    }
    return stored;
  }

  private async writeTemporary(key: string, content: Buffer) {
    const file = await open(this.pathOf('tmp', key), 'wx', 0o600);
    try {
      await file.writeFile(content);
      await file.sync();
    } catch (error) {
      await this.removeTemporary(key);
      throw error;
    } finally {
      await file.close();
    }
  }

  /** Si el enlace falla, el temporal no lo va a recoger nadie: se borra aquí. */
  private async moveToExports(key: string) {
    try {
      await this.linkInto('exports', key, key);
    } catch (error) {
      await this.removeTemporary(key);
      throw error;
    }
  }

  /**
   * Si releer el archivo falla, queda sin referencia y la limpieza de huérfanos
   * lo retira (plan de reviews y exports, D6).
   */
  private async verifyStored(folder: FinalFolder, written: WrittenArtifact) {
    const stored = await readFile(this.pathOf(folder, written.key));
    if (isSameContent(stored, written)) {
      return;
    }
    await this.remove(folder, written.key);
    throw new Error('El archivo guardado no coincide con el generado.');
  }

  private pathOf(folder: Folder, key: string) {
    if (!isValidKey(folder, key)) {
      throw new Error('Clave de artefacto inválida.');
    }
    return join(this.options.root, folder, key);
  }

  /** Borrar un archivo que ya no existe no es un error. */
  private async remove(folder: Folder, key: string) {
    try {
      await unlink(this.pathOf(folder, key));
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
    }
  }

  /** Persiste en disco la entrada del directorio creada por `link`. */
  private async syncDirectory(folder: Folder) {
    const directory = await open(join(this.options.root, folder), 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}

function isValidKey(folder: Folder, key: string) {
  return KEY_PATTERNS[folder].some((pattern) => pattern.test(key));
}

function sha256(content: Buffer) {
  return createHash('sha256').update(content).digest('hex');
}

/** Mismo tamaño y misma suma SHA-256 que lo que se generó. */
function isSameContent(stored: Buffer, written: WrittenArtifact) {
  return (
    stored.length === written.byteSize && sha256(stored) === written.checksum
  );
}

/** El archivo no existe (`ENOENT`). */
export function isMissingFile(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}
