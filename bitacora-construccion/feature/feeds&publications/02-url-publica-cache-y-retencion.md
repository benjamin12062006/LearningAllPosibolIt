# 02 — URL pública, caché y retención (E2)

Fecha de creación: 2026-11-02  
Última actualización: 2026-11-02 (etapa cerrada)  
Estado: Implementado y verificado en local. Sin migración nueva. La comprobación con Merchant Center desde una URL pública queda pendiente para el piloto (D15).  
Ámbito: etapa E2 del [plan 01](../../../docs/plans/feature/feeds&publications/01-plan-feeds-y-publicaciones.md): ruta pública `/feeds/<token>.tsv` fuera del prefijo, rotar y desactivar el token, `ETag`/`304`, apertura previa, retención y limpieza de `feeds/`, y claves en `deleteProject` (D7, D8, D14).  
Relacionada con: [plan 01](../../../docs/plans/feature/feeds&publications/01-plan-feeds-y-publicaciones.md), [bitácora 01](01-feed-y-publicacion-manual.md), [fuentes de E2](../../../docs/fonts/feature/feeds&publications/06-ruta-publica-sin-prefijo-ni-version.md), [fuentes técnicas](../../../docs/fonts/feature/feeds&publications/02-fuentes-tecnicas.md) (F23, F24), [cursos y reconstrucciones](../../../docs/fonts/feature/feeds&publications/03-cursos-y-reconstrucciones.md) (C7, C8).  
Revisión de partida: `f6b4bf9` con los cambios sin commit de E1. Línea base: 35 suites y 633 pruebas en verde.

## Necesidad y punto de partida

El usuario pidió empezar E2. Tras E1 ya existían el feed, sus versiones con archivo propio y el token guardado como hash.

Investigación de la etapa: [ficha 06](../../../docs/fonts/feature/feeds&publications/06-ruta-publica-sin-prefijo-ni-version.md) (NestJS: `VERSION_NEUTRAL`). Lo que no se encontró en una página oficial leída (`HEAD` en Express, ausencia de `ETag` automático con streams) se comprobó con pruebas.

## Evidencia y decisiones

| Decisión | Evidencia | Aplicación |
| --- | --- | --- |
| Ruta fuera de `/api` y de `/v1` (D7) | F24, F31 | `setGlobalPrefix('api', { exclude: ['feeds/:file'] })` y `@Controller({ path: 'feeds', version: VERSION_NEUTRAL })`. Prueba E2E: responde en `/feeds/<token>.tsv`; `404` en `/api/v1/…`, `/api/…` y `/v1/…`. |
| El mismo `404` para todos los «no» (D7) | C8 | Nombre mal formado (sin consultar la base), token desconocido o rotado, entrega desactivada o feed sin publicar → `FEED_NOT_FOUND`, con el mismo cuerpo. |
| `ETag` fuerte y comparación débil propia (D8) | F23 | `ETag: "<sha256>"`; `If-None-Match` con la etiqueta, `W/…`, una lista o `*` → `304` sin cuerpo. Funciones puras en `feed-delivery.ts`. |
| `Cache-Control: no-cache` (D8) | C7 | En `200` y en `304`. |
| Abrir antes de responder; `503` sin el token (D7) | Patrón de reviews&exports (R2) | `ArtifactStore.openFeedVersion`; si falta → `503 FEED_FILE_UNAVAILABLE` y registro `FEED_FILE_MISSING` con el id del feed. |
| Rotar y desactivar (D7) | C8, F25 | `POST …/delivery-token` → `200` con la URL nueva (el hash anterior se sustituye); `DELETE …/delivery-token` → `204` y hash nulo. |
| Retención de 3 archivos (D14) | — (propuesta del plan) | Tras publicar, `retireOldFiles` (CTE con `OFFSET retained − 1`, sin contar el publicado) pone `artifact_key = NULL` y devuelve las claves; el servicio borra los archivos después del commit. Si falla, se registra `FEED_RETENTION_FAILED` y la publicación sigue hecha. |
| Archivos de un proyecto borrado (D14) | Patrón de reviews&exports (E6) | `deleteProject` bloquea los feeds del proyecto y devuelve `feedArtifactKeys`; el servicio los borra tras el commit (`FEED_ORPHAN_RETAINED` si falla). `FeedCleanupService` retira huérfanos al arrancar con `removeOrphans`. |

