import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import {
  getDefaultAutoSelectFamily,
  setDefaultAutoSelectFamily,
} from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '../../../src/artifacts/artifact.store.js';
import { RemoteSourceService } from '../../../src/remote-source/remote-source.service.js';
import {
  RemoteSourceFailure,
  type RemoteSourceOptions,
} from '../../../src/remote-source/remote-source.types.js';

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

const CSV = 'id,title\nSKU-1,Mesa\nSKU-2,Silla\n';
const MIB = 1024 * 1024;

const sourceFailure = (code: string, upstreamStatus?: number) =>
  expect.objectContaining({
    name: 'RemoteSourceFailure',
    detail: expect.objectContaining({ code }),
    upstreamStatus,
  });

// Servidor HTTP local en 127.0.0.1. Con las opciones de producción (solo https
// y destinos públicos) no se podría llegar a él: estas pruebas usan las de
// pruebas, salvo las que comprueban precisamente que se rechaza (ficha 07).
describe('Descarga de la fuente remota contra un servidor local', () => {
  let server: Server;
  let base: string;
  let handler: Handler;
  let hits: string[];
  let root: string;
  let store: ArtifactStore;

  const testOptions: RemoteSourceOptions = {
    timeoutMs: 2_000,
    allowHttp: true,
    allowPrivateNetworks: true,
  };
  const serviceWith = (options: Partial<RemoteSourceOptions> = {}) =>
    new RemoteSourceService(store, { ...testOptions, ...options });
  const tmpFiles = () => readdir(join(root, 'tmp'));

  beforeAll(async () => {
    server = createServer((request, response) => {
      hits.push(`${request.url} host=${request.headers.host}`);
      handler(request, response);
    });
    // `::` escucha en IPv6 e IPv4: `localhost` puede resolver a `::1` o a
    // `127.0.0.1` según el sistema.
    await new Promise<void>((resolve) => server.listen(0, '::', resolve));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  beforeEach(async () => {
    hits = [];
    handler = (_request, response) => response.end(CSV);
    root = await mkdtemp(join(tmpdir(), 'remote-source-'));
    store = new ArtifactStore({ root });
    await store.onModuleInit();
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it('guarda el CSV en tmp con su tamaño y SHA-256, y pide con el nombre del servidor', async () => {
    const downloaded = await serviceWith().download(`${base}/productos.csv`);

    expect(downloaded).toEqual({
      filename: expect.stringMatching(/^[0-9a-f-]{36}\.csv$/),
      size: Buffer.byteLength(CSV),
      hash: createHash('sha256').update(CSV).digest('hex'),
    });
    expect(await readFile(join(root, 'tmp', downloaded.filename), 'utf8')).toBe(
      CSV,
    );
    expect(hits).toEqual([`/productos.csv host=${new URL(base).host}`]);
  });

  it('también resuelve bien cuando la conexión pide una sola dirección', async () => {
    const previous = getDefaultAutoSelectFamily();
    setDefaultAutoSelectFamily(false);
    try {
      await expect(
        serviceWith().download(`${base}/productos.csv`),
      ).resolves.toMatchObject({ size: Buffer.byteLength(CSV) });
    } finally {
      setDefaultAutoSelectFamily(previous);
    }
  });

  it('no sigue redirecciones', async () => {
    handler = (request, response) => {
      if (request.url === '/destino.csv') {
        response.end(CSV);
        return;
      }
      response.writeHead(302, { location: '/destino.csv' }).end();
    };

    await expect(serviceWith().download(`${base}/origen.csv`)).rejects.toEqual(
      sourceFailure('SOURCE_REDIRECT_NOT_ALLOWED'),
    );
    expect(hits).toHaveLength(1);
    expect(await tmpFiles()).toEqual([]);
  });

  it.each([404, 403, 429, 500, 503])(
    'un %i del origen es SOURCE_HTTP_ERROR con ese estado',
    async (status) => {
      handler = (_request, response) =>
        response.writeHead(status).end('error del origen');

      await expect(serviceWith().download(`${base}/a.csv`)).rejects.toEqual(
        sourceFailure('SOURCE_HTTP_ERROR', status),
      );
      expect(await tmpFiles()).toEqual([]);
    },
  );

  it('rechaza por Content-Length sin leer el cuerpo', async () => {
    handler = (_request, response) => {
      response.writeHead(200, { 'content-length': String(11 * MIB) });
      response.write('id\n');
    };

    await expect(serviceWith().download(`${base}/a.csv`)).rejects.toEqual(
      sourceFailure('SOURCE_TOO_LARGE'),
    );
    expect(await tmpFiles()).toEqual([]);
  });

  it('corta al pasar de 10 MiB aunque el origen no declare la longitud', async () => {
    handler = (_request, response) => {
      const chunk = Buffer.alloc(MIB, 'a');
      for (let index = 0; index < 11; index += 1) response.write(chunk);
      response.end();
    };

    await expect(serviceWith().download(`${base}/a.csv`)).rejects.toEqual(
      sourceFailure('SOURCE_TOO_LARGE'),
    );
    expect(await tmpFiles()).toEqual([]);
  });

  it('se agota el tiempo si el origen no responde', async () => {
    handler = () => undefined;

    await expect(
      serviceWith({ timeoutMs: 200 }).download(`${base}/a.csv`),
    ).rejects.toEqual(sourceFailure('SOURCE_TIMEOUT'));
  });

  it('se agota el tiempo si el cuerpo se queda a medias, y no deja nada en tmp', async () => {
    handler = (_request, response) => {
      response.writeHead(200);
      response.write('id,title\n');
    };

    await expect(
      serviceWith({ timeoutMs: 200 }).download(`${base}/a.csv`),
    ).rejects.toEqual(sourceFailure('SOURCE_TIMEOUT'));
    expect(await tmpFiles()).toEqual([]);
  });

  it('un aborto por apagado se propaga tal cual, sin convertirlo en fallo de la fuente', async () => {
    handler = (_request, response) => {
      response.writeHead(200);
      response.write('id,title\n');
    };
    const shutdown = new AbortController();
    setTimeout(() => shutdown.abort(), 100);

    const error = await serviceWith()
      .download(`${base}/a.csv`, shutdown.signal)
      .catch((caught: unknown) => caught);

    expect(error).not.toBeInstanceOf(RemoteSourceFailure);
    expect(error).toMatchObject({ name: 'AbortError' });
    expect(await tmpFiles()).toEqual([]);
  });

  it('un puerto cerrado o un nombre que no existe son SOURCE_UNREACHABLE', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) =>
      closed.listen(0, '127.0.0.1', resolve),
    );
    const port = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));

    await expect(
      serviceWith().download(`http://127.0.0.1:${port}/a.csv`),
    ).rejects.toEqual(sourceFailure('SOURCE_UNREACHABLE'));
    // `.invalid` está reservado y nunca resuelve (RFC 6761).
    await expect(
      serviceWith().download('http://fuente.invalid/a.csv'),
    ).rejects.toEqual(sourceFailure('SOURCE_UNREACHABLE'));
  });

  describe('con las opciones de producción', () => {
    it('rechaza http aunque el servidor exista', async () => {
      await expect(
        serviceWith({ allowHttp: false }).download(`${base}/a.csv`),
      ).rejects.toEqual(sourceFailure('SOURCE_URL_NOT_ALLOWED'));
      expect(hits).toEqual([]);
    });

    it('un nombre que resuelve a una dirección privada no llega a conectar', async () => {
      await expect(
        serviceWith({ allowPrivateNetworks: false }).download(`${base}/a.csv`),
      ).rejects.toEqual(sourceFailure('SOURCE_URL_NOT_ALLOWED'));
      expect(hits).toEqual([]);
    });

    it('una IP privada escrita en la URL se rechaza antes de pedir', async () => {
      const port = new URL(base).port;
      for (const url of [
        `http://127.0.0.1:${port}/a.csv`,
        `http://[::1]:${port}/a.csv`,
        `http://2130706433:${port}/a.csv`,
      ]) {
        await expect(
          serviceWith({ allowPrivateNetworks: false }).download(url),
        ).rejects.toEqual(sourceFailure('SOURCE_URL_NOT_ALLOWED'));
      }
      expect(hits).toEqual([]);
    });

    it('rechaza credenciales en la URL', async () => {
      await expect(
        serviceWith().download(
          `http://usuario:clave@${new URL(base).host}/a.csv`,
        ),
      ).rejects.toEqual(sourceFailure('SOURCE_URL_NOT_ALLOWED'));
      expect(hits).toEqual([]);
    });
  });
});
