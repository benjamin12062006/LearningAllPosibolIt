import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { aiServiceConfigFrom } from '../../../src/knowledge/ai-service-config.js';
import {
  AiServiceClient,
  AiServiceRejectedError,
  AiServiceUnavailableError,
} from '../../../src/knowledge/ai-service.client.js';
import type { SourceKey } from '../../../src/knowledge/knowledge.types.js';

const TOKEN = 't'.repeat(32);
const KEY: SourceKey = {
  organizationId: 'org-1',
  projectId: 'project-1',
  sourceType: 'catalog',
  sourceId: 'project-1',
};

function client() {
  return new AiServiceClient({
    url: 'http://127.0.0.1:8090',
    token: TOKEN,
    timeoutMs: 1_000,
  });
}

function respondWith(status: number, body: unknown) {
  return jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe('AiServiceClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reemplaza una fuente con el token, el id de petición y los documentos', async () => {
    const fetch = respondWith(200, { written: 1, unchanged: 0, removed: 0 });

    const result = await client().replaceSource(
      KEY,
      [
        {
          documentId: 'product:A',
          text: 'Producto A',
          metadata: { in_feed: true },
        },
      ],
      'knowledge-sync:1',
    );

    expect(result).toEqual({ written: 1, unchanged: 0, removed: 0 });
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe(
      'http://127.0.0.1:8090/v1/knowledge/organizations/org-1/projects/project-1/sources/catalog/project-1',
    );
    expect(init?.method).toBe('PUT');
    expect(init?.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
      'X-Request-Id': 'knowledge-sync:1',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      documents: [
        {
          documentId: 'product:A',
          text: 'Producto A',
          metadata: { in_feed: true },
        },
      ],
    });
  });

  it('borra una fuente o un proyecto con DELETE', async () => {
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));

    await client().removeSource(KEY, 'r1');
    await client().removeProject('org-1', 'project-1', 'r2');

    expect(
      fetch.mock.calls.map(([url, init]) => [init?.method, String(url)]),
    ).toEqual([
      [
        'DELETE',
        'http://127.0.0.1:8090/v1/knowledge/organizations/org-1/projects/project-1/sources/catalog/project-1',
      ],
      [
        'DELETE',
        'http://127.0.0.1:8090/v1/knowledge/organizations/org-1/projects/project-1',
      ],
    ]);
  });

  it('un 5xx, la red caída o una respuesta rara son «no disponible»', async () => {
    respondWith(503, { code: 'KNOWLEDGE_UNAVAILABLE' });
    await expect(client().replaceSource(KEY, [], 'r')).rejects.toBeInstanceOf(
      AiServiceUnavailableError,
    );

    jest.restoreAllMocks();
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new TypeError('fetch failed'));
    await expect(client().removeSource(KEY, 'r')).rejects.toBeInstanceOf(
      AiServiceUnavailableError,
    );

    jest.restoreAllMocks();
    respondWith(200, { written: 'uno' });
    await expect(client().replaceSource(KEY, [], 'r')).rejects.toBeInstanceOf(
      AiServiceUnavailableError,
    );
  });

  it('un 4xx es un rechazo con su código, y el mensaje no lleva el token', async () => {
    respondWith(400, { code: 'VALIDATION_FAILED' });

    const error = await client()
      .replaceSource(KEY, [], 'r')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AiServiceRejectedError);
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    expect(String(error)).not.toContain(TOKEN);
  });
});

describe('aiServiceConfigFrom', () => {
  it('sin URL el conocimiento está desactivado', () => {
    expect(aiServiceConfigFrom({})).toBeNull();
    expect(aiServiceConfigFrom({ AI_SERVICE_URL: '  ' })).toBeNull();
  });

  it('con URL exige un token de 32 caracteres y una URL http(s)', () => {
    expect(() =>
      aiServiceConfigFrom({
        AI_SERVICE_URL: 'http://127.0.0.1:8090',
        AI_SERVICE_TOKEN: 'corto',
      }),
    ).toThrow('AI_SERVICE_TOKEN');
    expect(() =>
      aiServiceConfigFrom({
        AI_SERVICE_URL: 'ftp://x',
        AI_SERVICE_TOKEN: TOKEN,
      }),
    ).toThrow('AI_SERVICE_URL');
    expect(
      aiServiceConfigFrom({
        AI_SERVICE_URL: ' http://127.0.0.1:8090 ',
        AI_SERVICE_TOKEN: ` ${TOKEN} `,
      }),
    ).toEqual({
      url: 'http://127.0.0.1:8090',
      token: TOKEN,
      timeoutMs: 180_000,
    });
  });
});
