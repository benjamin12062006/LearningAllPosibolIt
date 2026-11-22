import { Storage } from '@google-cloud/storage';
import type { NextFunction, Request, Response } from 'express';
import { IdentityPoolClient } from 'google-auth-library';

/**
 * Credenciales de Google en Vercel, sin claves (deploys, plan 08, D3).
 *
 * En un contenedor de Vercel el token OIDC llega solo en la cabecera
 * `x-vercel-oidc-token` de cada petición: no hay variable ni archivo
 * (deploys, bitácora 07). El middleware guarda el último token y Google lo
 * cambia por un acceso temporal de la cuenta de servicio `ktsu-api-vercel`.
 * Es lo mismo que hace el servicio de IA en `vercel_federation.py`.
 */
export const VERCEL_OIDC_HEADER = 'x-vercel-oidc-token';

const JWT_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:jwt';
const GOOGLE_STS_URL = 'https://sts.googleapis.com/v1/token';

/** El último token OIDC que trajo una petición. */
export class LatestVercelOidcToken {
  private token: string | undefined;

  remember(token: string) {
    this.token = token;
  }

  getSubjectToken(): Promise<string> {
    if (this.token === undefined) {
      // Solo pasa si algo llama a Google antes de recibir ninguna petición,
      // como la limpieza de huérfanos al arrancar (que captura el error).
      return Promise.reject(
        new Error('Todavía no ha llegado ningún token OIDC de Vercel.'),
      );
    }
    return Promise.resolve(this.token);
  }
}

/** Uno por proceso: lo comparten el middleware HTTP y el almacén de archivos. */
export const vercelOidcToken = new LatestVercelOidcToken();

/** Middleware Express: no toca el cuerpo ni la respuesta. */
export function rememberVercelOidcToken(
  request: Request,
  _response: Response,
  next: NextFunction,
) {
  const token = request.headers[VERCEL_OIDC_HEADER];
  if (typeof token === 'string' && token.length > 0) {
    vercelOidcToken.remember(token);
  }
  next();
}

/** Las cuatro variables del pool `vercel` de Google Cloud. */
export type GoogleFederationConfiguration = Readonly<{
  projectNumber: string;
  poolId: string;
  providerId: string;
  serviceAccountEmail: string;
}>;

/**
 * La federación solo se usa en Vercel, donde está `GCP_PROJECT_NUMBER`. Si
 * falta alguna de las otras tres, la API no arranca: mejor que fallar al
 * guardar el primer archivo.
 */
export function readGoogleFederation(
  environment: NodeJS.ProcessEnv,
): GoogleFederationConfiguration | undefined {
  const projectNumber = environment.GCP_PROJECT_NUMBER?.trim();
  if (!projectNumber) {
    return undefined;
  }

  const required = {
    GCP_WORKLOAD_IDENTITY_POOL_ID: environment.GCP_WORKLOAD_IDENTITY_POOL_ID,
    GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID:
      environment.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID,
    GCP_SERVICE_ACCOUNT_EMAIL: environment.GCP_SERVICE_ACCOUNT_EMAIL,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(
      `GCP_PROJECT_NUMBER necesita también: ${missing.join(', ')}.`,
    );
  }

  return {
    projectNumber,
    poolId: required.GCP_WORKLOAD_IDENTITY_POOL_ID!.trim(),
    providerId: required.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID!.trim(),
    serviceAccountEmail: required.GCP_SERVICE_ACCOUNT_EMAIL!.trim(),
  };
}

export function createVercelFederatedClient(
  config: GoogleFederationConfiguration,
  token: LatestVercelOidcToken,
) {
  const pool =
    `projects/${config.projectNumber}/locations/global` +
    `/workloadIdentityPools/${config.poolId}`;
  return new IdentityPoolClient({
    audience: `//iam.googleapis.com/${pool}/providers/${config.providerId}`,
    subject_token_type: JWT_TOKEN_TYPE,
    token_url: GOOGLE_STS_URL,
    subject_token_supplier: { getSubjectToken: () => token.getSubjectToken() },
    service_account_impersonation_url:
      'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/' +
      `${config.serviceAccountEmail}:generateAccessToken`,
  });
}

/**
 * En Vercel, Cloud Storage con las credenciales federadas; en el resto (local,
 * pruebas, GKE), las de siempre (ADC o la cuenta de servicio del pod).
 */
export function createGoogleStorage(environment: NodeJS.ProcessEnv) {
  const federation = readGoogleFederation(environment);
  if (!federation) {
    return new Storage();
  }
  return new Storage({
    authClient: createVercelFederatedClient(federation, vercelOidcToken),
  });
}
