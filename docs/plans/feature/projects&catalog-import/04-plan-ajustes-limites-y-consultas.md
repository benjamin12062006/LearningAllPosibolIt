# 04 — Ajustes de límites y consultas en projects y catalog-import

Fecha de creación: 2026-10-30  
Estado: Ejecutado el 2026-10-30 (incrementos 1, 2, 3, 5 y 6; el 4 se descarta). Ver la [bitácora 14](../../../../bitacora-construccion/settings/14-ajustar-limites-y-consultas.md).  
Ámbito: API de `projects` y `catalog-import`; sin interfaz web.  
Relacionada con: [plan general](01-plan-projects-y-catalog-import.md), [projects](02-plan-projects.md), [catalog-import](03-plan-catalog-import.md), [fuente 06: paginación y límites](../../../fonts/feature/projects&catalog-import/06-paginacion-y-limites.md), [plan de eliminación](../../db/03-plan-eliminacion-de-datos.md).  
Revisión de referencia: `78e99f3` en `LearningAllPosibolIt` (copia de `estadistica-forms-api`).

## Objetivo

Ajustar las lecturas y los límites de las features existentes antes de añadir funcionalidades nuevas. El plan estará completo cuando:

- ningún listado devuelva registros sin límite;
- un proyecto permita listar sus importaciones;
- los límites de importación estén definidos en un solo lugar y documentados.

## Punto de partida

- `GET /api/v1/projects` no tiene `LIMIT` ([ProjectsRepository.findAllByOwner](../../../../src/projects/projects.repository.ts)).
- Las importaciones solo se consultan por ID: `GET imports/:snapshotId` y `GET jobs/:jobId` ([CatalogImportController](../../../../src/catalog-import/catalog-import.controller.ts)). No hay listado por proyecto.
- Los límites están en `IMPORT_LIMITS` ([import.types.ts](../../../../src/catalog-import/import.types.ts)) y también en `CHECK` del SQL (`row_count BETWEEN 1 AND 5000`, `byte_size BETWEEN 0 AND 10485760`) de la [migración de importación](../../../../prisma/migrations/20261026000100_create_catalog_import/migration.sql). Cambiar uno exige cambiar el otro.
- La operación inicial admite una sola instancia API/worker y una importación activa. No hay forma de cancelar un trabajo en cola.
- El `ValidationPipe` global usa `transform: true` sin conversión implícita ([configure-http.ts](../../../../src/configure-http.ts)).

## Fuentes y decisiones

- **Curso (F1, F2 de la [fuente 06](../../../fonts/feature/projects&catalog-import/06-paginacion-y-limites.md)):** `PaginationDto` reutilizable en `common/`, con `limit ≥ 1` y `offset ≥ 0` opcionales, y valores por defecto en el servicio.
- **Adaptación:** convertir los números con `@Type(() => Number)` solo en ese DTO, sin activar la conversión implícita global.
- **Propuesta propia:**
  - Límite máximo de 100 y valor por defecto de 20.
  - Respuesta con `page: { limit, offset, hasMore }`; `hasMore` se calcula pidiendo `limit + 1` filas, sin `COUNT`.
  - Se conservan las claves actuales `projects` e `imports`.
- **Alternativa pospuesta:** paginación por cursor `(created_at, id)` si las listas crecen (F5 de la fuente 06).
- **Pendiente de investigar:** cancelación de trabajos y cuotas por usuario. No hay fuentes consultadas todavía.

## Incrementos

