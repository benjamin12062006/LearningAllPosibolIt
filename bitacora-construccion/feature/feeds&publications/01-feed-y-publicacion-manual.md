# 01 — Feed del proyecto y publicación manual (E1)

Fecha de creación: 2026-11-02  
Última actualización: 2026-11-02 (etapa cerrada)  
Estado: Implementado y verificado en local. Migración creada y probada con PGlite; **sin aplicar en Neon** (la aplica el usuario con `pnpm db:status` y `pnpm db:migrate`). La URL pública, la rotación del token y la retirada de archivos de `feeds/` llegan en E2.  
Ámbito: etapa E1 del [plan 01](../../../docs/plans/feature/feeds&publications/01-plan-feeds-y-publicaciones.md): migración `feeds` + `feed_versions`, `FeedsModule`, crear feed con token, consultar feed y publicar con generación esperada (D5, D6, parte de D7 y D13).  
Relacionada con: [plan 01](../../../docs/plans/feature/feeds&publications/01-plan-feeds-y-publicaciones.md), [fuentes de E1](../../../docs/fonts/feature/feeds&publications/05-puntero-publicado-y-enlace-del-archivo.md), [cursos y reconstrucciones](../../../docs/fonts/feature/feeds&publications/03-cursos-y-reconstrucciones.md) (RC1), [fuentes técnicas](../../../docs/fonts/feature/feeds&publications/02-fuentes-tecnicas.md) (F18, F25).  
Revisión de partida: `f6b4bf9` con cambios sin commit (revisión de legibilidad, investigación de GraphQL, fichas y plan de esta feature). Línea base: 31 suites y 585 pruebas en verde.

## Necesidad y punto de partida

El usuario pidió empezar E1. Ya existían la exportación verificada (`exports/<uuid>.tsv`, SHA-256) y `ArtifactStore` con escritura atómica.

Investigación de la etapa: [ficha 05](../../../docs/fonts/feature/feeds&publications/05-puntero-publicado-y-enlace-del-archivo.md) (FK compuestas y `NO ACTION` en PostgreSQL; `link(2)`). Resolvió la duda que el plan dejó abierta en D5: no hace falta una FK diferible.

## Evidencia y decisiones

| Decisión | Evidencia | Aplicación |
| --- | --- | --- |
| Un feed por proyecto, versión con archivo propio (D5) | F3, F29, F30 | Migración `20261102000100_create_feeds`. `UNIQUE (project_id)`. La versión guarda `artifact_key`, checksum, tamaño y filas; `export_id` y `evaluation_id` con `ON DELETE SET NULL`. |
| El puntero solo admite una versión del propio feed | F29 | FK compuesta `feeds (id, published_version_id) → feed_versions (feed_id, id)` con `UNIQUE (feed_id, id)`; nula no se comprueba. Sin `DEFERRABLE`: la versión se inserta antes de mover el puntero. |
| Generación y puntero siempre juntos | — (invariante propia) | `CHECK ((generation = 0) = (published_version_id IS NULL))`. |
| Publicar con generación esperada (D6) | RC1 (l. 35–51), F18 | `UPDATE … SET generation = generation + 1, published_version_id = … WHERE id = … AND generation = $esperada RETURNING id`; sin filas → `409 FEED_GENERATION_CONFLICT` y la transacción se deshace con la versión insertada. |
| El archivo fuera de la transacción y verificado (D5, invariante 5) | F27, F30 | `ArtifactStore.linkFeedVersion`: `link` de `exports/<clave>` a `feeds/<versionId>.tsv`, `fsync` del directorio y relectura con tamaño y SHA-256. Si la versión no se guarda, el servicio borra el enlace. |
| Token de 32 bytes; solo se guarda su hash (D7) | F25, C8 | `delivery-token.ts`: `randomBytes(32)` en `base64url` y SHA-256 en hexadecimal. La URL solo se devuelve al crear. |

### Ajustes al escribir el código (marcados «en E1» en el plan)

- **La generación se comprueba antes que «ya publicado».** El plan devolvía `200` si el TSV era el vigente; ahora, si además la generación enviada no es la actual, responde `409`. Así un conflicto nunca se oculta.
- **`GET …/feeds`** (lista, como mucho un elemento): el cliente necesita encontrar el id del feed después de crearlo.
- **`FOR UPDATE` del feed** dentro de la transacción de publicar, además de la condición del `UPDATE`. Así dos publicaciones se esperan en lugar de fallar con un error de FK si el feed se borra entretanto. La condición sigue siendo el control de concurrencia (RC1).
- **`FOR SHARE` de la exportación** al publicar, con el mismo criterio que la exportación usa con su evaluación: si se borra la importación entretanto, `404 EXPORT_NOT_FOUND`.
- **`verifyExport` se generaliza a `verifyStored(folder, …)`**: misma comprobación para `exports/` y `feeds/`, mismo mensaje de error, que ya fijaban las pruebas de exportación (siguen sin cambios).
- **La publicación de una exportación de otro proyecto** se filtra dos veces (lectura y bloqueo); se probó con un defecto que quita las dos a la vez (M7).

