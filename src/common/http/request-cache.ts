import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

/**
 * Lecturas que se repiten dentro de una misma petición (plan C7, G2). Una
 * consulta GraphQL con varios campos, o una ruta REST que llama a varios
 * servicios, comprueba cada vez quién es la persona y su acceso al proyecto.
 * Dentro de una petición esas respuestas no cambian, así que se piden una vez.
 *
 * Solo se recuerda lo que se pide con `rememberForRequest`; fuera de una
 * petición (procesos de fondo, pruebas sin HTTP) no hay caché y se lee siempre.
 */
type RequestCache = Map<string, Promise<unknown>>;

const storage = new AsyncLocalStorage<RequestCache>();

/** Middleware: abre la caché de esta petición; todo lo que la atiende la ve. */
export function openRequestCache(
  _request: Request,
  _response: Response,
  next: NextFunction,
) {
  storage.run(new Map(), next);
}

/**
 * Devuelve la lectura ya hecha en esta petición o la hace y la recuerda. Un
 * fallo no se recuerda: la siguiente llamada vuelve a intentarlo.
 */
export function rememberForRequest<T>(
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const cache = storage.getStore();
  if (!cache) {
    return load();
  }
  const remembered = cache.get(key);
  if (remembered) {
    // Cada clave la escribe una sola función, con su tipo: ver las llamadas.
    return remembered as Promise<T>;
  }
  const loading = load();
  cache.set(key, loading);
  loading.catch(() => cache.delete(key));
  return loading;
}
