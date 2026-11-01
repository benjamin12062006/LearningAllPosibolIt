import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { link, mkdir, open, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform, Writable, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ErrorCodes } from '../common/http/error-codes.js';
import {
  CATALOG_IMPORT_OPTIONS,
  IMPORT_LIMITS,
  ImportFailure,
  type CatalogImportOptions,
} from './import.types.js';

type Folder = 'tmp' | 'artifacts';

export type StoredArtifact = { key: string; modifiedAt: number };

/** `<uuid>.csv`: impide que una clave salga de su carpeta (`../`) o apunte a otro archivo. */
const ARTIFACT_KEY_PATTERN = /^[0-9a-f-]{36}\.csv$/;

/**
 * Archivos privados de las importaciones. Las subidas llegan a `tmp/` y, al
 * aceptarse, se enlazan en `artifacts/`, que es lo que lee el worker.
 */
@Injectable()
export class ArtifactStore implements OnModuleInit {
  constructor(
    @Inject(CATALOG_IMPORT_OPTIONS)
    private readonly options: CatalogImportOptions,
  ) {}

  async onModuleInit() {
    for (const folder of ['', 'tmp', 'artifacts']) {
      await mkdir(join(this.options.root, folder), {
        recursive: true,
        mode: 0o700,
      });
    }
  }

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

  async finalize(temporary: string, key: string) {
    // `link` es exclusivo: una colisión no reemplaza un archivo ya existente.
    await link(this.pathOf('tmp', temporary), this.pathOf('artifacts', key));
    try {
      await this.syncDirectory('artifacts');
      await this.removeTemporary(temporary);
    } catch (error) {
      // El enlace es de esta aceptación y todavía no tiene referencia en SQL.
      await this.removeArtifact(key);
      throw error;
    }
  }

  openRead(key: string, signal?: AbortSignal): Readable {
    return createReadStream(this.pathOf('artifacts', key), { signal });
  }

  /** Artefactos guardados y la fecha de su última escritura, para la limpieza. */
  async listArtifacts(): Promise<StoredArtifact[]> {
    const names = await readdir(join(this.options.root, 'artifacts'));
    const artifacts: StoredArtifact[] = [];
    for (const key of names) {
      if (!ARTIFACT_KEY_PATTERN.test(key)) {
        continue;
      }
      try {
        const info = await stat(this.pathOf('artifacts', key));
        artifacts.push({ key, modifiedAt: info.mtimeMs });
      } catch (error) {
        // Pudo borrarse entre `readdir` y `stat`.
        if (!isMissingFile(error)) {
          throw error;
        }
      }
    }
    return artifacts;
  }

  removeTemporary(key: string) {
    return this.remove('tmp', key);
  }

  removeArtifact(key: string) {
    return this.remove('artifacts', key);
  }

  private pathOf(folder: Folder, key: string) {
    if (!ARTIFACT_KEY_PATTERN.test(key)) {
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

function isMissingFile(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}
