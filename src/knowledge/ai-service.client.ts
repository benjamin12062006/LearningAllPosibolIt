import { fetchIdentityToken } from './google-identity-token.js';
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
  /**
   * Solo en Cloud Run, con FastAPI privado: audiencia del ID token de Google
   * que se manda además del token de servicio (deploys, plan 06, D9).
   */
  identityAudience?: string;
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

/** Lo que Nest manda al agente en cada ejecución (contrato A11 del servicio). */
export type AgentRunRequest = Readonly<{
  runId: string;
  scope: Readonly<{ organizationId: string; projectIds: readonly string[] }>;
  credential: string;
  message: string;
  history: readonly Readonly<{ role: 'user' | 'assistant'; content: string }>[];
  operations: readonly Readonly<{
    name: string;
    description: string;
    inputSchema: Readonly<Record<string, unknown>>;
    level: 'read' | 'write';
  }>[];
  context: Readonly<Record<string, unknown>>;
}>;

/** El desenlace que devuelve el agente; Nest lo valida antes de guardarlo. */
export type AgentRunResponse = Readonly<{
  status:
    | 'answered'
    | 'confirmation_required'
    | 'needs_clarification'
    | 'limit_reached';
  answer: string;
}>;

const AGENT_STATUSES = new Set([
  'answered',
  'confirmation_required',
  'needs_clarification',
  'limit_reached',
]);

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

  async searchKnowledge(
    scope: { organizationId: string; projectId: string },
    query: string,
    limit: number,
    requestId: string,
  ): Promise<unknown> {
    const { organizationId, projectId } = scope;
    const response = await this.send(
      'POST',
      '/v1/knowledge/search',
      { organizationId, projectIds: [projectId], query, limit },
      requestId,
      { timeoutMs: 20_000 },
    );
    const result: unknown = await response.json();
    if (!hasScopedHits(result, projectId, limit)) {
      throw new AiServiceUnavailableError(
        'Respuesta de conocimiento inesperada.',
      );
    }
    return result;
  }

  /**
   * Una ejecución del agente (E6.3a). Tarda lo que tarde el modelo: tiene su
   * propio plazo y la señal del worker para cortarla al apagar.
   */
  async runAgent(
    body: AgentRunRequest,
    requestId: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<AgentRunResponse> {
    const response = await this.send(
      'POST',
      '/v1/agent/runs',
      body,
      requestId,
      {
        timeoutMs,
        signal,
      },
    );
    return toAgentRunResponse(await response.json());
  }

  private async send(
    method: 'PUT' | 'DELETE' | 'POST',
    path: string,
    body: unknown,
    requestId: string,
    limits: Readonly<{ timeoutMs?: number; signal?: AbortSignal }> = {},
  ): Promise<Response> {
    const response = await this.fetchOrUnavailable(
      method,
      path,
      body,
      requestId,
      limits,
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
    limits: Readonly<{ timeoutMs?: number; signal?: AbortSignal }>,
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(
      limits.timeoutMs ?? this.config.timeoutMs,
    );
    try {
      return await fetch(new URL(path, this.config.url), {
        method,
        redirect: 'error',
        headers: await this.headersFor(requestId),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: limits.signal
          ? AbortSignal.any([timeout, limits.signal])
          : timeout,
      });
    } catch (error) {
      throw new AiServiceUnavailableError(
        `No se pudo hablar con el servicio de IA: ${errorName(error)}.`,
      );
    }
  }

  /**
   * El token de servicio va siempre en `Authorization`. Con FastAPI privado en
   * Cloud Run, el ID token de Google va en `X-Serverless-Authorization`: lo
   * comprueba el IAM de Cloud Run, que deja `Authorization` para la aplicación
   * (deploys, fuentes 03, F13). Si no se obtiene, es como si el servicio no
   * respondiera.
   */
  private async headersFor(requestId: string): Promise<Record<string, string>> {
    const headers = {
      Authorization: `Bearer ${this.config.token}`,
      'Content-Type': 'application/json',
      'X-Request-Id': requestId,
    };
    if (!this.config.identityAudience) {
      return headers;
    }
    const identityToken = await fetchIdentityToken(
      this.config.identityAudience,
    );
    return {
      ...headers,
      'X-Serverless-Authorization': `Bearer ${identityToken}`,
    };
  }
}

function hasScopedHits(
  result: unknown,
  projectId: string,
  limit: number,
): boolean {
  if (!result || typeof result !== 'object' || !('hits' in result)) {
    return false;
  }
  const { hits } = result;
  return (
    Array.isArray(hits) &&
    hits.length <= limit &&
    hits.every(
      (hit: unknown) =>
        hit !== null &&
        typeof hit === 'object' &&
        'projectId' in hit &&
        hit.projectId === projectId &&
        'text' in hit &&
        typeof hit.text === 'string',
    )
  );
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

function toAgentRunResponse(body: unknown): AgentRunResponse {
  if (typeof body === 'object' && body !== null) {
    const record = body as Record<string, unknown>;
    if (
      typeof record.status === 'string' &&
      AGENT_STATUSES.has(record.status) &&
      typeof record.answer === 'string'
    ) {
      return {
        status: record.status as AgentRunResponse['status'],
        answer: record.answer,
      };
    }
  }
  throw new AiServiceUnavailableError(
    'El agente respondió con una forma inesperada.',
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
