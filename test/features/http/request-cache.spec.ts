import { describe, expect, it, jest } from '@jest/globals';
import type { Request, Response } from 'express';
import {
  openRequestCache,
  rememberForRequest,
} from '../../../src/common/http/request-cache.js';

/** Ejecuta `work` dentro de una petición, como lo hace el middleware. */
function insideRequest<T>(work: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    openRequestCache({} as Request, {} as Response, () => {
      work().then(resolve, reject);
    });
  });
}

describe('rememberForRequest', () => {
  it('dentro de una petición lee una sola vez cada clave', async () => {
    const load = jest.fn(() => Promise.resolve('alice'));

    const results = await insideRequest(() =>
      Promise.all([
        rememberForRequest('user:a', load),
        rememberForRequest('user:a', load),
        rememberForRequest('user:b', load),
      ]),
    );

    expect(results).toEqual(['alice', 'alice', 'alice']);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('cada petición empieza sin nada recordado', async () => {
    const load = jest.fn(() => Promise.resolve(1));

    await insideRequest(() => rememberForRequest('k', load));
    await insideRequest(() => rememberForRequest('k', load));

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('fuera de una petición (procesos de fondo) no recuerda nada', async () => {
    const load = jest.fn(() => Promise.resolve(1));

    await rememberForRequest('k', load);
    await rememberForRequest('k', load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('un fallo no se recuerda: el siguiente intento vuelve a leer', async () => {
    const load = jest
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('caída'))
      .mockResolvedValueOnce('bien');

    const second = await insideRequest(async () => {
      await expect(rememberForRequest('k', load)).rejects.toThrow('caída');
      return rememberForRequest('k', load);
    });

    expect(second).toBe('bien');
    expect(load).toHaveBeenCalledTimes(2);
  });
});
