import {
  AI_SERVICE_TIMEOUT_MS,
  type AiServiceConfig,
} from './ai-service.client.js';

/** Mínimo del servicio de IA (`MIN_SERVICE_TOKEN_LENGTH`): mismo token en los dos. */
const MIN_TOKEN_LENGTH = 32;

/**
 * Lee `AI_SERVICE_URL` y `AI_SERVICE_TOKEN` (D14). Sin URL, el conocimiento
 * está desactivado (`null`). Con URL pero sin un token válido, la API no
 * arranca: sería un despliegue a medias que nunca indexaría nada.
 *
 * `AI_SERVICE_ID_TOKEN_AUDIENCE` es opcional: en Cloud Run, la URL del FastAPI
 * privado, para pedir su ID token de Google (deploys, plan 06, D9).
 */
export function aiServiceConfigFrom(
  env: Readonly<Record<string, string | undefined>>,
): AiServiceConfig | null {
  const url = env.AI_SERVICE_URL?.trim();
  if (!url) {
    return null;
  }
  const token = env.AI_SERVICE_TOKEN?.trim() ?? '';
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `AI_SERVICE_TOKEN debe tener al menos ${MIN_TOKEN_LENGTH} caracteres si hay AI_SERVICE_URL.`,
    );
  }
  if (!isHttpUrl(url)) {
    throw new Error('AI_SERVICE_URL debe ser una URL http(s).');
  }

  const config: AiServiceConfig = {
    url,
    token,
    timeoutMs: AI_SERVICE_TIMEOUT_MS,
  };
  const audience = env.AI_SERVICE_ID_TOKEN_AUDIENCE?.trim();
  if (!audience) {
    return config;
  }
  if (!isHttpUrl(audience)) {
    throw new Error('AI_SERVICE_ID_TOKEN_AUDIENCE debe ser una URL http(s).');
  }
  return { ...config, identityAudience: audience };
}

function isHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
