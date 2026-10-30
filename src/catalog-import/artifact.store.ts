import { ErrorCodes } from '../common/http/error-codes.js';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, open, link, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { Transform, Writable, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  CATALOG_IMPORT_OPTIONS,
  IMPORT_LIMITS,
  ImportFailure,
  type CatalogImportOptions,
} from './import.types.js';

@Injectable()
export class ArtifactStore implements OnModuleInit {
  constructor(
    @Inject(CATALOG_IMPORT_OPTIONS)
    private readonly options: CatalogImportOptions,
  ) {}

  async onModuleInit() {
    for (const folder of ['', 'tmp', 'artifacts'])
      await mkdir(join(this.options.root, folder), {
        recursive: true,
        mode: 0o700,
      });
  }

  private location(folder: 'tmp' | 'artifacts', key: string) {
    if (!/^[0-9a-f-]{36}\.csv$/.test(key))
      throw new Error('Clave de artefacto inválida.');
    return join(this.options.root, folder, key);
  }

  async receive(source: Readable, signal?: AbortSignal) {
    const filename = `${randomUUID()}.csv`;
    const file = await open(this.location('tmp', filename), 'wx', 0o600);
    let size = 0;
    const hash = createHash('sha256');
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > IMPORT_LIMITS.fileBytes)
          return callback(new ImportFailure(ErrorCodes.IMPORT_FILE_TOO_LARGE));
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
    // link es exclusivo: una colisión no reemplaza un archivo ya existente.
    await link(
      this.location('tmp', temporary),
      this.location('artifacts', key),
    );
    try {
      await this.syncDirectory('artifacts');
      await this.removeTemporary(temporary);
    } catch (error) {
      // El enlace fue creado por esta aceptación y aún no tiene referencia SQL.
      await this.removeArtifact(key);
      throw error;
    }
  }

  openRead(key: string, signal?: AbortSignal): Readable {
    return createReadStream(this.location('artifacts', key), { signal });
  }
  removeTemporary(key: string) {
    return this.remove('tmp', key);
  }
  removeArtifact(key: string) {
    return this.remove('artifacts', key);
  }

  private async remove(folder: 'tmp' | 'artifacts', key: string) {
    try {
      await unlink(this.location(folder, key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private async syncDirectory(folder: string) {
    const directory = await open(join(this.options.root, folder), 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}
