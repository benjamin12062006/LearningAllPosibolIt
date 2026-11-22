import { describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import { IdentityPoolClient } from 'google-auth-library';
import {
  createGoogleStorage,
  createVercelFederatedClient,
  LatestVercelOidcToken,
  readGoogleFederation,
  rememberVercelOidcToken,
  vercelOidcToken,
} from '../../../src/artifacts/vercel-federation.js';

const FEDERATION = {
  GCP_PROJECT_NUMBER: '758688457791',
  GCP_WORKLOAD_IDENTITY_POOL_ID: 'vercel',
  GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: 'vercel',
  GCP_SERVICE_ACCOUNT_EMAIL:
    'ktsu-api-vercel@estadistica-forms-api.iam.gserviceaccount.com',
};

function requestWith(headers: Record<string, string>) {
  return { headers } as unknown as Request;
}

describe('Credenciales de Google en Vercel (deploys, plan 08)', () => {
  describe('readGoogleFederation', () => {
    it('sin GCP_PROJECT_NUMBER no hay federación (local, pruebas, GKE)', () => {
      expect(readGoogleFederation({})).toBeUndefined();
      expect(
        readGoogleFederation({ GCP_PROJECT_NUMBER: '  ' }),
      ).toBeUndefined();
    });

    it('con las cuatro variables devuelve la configuración', () => {
      expect(readGoogleFederation(FEDERATION)).toEqual({
        projectNumber: '758688457791',
        poolId: 'vercel',
        providerId: 'vercel',
        serviceAccountEmail: FEDERATION.GCP_SERVICE_ACCOUNT_EMAIL,
      });
    });

    it('si falta alguna, no arranca y dice cuál', () => {
      expect(() =>
        readGoogleFederation({
          ...FEDERATION,
          GCP_SERVICE_ACCOUNT_EMAIL: undefined,
        }),
      ).toThrow('GCP_SERVICE_ACCOUNT_EMAIL');
    });
  });

  describe('LatestVercelOidcToken', () => {
    it('antes de la primera petición, falla', async () => {
      await expect(
        new LatestVercelOidcToken().getSubjectToken(),
      ).rejects.toThrow('Todavía no ha llegado ningún token OIDC');
    });

    it('entrega siempre el último token recibido', async () => {
      const token = new LatestVercelOidcToken();
      token.remember('primero');
      token.remember('segundo');
      await expect(token.getSubjectToken()).resolves.toBe('segundo');
    });
  });

  describe('rememberVercelOidcToken', () => {
    it('guarda la cabecera de Vercel y sigue con la petición', async () => {
      const next = jest.fn<() => void>();
      rememberVercelOidcToken(
        requestWith({ 'x-vercel-oidc-token': 'token-de-la-peticion' }),
        {} as Response,
        next as NextFunction,
      );
      expect(next).toHaveBeenCalledTimes(1);
      await expect(vercelOidcToken.getSubjectToken()).resolves.toBe(
        'token-de-la-peticion',
      );
    });

    it('una petición sin cabecera no borra el token anterior', async () => {
      vercelOidcToken.remember('anterior');
      const next = jest.fn<() => void>();
      rememberVercelOidcToken(
        requestWith({}),
        {} as Response,
        next as NextFunction,
      );
      expect(next).toHaveBeenCalledTimes(1);
      await expect(vercelOidcToken.getSubjectToken()).resolves.toBe('anterior');
    });
  });

  describe('createVercelFederatedClient', () => {
    it('cambia el token de Vercel por la cuenta de servicio del pool', async () => {
      const token = new LatestVercelOidcToken();
      token.remember('token-oidc');
      const client = createVercelFederatedClient(
        readGoogleFederation(FEDERATION)!,
        token,
      );

      await expect(client.retrieveSubjectToken()).resolves.toBe('token-oidc');
      expect(client.getServiceAccountEmail()).toBe(
        FEDERATION.GCP_SERVICE_ACCOUNT_EMAIL,
      );
      // `audience` es protegida: se lee como la ve Google al pedir el acceso.
      expect((client as unknown as { audience: string }).audience).toBe(
        '//iam.googleapis.com/projects/758688457791/locations/global' +
          '/workloadIdentityPools/vercel/providers/vercel',
      );
    });
  });

  describe('createGoogleStorage', () => {
    it('en Vercel, Cloud Storage usa las credenciales federadas', async () => {
      const storage = createGoogleStorage(FEDERATION);
      await expect(storage.authClient.getClient()).resolves.toBeInstanceOf(
        IdentityPoolClient,
      );
    });

    it('fuera de Vercel, no usa la federación', () => {
      const storage = createGoogleStorage({});
      expect(storage.authClient.cachedCredential).not.toBeInstanceOf(
        IdentityPoolClient,
      );
    });
  });
});
