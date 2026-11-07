import { crc32, createDeflateRaw } from 'node:zlib';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ByteSink } from '../artifacts/artifacts.types.js';

/** Lo que el directorio central necesita recordar de cada entrada. */
type WrittenEntry = Readonly<{
  name: Buffer;
  offset: number;
  checksum: number;
  compressedSize: number;
  size: number;
}>;

const SIGNATURES = {
  localHeader: 0x04034b50,
  dataDescriptor: 0x08074b50,
  centralHeader: 0x02014b50,
  endOfDirectory: 0x06054b50,
} as const;

/** Versión 2.0 del formato: basta para deflate sin ZIP64. */
const ZIP_VERSION = 20;
const DEFLATE = 8;

/**
 * Bit 3: el CRC y los tamaños van después de los datos (descriptor), porque
 * la hoja se comprime mientras se genera. Bit 11: nombres en UTF-8.
 */
const FLAGS = 0x0008 | 0x0800;

/**
 * Fecha y hora fijas (1980-01-01 00:00, la primera que admite MS-DOS): con la
 * misma revisión, el mismo archivo byte a byte.
 */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

/**
 * Escritor ZIP mínimo para un XLSX generado por la API: entradas deflate, sin
 * cifrado ni ZIP64. Los límites de exportación mantienen el archivo muy por
 * debajo de los 4 GiB del formato clásico. Escribe en orden, sin volver atrás.
 */
export class ZipWriter {
  private readonly entries: WrittenEntry[] = [];
  private offset = 0;

  constructor(private readonly sink: ByteSink) {}

  /** Una entrada cuyo contenido llega por trozos y se comprime al vuelo. */
  async addEntry(
    name: string,
    chunks: AsyncIterable<Buffer> | Iterable<Buffer>,
  ) {
    const entry = {
      name: Buffer.from(name, 'utf8'),
      offset: this.offset,
      checksum: 0,
      compressedSize: 0,
      size: 0,
    };
    await this.write(localHeader(entry.name));

    const measured = async function* () {
      for await (const chunk of chunks) {
        entry.checksum = crc32(chunk, entry.checksum);
        entry.size += chunk.length;
        yield chunk;
      }
    };
    await pipeline(
      Readable.from(measured()),
      createDeflateRaw(),
      this.compressedOutput((length) => {
        entry.compressedSize += length;
      }),
    );

    await this.write(dataDescriptor(entry));
    this.entries.push(entry);
  }

  /** Directorio central y fin de directorio: sin ellos el ZIP no se puede abrir. */
  async finish() {
    const directoryOffset = this.offset;
    for (const entry of this.entries) {
      await this.write(centralHeader(entry));
    }
    await this.write(
      endOfDirectory(
        this.entries.length,
        this.offset - directoryOffset,
        directoryOffset,
      ),
    );
  }

  private async write(chunk: Buffer) {
    await this.sink.write(chunk);
    this.offset += chunk.length;
  }

  private compressedOutput(count: (length: number) => void) {
    return new Writable({
      write: (chunk: Buffer, _encoding, callback) => {
        count(chunk.length);
        this.write(chunk).then(
          () => callback(),
          (error: Error) => callback(error),
        );
      },
    });
  }
}

function localHeader(name: Buffer) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(SIGNATURES.localHeader, 0);
  header.writeUInt16LE(ZIP_VERSION, 4);
  header.writeUInt16LE(FLAGS, 6);
  header.writeUInt16LE(DEFLATE, 8);
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  // CRC y tamaños a cero: van en el descriptor (bit 3).
  header.writeUInt16LE(name.length, 26);
  return Buffer.concat([header, name]);
}

function dataDescriptor(entry: WrittenEntry) {
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(SIGNATURES.dataDescriptor, 0);
  descriptor.writeUInt32LE(entry.checksum, 4);
  descriptor.writeUInt32LE(entry.compressedSize, 8);
  descriptor.writeUInt32LE(entry.size, 12);
  return descriptor;
}

function centralHeader(entry: WrittenEntry) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(SIGNATURES.centralHeader, 0);
  header.writeUInt16LE(ZIP_VERSION, 4);
  header.writeUInt16LE(ZIP_VERSION, 6);
  header.writeUInt16LE(FLAGS, 8);
  header.writeUInt16LE(DEFLATE, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(entry.checksum, 16);
  header.writeUInt32LE(entry.compressedSize, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt32LE(entry.offset, 42);
  return Buffer.concat([header, entry.name]);
}

function endOfDirectory(count: number, size: number, offset: number) {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIGNATURES.endOfDirectory, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return end;
}
