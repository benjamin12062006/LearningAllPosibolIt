# 05 — Eliminar importaciones y proyectos

Fecha de creación: 2026-10-30
Última actualización: 2026-10-30
Estado: Implementado y verificado; migración aplicada en Neon el 2026-10-30.
Ámbito: rutas `DELETE`, mutations GraphQL de borrado, cascada de filas y trabajos, retirada de archivos y limpieza de archivos sin referencia.
Relacionada con: [plan db/03](../../../docs/plans/db/03-plan-eliminacion-de-datos.md), [fuente db/02 (curso Nest: borrado y cascada)](../../../docs/fonts/db/02-curso-nest-semillas-y-eliminacion.md), [fuente db/03 (Prisma: acciones referenciales)](../../../docs/fonts/db/03-documentacion-prisma-seed-y-acciones-referenciales.md), [bitácora 04 (legibilidad)](04-legibilidad-modulos.md).
Revisión de partida: `1f0be2d`, con el refactor de la bitácora 04 sin commit.

## Necesidad

El usuario pidió ejecutar el [plan db/03](../../../docs/plans/db/03-plan-eliminacion-de-datos.md) después del refactor de legibilidad. Antes no existía ninguna ruta `DELETE`, CORS no permitía ese método y todas las claves foráneas eran `RESTRICT`.

## Evidencia y decisiones

- **Buscar bajo el propietario y responder 404** si no existe o es ajeno: el curso busca antes de borrar (F2 de la fuente db/02); el proyecto ya filtra por `owner_id` en todas las lecturas.
- **Cascada para los hijos, transacción para el proyecto:** el instructor presenta las dos salidas (transacción y cascada) y descarta `SET NULL` para no dejar huérfanos (F3 de la fuente db/02). Se combinan:
  - `ON DELETE CASCADE` en `catalog_rows` y `catalog_import_jobs` hacia `catalog_snapshots`, porque no tienen sentido sin su snapshot;
  - `RESTRICT` se mantiene en `projects → catalog_snapshots` y `app_users → projects`, y el proyecto se borra en una transacción explícita.
- **Primero la base y después el archivo:** el archivo se retira tras el commit. Si falla, la base no se deshace; el archivo queda sin referencia y lo retira la limpieza. Es una decisión propia del plan, no del curso.
- **E1–E4:** borrado definitivo y `409` con trabajo activo, como proponía el plan. La cuenta (`DELETE /users/me`) y la retención no se decidieron y quedan fuera.
- **Dónde va `DELETE /projects/:projectId`:** en `CatalogImportController`. `catalog-import` ya depende de `projects`, y borrar el proyecto también borra importaciones y archivos. En `ProjectsController` habría una dependencia circular. Un comentario en `ProjectsController` indica dónde está la ruta.

## Implementación

| Pieza | Archivo y símbolo | Qué hace |
| --- | --- | --- |
| Migración | [20261030000200_cascade_catalog_import_children](../../../prisma/migrations/20261030000200_cascade_catalog_import_children/migration.sql) | Sustituye las dos claves foráneas por versiones con `ON DELETE CASCADE`; conserva sus nombres. `schema.prisma` pasa a `onDelete: Cascade` en esas dos relaciones. |
| Borrar una importación | [CatalogImportRepository.deleteSnapshot](../../../src/catalog-import/catalog-import.repository.ts) | Bloquea el snapshot (`FOR UPDATE OF s`), responde 404 o `409 IMPORT_IN_PROGRESS` y borra el snapshot; filas y trabajo caen en cascada. Devuelve la clave del archivo. |
| Borrar un proyecto | `CatalogImportRepository.deleteProject` | Bloquea el proyecto como `accept` (no puede entrar otra importación), comprueba que no haya trabajos activos, borra los snapshots con `RETURNING` y después el proyecto. |
| Retirar archivos | [CatalogImportService.deleteImport / deleteProject](../../../src/catalog-import/catalog-import.service.ts) | Tras el commit, `removeDeletedArtifacts` borra cada archivo; un fallo se registra como `IMPORT_ORPHAN_RETAINED` y la petición responde igualmente 204. |
| Rutas | [CatalogImportController](../../../src/catalog-import/catalog-import.controller.ts) | `DELETE /projects/:projectId` y `DELETE /projects/:projectId/imports/:snapshotId`, ambas `204` y con `@CurrentIdentity()`. |
| Limpieza | [ArtifactCleanupService](../../../src/catalog-import/artifact-cleanup.service.ts), `ArtifactStore.listArtifacts`, `CatalogImportRepository.findReferencedArtifactKeys` | Al arrancar (con `autoStart`), borra los archivos de `artifacts/` sin referencia y con más de una hora. Un fallo se registra y no impide arrancar. |
| Error | `ErrorCodes.IMPORT_IN_PROGRESS` y su mensaje es/en | 409. |
| GraphQL | [ProjectsResolver.delete](../../../src/graphql/projects/projects.resolver.ts) y [CatalogImportResolver.deleteImport](../../../src/graphql/catalog-import/catalog-import.resolver.ts) | `deleteProject(id: ID!): Boolean!` y `deleteImport(projectId: ID!, id: ID!): Boolean!`. Llaman a los mismos métodos del servicio que REST y devuelven `true`, como `removeTodo` en el curso ([R8 de la fuente db/04](../../../docs/fonts/db/04-curso-nest-graphql-reconstrucciones.md)). `deleteProject` está en `ProjectsResolver`, donde se buscan las operaciones de proyectos; en la capa GraphQL no hay dependencia circular. |
| CORS y peticiones | [configure-http.ts](../../../src/configure-http.ts), [projects.http](../../../requests/projects.http), [catalog-import.http](../../../requests/catalog-import.http) | Añade `DELETE`, con una petición de ejemplo para cada ruta. |

