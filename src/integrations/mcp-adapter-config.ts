const ADAPTER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,512}$/;

/**
 * Lee `MCP_ADAPTER_SERVICE_TOKEN`: el secreto con el que el servidor MCP se
 * identifica ante Nest. El lanzador MCP recibe ese valor como
 * `KTSU_MCP_ADAPTER_TOKEN`. La credencial del proyecto se valida aparte.
 * Sin secreto de adaptador, la pasarela responde 503.
 */
export function mcpAdapterTokenFrom(
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  const token = env.MCP_ADAPTER_SERVICE_TOKEN?.trim();
  if (!token) {
    return null;
  }
  if (!ADAPTER_TOKEN_PATTERN.test(token)) {
    throw new Error(
      'MCP_ADAPTER_SERVICE_TOKEN debe usar base64url y tener entre 32 y 512 caracteres.',
    );
  }
  return token;
}
