import { createServer } from 'node:http';
import { text } from 'node:stream/consumers';
import {
  type KnowledgeDocument,
  type SourceKey,
} from '../../../../src/knowledge/knowledge.types.js';

export const TEST_SERVICE_TOKEN = 'test-knowledge-service-token-only';

type KnowledgeRequest = Readonly<{
  method: string | undefined;
  path: string;
  authorization: string | undefined;
  requestId: string | string[] | undefined;
  documents: readonly KnowledgeDocument[];
}>;

export async function startAiHttpFixture() {
  const requests: KnowledgeRequest[] = [];
  const server = createServer((request, response) => {
    void text(request)
      .then((body) => {
        const parsed =
          body === ''
            ? null
            : (JSON.parse(body) as {
                documents: readonly KnowledgeDocument[];
              });
        const documents = parsed?.documents ?? [];
        requests.push({
          method: request.method,
          path: request.url ?? '',
          authorization: request.headers.authorization,
          requestId: request.headers['x-request-id'],
          documents,
        });
        if (request.method === 'DELETE') {
          response.writeHead(204).end();
          return;
        }
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({
            written: documents.length,
            unchanged: 0,
            removed: 0,
          }),
        );
      })
      .catch(() => response.writeHead(400).end());
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('El servicio de IA de prueba necesita un puerto local.');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    documentsOf(key: SourceKey) {
      const source = requests.findLast(
        ({ method, path }) => method === 'PUT' && path === knowledgePath(key),
      );
      if (!source) throw new Error(`No se indexó ${knowledgePath(key)}.`);
      return source.documents;
    },
    reset() {
      requests.length = 0;
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

export function knowledgePath(key: SourceKey) {
  const { organizationId, projectId, sourceType, sourceId } = key;
  return `/v1/knowledge/organizations/${organizationId}/projects/${projectId}/sources/${sourceType}/${sourceId}`;
}
