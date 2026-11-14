/**
 * Servidor de metadatos de Google, el que tiene cada instancia de Cloud Run.
 * `GCE_METADATA_HOST` lo sustituye, igual que en las librerías de Google (lo
 * usan las pruebas).
 */
const DEFAULT_METADATA_HOST = 'metadata.google.internal';

/** El servidor de metadatos es local a la instancia: responde enseguida o no está. */
const METADATA_TIMEOUT_MS = 5_000;

/**
 * Pide un ID token de Google para `audience` con la identidad de la cuenta de
 * servicio de esta revisión de Cloud Run (deploys, fuentes 03, F13). Con él, el
 * IAM de Cloud Run deja pasar la petición a un servicio privado. No se guarda:
 * el servidor de metadatos ya los reutiliza mientras son válidos.
 */
export async function fetchIdentityToken(audience: string): Promise<string> {
  const host = process.env.GCE_METADATA_HOST?.trim() || DEFAULT_METADATA_HOST;
  const url = new URL(
    `http://${host}/computeMetadata/v1/instance/service-accounts/default/identity`,
  );
  url.searchParams.set('audience', audience);

  const response = await fetch(url, {
    headers: { 'Metadata-Flavor': 'Google' },
    signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`El servidor de metadatos respondió ${response.status}.`);
  }
  return (await response.text()).trim();
}
