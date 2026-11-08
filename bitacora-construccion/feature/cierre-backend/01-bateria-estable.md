# 01 — C1: batería estable (E2E de multipart incompleto)

Fecha de creación: 2026-11-08  
Última actualización: 2026-11-08  
Estado: Implementado y verificado.  
Relacionada con: [plan 01 de cierre](../../../docs/plans/feature/cierre-backend/01-plan-cierre-de-pendientes.md) (P3, P8), [fuentes 01](../../../docs/fonts/feature/cierre-backend/01-estado-de-los-pendientes.md) (E6).  
Revisión de partida: `main` `c280506`.

## Necesidad

La prueba «multipart incompleto devuelve 400 y limpia cualquier temporal» de `catalog-import.e2e-spec.ts` falla a veces con la batería completa. Una batería que falla al azar no sirve para comprobar las etapas siguientes. Hay que reproducir el fallo antes de tocar nada y corregirlo sin cambiar la prueba.

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| E6 de la ficha; código de multer 2.4.0 (`lib/make-middleware.js`): si el flujo del archivo emite `error`, resta la escritura pendiente y llama a `abortWithError`, que ya no espera al almacenamiento y responde en cuanto borra lo que tiene apuntado. El archivo a medias no tiene `path`, así que no está en esa lista: lo borra `ArtifactStore.receive` al fallar, pero después de que salga el 400. | P3: la respuesta espera a que termine lo que el almacenamiento tenga en marcha | Clase `StorageWork` en [`import-upload.interceptor.ts`](../../../src/catalog-import/import-upload.interceptor.ts): `_handleFile` anota la subida con `track` y `intercept` llama a `settled()` en su `finally`, antes de borrar `request.file` |
| 30 repeticiones de la suite con la máquina tranquila: ninguna falla. El fallo solo aparece cuando el disco va cargado. | Hacer el fallo seguro con una prueba que retrase el borrado 100 ms, en lugar de fiarse de la suerte | E2E nueva «multipart incompleto: el 400 espera a que se borre el temporal, aunque el disco vaya lento»; la prueba original no cambia |

## Ajustes al escribir el código

- **Solo se espera a la subida.** También se probó a anotar el borrado de multer (`_removeFile`) y a esperar en bucle por si empezaba algo nuevo mientras se esperaba. Se quitaron las dos cosas: multer ya espera a sus propios borrados antes de responder, y el único caso en que no lo hace es cuando el cliente cortó la conexión, donde nadie recibe la respuesta y multer borra el archivo igualmente.
- **El interceptor de hojas (`worksheet-upload.interceptor.ts`) no tiene este problema**: guarda en memoria y no crea temporales.

## Implementación

- `src/catalog-import/import-upload.interceptor.ts`: `StorageWork` (`track`, `settled`), y `receive` y `streamingStorage` lo reciben como parámetro. Ningún contrato cambia: mismas respuestas y mismos códigos.
- `test/features/catalog-import/catalog-import.e2e-spec.ts`: una prueba nueva, después de la original.

## Comprobaciones realmente ejecutadas

2026-11-08, Node 26.9.

- **Antes de corregir:** 30 pasadas en serie de `catalog-import.e2e-spec.ts` (28 pruebas cada una), todas bien: el fallo no se reproduce sin carga. La prueba nueva, con el borrado retrasado, **falla siempre** (queda `<uuid>.csv` en `tmp/`).
- **Después:** las 103 pruebas de importación de catálogo pasan; **suite completa tres veces seguidas**, 86 suites y 1.443 pruebas cada vez, sin fallos.
- `tsc --noEmit`, `pnpm lint` y `prettier --check src test/features`: limpios.
- **Defectos a propósito** (copia limpia, pruebas de catálogo): no esperar a `settled()`, no anotar la subida y esperar a una lista vacía. Los tres los detecta la prueba nueva.

## Consecuencias

- La batería ya no depende de lo rápido que vaya el disco en esa prueba.
- Una petición con un multipart cortado tarda lo que tarde en borrarse su temporal antes de responder: milisegundos.