1. **Paginación común y `GET /projects`.** Crear `PaginationQueryDto` en `src/common/http/`, aplicarlo al listado de proyectos y añadir `LIMIT`/`OFFSET` al SQL existente, conservando el orden `created_at DESC, id DESC`.
2. **`GET /projects/:projectId/imports`.** Listar los snapshots del proyecto propio (metadatos y estado del trabajo, sin la muestra de filas), paginados y del más reciente al más antiguo. Añadir el índice `(project_id, created_at DESC, id DESC)` en `catalog_snapshots` con una migración nueva.
3. **Una importación activa por proyecto.** Si el proyecto ya tiene un trabajo `queued` o `running`, `POST imports` responde `409` con un código estable (nombre propuesto: `IMPORT_ALREADY_ACTIVE`) y mensaje bilingüe. Hay que decidir si la comprobación se hace solo en el servicio o también con un índice parcial único en la base.
4. **Cancelar un trabajo en cola (por decidir).** Propuesta: `POST /projects/:projectId/jobs/:jobId/cancel`, solo para `queued`, con un estado nuevo `cancelled`. Requiere cambiar el `CHECK` de estados y revisar el worker. Si no hace falta antes del piloto, se descarta de forma explícita.
5. **Límites en un solo lugar.** Documentar en el README la tabla de límites (archivo, filas, columnas, muestra, paginación) e indicar que cambiar uno exige migración y constante. Decidir si se añaden límites por usuario (número de proyectos o de snapshots conservados), en relación con la retención del [plan de eliminación](../../db/03-plan-eliminacion-de-datos.md).
6. **Errores nuevos.** Registrar los códigos en [error-codes.ts](../../../../src/common/http/error-codes.ts) y sus mensajes ES/EN según el contrato vigente.

## Resultado de la ejecución (2026-10-30)

1. ✅ **Paginación común.** `src/common/http/pagination.ts` es el único origen de los límites (`defaultLimit` 20, `maxLimit` 100), con `PaginationQueryDto`, `resolvePage`, `fetchWindow` y `toPage`. El **servicio** aplica el valor por defecto, así que REST (`GET /projects?limit&offset`) y GraphQL quedan protegidos por la misma regla. Los repositorios exigen siempre una ventana `LIMIT/OFFSET` y piden `limit + 1` filas para calcular `hasMore` sin `COUNT`. La respuesta REST conserva `projects` y añade `page: { limit, offset, hasMore }`.
2. ✅ **`GET /projects/:projectId/imports`.** Lista snapshots con su trabajo, sin muestra, paginados y del más reciente al más antiguo; un proyecto ajeno da `404 PROJECT_NOT_FOUND`. Migración `20261030000100_index_catalog_snapshots_project` con el índice `(project_id, created_at DESC, id DESC)`, también declarado en `schema.prisma`; aplicada en Neon.
3. ✅ **Una importación activa por proyecto.** `POST imports` responde `409 IMPORT_ALREADY_ACTIVE` (bilingüe). Hay dos comprobaciones: una temprana en `ImportAccessGuard`, que evita recibir un CSV de hasta 10 MiB, y la definitiva dentro de la transacción de `accept`, que ya bloquea la fila del proyecto con `FOR UPDATE` y por eso no tiene carreras. **Decisión:** no se añade un índice parcial único, porque Prisma no lo representa en `schema.prisma` y la transacción ya garantiza la regla.
4. ❌ **Cancelar trabajos en cola: descartado.** Exigiría un estado `cancelled`, cambiar el `CHECK` y el worker; sin necesidad real hoy, queda fuera de forma explícita.
5. ✅ **Límites en un solo lugar.** Tabla en el README y una prueba (`import-limits.spec.ts`) que compara `IMPORT_LIMITS` con los `CHECK` de la migración para detectar desajustes. **Cuotas por usuario: descartadas por ahora**; se revisarán con la retención del plan de eliminación.
6. ✅ **Errores nuevos.** `IMPORT_ALREADY_ACTIVE` en `error-codes.ts` y `messages.ts`.

## Comprobación prevista

- **Unitarias:** valores por defecto y rechazo de `limit=0`, `limit=101`, `offset=-1` y parámetros desconocidos.
- **Integración con PGlite:** el orden se mantiene estable entre páginas y `hasMore` es correcto en el límite.
- **E2E:** Bob no lista las importaciones de Alice (`404`) y se obtiene el `409` con una importación activa.
- **Regresión:** `pnpm build`, `pnpm lint`, `pnpm test:features`, `pnpm users:verify`.
- **Cloud SQL:** `db:status` y `db:migrate` con el índice nuevo, según el [plan db/04](../../db/04-plan-migraciones-remotas-y-fechas.md).

## Límites y continuidad

- Sin interfaz web, búsqueda ni filtros por texto o estado (el curso alternativo los trata en su sección 6; quedan sin investigar).
- Ejecutar después del [plan de eliminación](../../db/03-plan-eliminacion-de-datos.md) si los dos tocan las mismas migraciones, para no encadenar cambios de esquema sin coordinar.
- Investigar fuentes antes de cerrar los incrementos 3 y 4.