Flujo del borrado de un proyecto:

```text
DELETE /projects/:id → guard de Descope → CatalogImportService.deleteProject
  → usuario local → repository.deleteProject (transacción: bloquear, comprobar, borrar)
  → commit → retirar cada archivo (si falla: registrar; lo retirará la limpieza)
```

`hasActiveJobLocked` reúne la comprobación de trabajo activo que ya hacía `accept`, ahora compartida con `deleteProject`. Su nombre recuerda que solo es fiable con el proyecto bloqueado.

## Comprobación

| Comprobación ejecutada | Resultado |
| --- | --- |
| `pnpm build`, `pnpm lint`, `pnpm format:check` | Correctos |
| `pnpm test:features` | 221 pruebas en 15 suites correctas (18 nuevas) |
| `route-wiring`, `db:verify` (con la migración nueva), `users:verify` | 1, 3 y 8 correctas |
| Integración (PGlite) | La cascada no deja filas ni trabajos; borrar el proyecto elimina todo lo suyo y nada ajeno; `409` con trabajo en cola; `404` para otro propietario; un `DELETE` directo del proyecto sigue fallando por `RESTRICT` (código `23001`) |
| E2E | `204` y después `404` en snapshot y trabajo; el archivo desaparece del disco; Bob recibe `404`; `409 IMPORT_IN_PROGRESS` en cola; tras borrar la última importación se puede volver a cambiar la configuración; UUID inválido `400`; sin sesión `401`; el preflight CORS admite `DELETE` |
| E2E GraphQL (añadido después) | `deleteImport` y `deleteProject` devuelven `true` y borran filas, trabajos y archivos; después la consulta da `IMPORT_NOT_FOUND` o `PROJECT_NOT_FOUND`, también por REST; con un trabajo en cola, `IMPORT_IN_PROGRESS`; Bob recibe `IMPORT_NOT_FOUND`/`PROJECT_NOT_FOUND`; UUID inválido `INVALID_UUID`; sin sesión `AUTH_SESSION_REQUIRED`. El esquema esperado solo añade las dos mutations. Total tras este añadido: 225 pruebas en 15 suites |
| Unitarias | El archivo se retira solo después del commit; si la base rechaza, no se toca ningún archivo; un fallo al retirar el archivo no falla la petición; la limpieza respeta la antigüedad y las claves referenciadas |
| Arranque real contra Neon (`CATALOG_IMPORT_ROOT` temporal) | Rutas `DELETE` registradas; `401` sin sesión; `Access-Control-Allow-Methods` incluye `DELETE`; GraphQL sigue respondiendo |
| `db:status` y consulta de solo lectura en Neon, antes de migrar | La migración `20261030000200` estaba pendiente. Los nombres reales de las dos claves foráneas coincidían con los de la migración |
| `pnpm db:migrate` en Neon (con confirmación del usuario) | Aplicó `20261030000200_cascade_catalog_import_children` |
| Después: `db:status`, consulta de claves foráneas y `db:check` | «Database schema is up to date»; filas y trabajos en `ON DELETE CASCADE`, snapshots y proyectos en `RESTRICT`; `usersTableExists: true` |

La migración se aplicó en Neon después de que el usuario lo confirmara. Falta probar un borrado real con una sesión de Descope desde un cliente.

## Límites y continuidad

- La limpieza supone una sola instancia (fase A). Con varias réplicas habría que coordinarla.
- Siguen abiertas E3 (borrar la cuenta local; la cuenta de Descope no se toca) y E4 (retención automática).