### Ajustes al escribir el código (marcados «en E2» en el plan)

- **`deleteProject` cambia de forma:** devuelve `{ imports, feedArtifactKeys }` en lugar de la lista de importaciones. Las claves del feed tienen que leerse bajo el mismo bloqueo que el borrado, así que no podían ir en otra consulta. Tres pruebas existentes se adaptaron solo a la forma (`deleted.imports`, mocks con el objeto nuevo), sin cambiar lo que comprueban.
- **`PRODUCTS_TSV_TYPE` pasa a `products-tsv.ts`:** lo usan la descarga privada y la URL pública. El controlador de exportaciones lo importa de allí; el valor no cambia.
- **Servicio y controlador públicos propios** (`FeedDeliveryService`, `FeedDeliveryController`): la entrega no tiene sesión ni propietario, y separarla deja claro qué rutas no pasan por `DescopeSessionGuard`.
- **`artifactKey` nulo en la versión publicada** se trata igual que un archivo ausente (`503`). La retención nunca lo retira; es solo una defensa.
- **Rotar responde `200`,** no `201`: cambia el feed, no crea un recurso.

## Implementación y funcionamiento

- [src/feeds/](../../../src/feeds/): `feed-delivery.ts` (puro), `feed-delivery.service.ts`, `feed-delivery.controller.ts`, `feed-cleanup.service.ts`; en `feeds.repository.ts`, `retireOldFiles`, `setDeliveryTokenHash`, `findDeliveryFile` y `findReferencedArtifactKeys`; en `feeds.service.ts`, `rotateDeliveryToken`, `disableDelivery` y la retención tras publicar; `FEED_OPTIONS` (`autoStart`, `retainedFiles: 3`).
- [artifact.store.ts](../../../src/artifacts/artifact.store.ts): `openFeedVersion` y `listFeedVersions`.
- [configure-http.ts](../../../src/configure-http.ts): `exclude` del prefijo.
- [catalog-import](../../../src/catalog-import/): `DeletedProject`, `findFeedKeysLocked` y `removeFeedFiles`.
- Código nuevo `FEED_FILE_UNAVAILABLE` (503), con textos es/en.

## Comprobación

| Comprobación | Resultado |
| --- | --- |
| Pruebas nuevas | 32: 6 unitarias de `feed-delivery`, 2 del almacén, 2 del servicio de importación (archivos del feed al borrar el proyecto), 11 de integración, 10 E2E y 1 generada por el código nuevo. |
| Suite completa | 36 suites y 665 pruebas en verde (antes 35 y 633). Tres pruebas existentes adaptadas a la forma nueva de `deleteProject`. |
| `tsc --noEmit`, `pnpm lint`, `prettier --check src test/features` | Sin errores. |
| Esquema frente a migraciones | «This is an empty migration» (sin migración nueva). |
| Arranque real de `AppModule` | Rutas del operador → `401`; `GET /feeds/<token>.tsv` → `404` (token desconocido) sin sesión; `/api/v1/feeds/…` → `404`; la limpieza al arrancar no falla con la carpeta vacía. |
| Defectos a propósito (restauración comprobada byte a byte) | 14 de 15 detectados. N15 (quitar el `FOR UPDATE` de los feeds en `deleteProject`) sobrevive: PGlite no demuestra esperas entre transacciones (R4). |

Los defectos fueron:

- N1, `304`;
- N2, `W/`;
- N3, `Cache-Control`;
- N4, `VERSION_NEUTRAL`;
- N5, `exclude`;
- N6, rotación;
- N7, validación del nombre;
- N8 y N9, retención;
- N10 y N11, borrado del proyecto;
- N12, limpieza;
- N13, `503`;
- N14, `Content-Length`;
- N15, bloqueo.

## Consecuencias y continuidad

- La URL ya se puede dar a Merchant Center si la API está en una dirección pública; la comprobación real queda para el piloto.
- La limpieza de `feeds/` al arrancar supone una sola instancia, como las de importaciones y exportaciones (R1 del plan).
- **Siguiente:** E3 (fuente remota segura).
