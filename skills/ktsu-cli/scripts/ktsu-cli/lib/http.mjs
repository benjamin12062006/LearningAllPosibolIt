export class CliError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.details = details;
  }
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export function trustedUrl(value, allowLoopback = true) {
  const url = typeof value === 'string' ? URL.parse(value) : null;
  const canUseHttp =
    allowLoopback && url?.protocol === 'http:' && LOOPBACK.has(url.hostname);
  if (
    !url ||
    (url.protocol !== 'https:' && !canUseHttp) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new CliError(
      'Indica una URL HTTPS válida. Para desarrollo también se acepta HTTP en loopback.',
    );
  }
  return url.href;
}

export async function integrationRequest(
  base,
  path,
  { token, project, body, raw = false } = {},
) {
  let response;
  try {
    response = await fetch(`${base}/api/v1/integrations${path}`, {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
        ...(project && { 'X-Ktsu-Cli-Project': project }),
        ...(body && { 'Content-Type': 'application/json' }),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    const message =
      body?.mode === 'prepare'
        ? 'No se pudo completar la petición a KTSU. Reutiliza --call-id al reintentar.'
        : 'No se pudo conectar a la API de KTSU.';
    throw new CliError(message, { callId: body?.callId });
  }
  if (response.ok && raw && response.body) return response;
  const result = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new CliError(
      result?.message?.es ??
        result?.message?.en ??
        `La API respondió HTTP ${response.status}.`,
      {
        ...(typeof result?.code === 'string' && { code: result.code }),
        requestId: response.headers.get('X-Request-Id') ?? undefined,
        callId: body?.callId,
      },
    );
  }
  if (result === undefined || raw) {
    throw new CliError('KTSU devolvió una respuesta inesperada.', {
      callId: body?.callId,
    });
  }
  return result;
}
