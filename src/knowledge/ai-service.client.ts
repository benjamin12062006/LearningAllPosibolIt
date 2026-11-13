import type {
  KnowledgeDocument,
  SourceKey,
  SourceType,
} from './knowledge.types.js';

/** Conexión con el servicio de IA (D14). */
export type AiServiceConfig = Readonly<{
  url: string;
  token: string;
  timeoutMs: number;
}>;

/** El cliente, o `null` si el conocimiento está desactivado (sin `AI_SERVICE_URL`). */
export const AI_SERVICE_CLIENT = Symbol('AI_SERVICE_CLIENT');

/**
 * Indexar una fuente grande tarda: los embeddings de Google van de 32 en 32 y 4
 * a la vez (bitácora 02 del servicio). 5.000 filas ≈ 1 minuto.
 */
export const AI_SERVICE_TIMEOUT_MS = 180_000;

/** Lo que devuelve el servicio al reemplazar una fuente. */
export type ReplaceResult = Readonly<{
  written: number;
  unchanged: number;
  removed: number;
}>;

/**
 * El servicio no respondió o respondió 5xx: se reintenta en la pasada
 * siguiente sin guardar la huella (D15).
 */
export class AiServiceUnavailableError extends Error {}

/**
 * El servicio rechazó lo enviado (4xx): es un fallo de Nest, no del servicio.
 * Reintentar no lo arregla; se registra el código y se sigue con lo demás.
 */
export class AiServiceRejectedError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`El servicio de IA rechazó la petición (${status} ${code ?? ''}).`);
  }
}

/**
 * Cliente HTTP del servicio de IA (plan E6, D6 y D14). Solo habla con él Nest,
 * con el token de servicio; nunca reenvía la sesión de la persona. Lo crea la
 * fábrica del módulo con la configuración del entorno.
 */
export class AiServiceClient {
  constructor(private readonly config: AiServiceConfig) {}

  async replaceSource(
    key: SourceKey,
    documents: readonly KnowledgeDocument[],
    requestId: string,
  ): Promise<ReplaceResult> {
    const response = await this.send(
      'PUT',
      sourcePath(key),
      { documents },
      requestId,
    );
    return toReplaceResult(await response.json());
  }

  async removeSource(key: SourceKey, requestId: string): Promise<void> {
    await this.send('DELETE', sourcePath(key), undefined, requestId);
  }

  async removeProject(
    organizationId: string,
    projectId: string,
    requestId: string,
  ): Promise<void> {
    await this.send(
      'DELETE',
      projectPath(organizationId, projectId),
      undefined,
      requestId,
    );
  }

  private async send(
    method: 'PUT' | 'DELETE',
    path: string,
    body: unknown,
    requestId: string,
  ): Promise<Response> {
    const response = await this.fetchOrUnavailable(
      method,
      path,
      body,
      requestId,
    );
    if (response.status >= 500) {
      throw new AiServiceUnavailableError(
        `El servicio de IA respondió ${response.status}.`,
      );
    }
    if (!response.ok) {
      throw new AiServiceRejectedError(
        response.status,
        await readErrorCode(response),
      );
    }
    return response;
  }

  /** Red caída o plazo vencido: lo mismo que un 503 para quien llama. */
  private async fetchOrUnavailable(
    method: string,
    path: string,
    body: unknown,
    requestId: string,
  ): Promise<Response> {
    try {
      return await fetch(new URL(path, this.config.url), {
        method,
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          'Content-Type': 'application/json',
          'X-Request-Id': requestId,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      throw new AiServiceUnavailableError(
        `No se pudo hablar con el servicio de IA: ${errorName(error)}.`,
      );
    }
  }
}

function projectPath(organizationId: string, projectId: string) {
  return `/v1/knowledge/organizations/${organizationId}/projects/${projectId}`;
}

function sourcePath(key: SourceKey) {
  const type: SourceType = key.sourceType;
  return `${projectPath(key.organizationId, key.projectId)}/sources/${type}/${key.sourceId}`;
}

function toReplaceResult(body: unknown): ReplaceResult {
  if (isReplaceResult(body)) {
    return body;
  }
  throw new AiServiceUnavailableError(
    'El servicio de IA respondió con una forma inesperada.',
  );
}

function isReplaceResult(value: unknown): value is ReplaceResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return ['written', 'unchanged', 'removed'].every((field) =>
    Number.isInteger(record[field]),
  );
}

async function readErrorCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'code' in body) {
      return typeof body.code === 'string' ? body.code : null;
    }
  } catch {
    // Un cuerpo que no es JSON no tiene código; el estado basta.
  }
  return null;
}

/** Solo el nombre del error: el mensaje podría llevar la URL. */
function errorName(error: unknown) {
  return error instanceof Error ? error.name : 'Error';
}