## Implementación y funcionamiento

- [migration.sql](../../../prisma/migrations/20261102000100_create_feeds/migration.sql) y modelos `Feed` y `FeedVersion` en [schema.prisma](../../../prisma/schema.prisma). Los nombres de restricciones salen de `prisma migrate diff`; los `CHECK`, añadidos a mano.
- [src/feeds/](../../../src/feeds/):
  - `delivery-token.ts`, funciones puras;
  - `feeds.repository.ts`: consultas por propietario y transacción de publicar (`lockFeed`, `lockExport`, insertar, `movePublishedPointer`);
  - `feeds.service.ts`: `create`, `findAll`, `findOne` y `publish`, este último con enlace, publicación y descarte del archivo;
  - `feeds.controller.ts`: `POST/GET …/feeds`, `GET …/feeds/:feedId` y `POST …/feeds/:feedId/publications`, que responde `201` o `200`;
  - `feeds.module.ts`, que lee `exports` con su propio repositorio, sin depender de `ExportsModule`.
- [artifact.store.ts](../../../src/artifacts/artifact.store.ts): carpeta `feeds/`, `linkFeedVersion` y `removeFeedVersion`.
- Códigos `FEED_NOT_FOUND` (404), `FEED_ALREADY_EXISTS` (409) y `FEED_GENERATION_CONFLICT` (409), con textos es/en.

## Comprobación

| Comprobación | Resultado |
| --- | --- |
| Pruebas nuevas | 45: 6 unitarias del token, 9 del almacén (`feeds/`), 18 de integración con PGlite y 12 E2E con dos propietarios. Además, 3 que `messages.spec` genera por cada código nuevo. |
| Suite completa | 35 suites y 633 pruebas en verde (antes 31 y 585). Ninguna aserción existente cambió; solo el conteo de migraciones (10 → 11) y la lista de `test/prisma-migrations.test.mjs`. |
| `tsc --noEmit`, `pnpm lint`, `prettier --check src test/features` | Sin errores. |
| Esquema frente a migraciones | «This is an empty migration». |
| `pnpm db:verify` | 3/3 en PGlite. |
| Arranque real de `AppModule` (PGlite, Descope simulado) | Las cuatro rutas nuevas responden `401` sin sesión; se crea la carpeta `feeds/`. |
| Defectos a propósito (script en memoria, restauración comprobada byte a byte) | 12 de 13 detectados. M13 (quitar el `FOR UPDATE` del feed) sobrevive: PGlite es de una sola conexión y no puede demostrar esperas entre transacciones (R4). |

Los defectos fueron:

- M1, condición de generación;
- M2, generación sin subir;
- M3, «ya publicado»;
- M4, descarte del archivo;
- M5, 503;
- M6, token en lugar de hash;
- M7, filtro de proyecto;
- M8, FK compuesta;
- M9, `CHECK`;
- M10, verificación del enlace;
- M11, estado `200`;
- M12, `@Min(0)`;
- M13, `FOR UPDATE`.

**Defecto real encontrado por las pruebas:** `linkFeedVersion` construía el resultado con `{ key: versionKey, ...expected }`. Si quien llamaba pasaba un objeto con su propia `key`, se pisaba la de la versión y la relectura buscaba otro archivo. Se corrigió copiando solo `byteSize` y `checksum`.

**Otro tropiezo:** se escribió por error un identificador con una «е» cirílica en la prueba E2E (trampa 2 del traspaso). Se detectó al revisar y se renombró a `aliceSession`.

## Consecuencias y continuidad

- **Archivos de `feeds/` tras borrar un proyecto:** la cascada borra las filas, pero los archivos quedan hasta E2, que añade sus claves a `deleteProject` y la limpieza de huérfanos.
- **`deliveryUrl` apunta a `/feeds/<token>.tsv`,** que todavía no existe: llega en E2, igual que `downloadUrl` en la exportación.
- **Pendiente del usuario:** aplicar la migración en Neon.
- **Siguiente:** E2 (URL pública, caché y retención).
