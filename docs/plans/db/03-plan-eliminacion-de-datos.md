# 03 — Eliminación de datos: proyectos, importaciones, cuenta y retención

Fecha de creación: 2026-10-30  
Estado: Plan. Investigación ampliada pendiente por indicación del usuario.  
Ámbito: borrado en la base de datos, archivos privados de `ArtifactStore` y rutas HTTP `DELETE`.  
Relacionada con: [fuente db/02: curso Nest](../../fonts/db/02-curso-nest-semillas-y-eliminacion.md), [fuente db/03: Prisma](../../fonts/db/03-documentacion-prisma-seed-y-acciones-referenciales.md), [plan de catalog-import](../feature/projects&catalog-import/03-plan-catalog-import.md), [plan de semillas](02-plan-semillas-de-desarrollo.md), [arquitectura objetivo](../../../../docs-diagrams/07-arquitectura-y-contratos.md).  
Revisión de referencia: `78e99f3`.

## Objetivo

Que el propietario pueda eliminar sus importaciones y proyectos, y su cuenta local, sin dejar filas ni archivos huérfanos y sin poder afectar a recursos ajenos.

## Punto de partida

- No existe ninguna ruta `@Delete`. CORS no permite el método `DELETE` ([configure-http.ts](../../../src/configure-http.ts)).
- Todas las claves foráneas usan `ON DELETE RESTRICT`: usuario ← proyecto ← snapshot ← filas y trabajos ([schema.prisma](../../../prisma/schema.prisma)). Hoy PostgreSQL rechazaría borrar un proyecto que tenga importaciones.
- `ArtifactStore.removeArtifact` existe, pero solo se usa para limpiar fallos de finalización ([artifact.store.ts](../../../src/catalog-import/artifact.store.ts)). No hay retención automática de archivos ([bitácora 03](../../../bitacora-construccion/feature/projects&catalog-import/03-implementar-catalog-import.md)).
- Mientras exista un snapshot, la configuración del proyecto queda bloqueada (`PROJECT_CONFIGURATION_LOCKED`). Si se borran todos los snapshots, se desbloquea.

## Fuentes y decisiones

- **Curso (F2, F3 de la fuente db/02):** buscar antes de borrar y responder `404` si no existe. El borrado con relaciones se resuelve con una transacción (más control) o con una cascada (más simple). Se descarta `SET NULL` para no dejar huérfanos.
- **Propuesta combinada:**
  - `ON DELETE CASCADE` en `catalog_rows` → `catalog_snapshots` y en `catalog_import_jobs` → `catalog_snapshots`, porque son hijos que no tienen sentido por sí solos.
  - Se mantiene `RESTRICT` en `catalog_snapshots` → `projects` y en `projects` → `app_users`. El borrado del proyecto se hace en una transacción explícita filtrada por `owner_id`.
- **Archivos:** nunca se borra un archivo antes de que la base confirme el borrado. Se borran las filas, se guardan las `artifact_key` y, tras el commit, se ejecuta `removeArtifact`. Si falla, queda un archivo sin referencia que una limpieza posterior elimina.
- **Decisiones abiertas:**
  - **E1 — tipo de borrado:** borrado definitivo (propuesto) o lógico (`deleted_at`).
  - **E2 — importación en curso:** con un trabajo `queued` o `running`, responder `409` (propuesto) o cancelar primero.
  - **E3 — cuenta local:** si `DELETE /users/me` borra la cuenta local y todos sus proyectos; qué ocurre con la cuenta de Descope.
  - **E4 — retención:** política de retención automática de snapshots y archivos antiguos.

## Incrementos

1. **Decidir E1–E4** y registrarlo aquí.
2. **Migración de cascada.** Crear una migración nueva que sustituya las claves foráneas de filas y trabajos por `ON DELETE CASCADE` y actualizar `schema.prisma` (`onDelete: Cascade`). Las migraciones ya aplicadas no se editan.
3. **`DELETE /projects/:projectId/imports/:snapshotId` → 204.**
   - Busca bajo el propietario y responde `404` si no existe o es ajeno.
   - Responde `409` si su trabajo está activo.
   - Borra el snapshot en la transacción; las filas y el trabajo caen en cascada.
   - Retira el archivo tras el commit.
4. **`DELETE /projects/:projectId` → 204.** En una transacción, comprueba que no haya trabajos activos, recoge las `artifact_key`, borra los snapshots y después el proyecto. Retira los archivos tras el commit.
5. **CORS y errores.**
   - Añadir `DELETE` a los métodos de CORS.
   - Registrar los códigos nuevos (por ejemplo, `IMPORT_ACTIVE`) con mensajes ES/EN.
   - Añadir las peticiones de borrado a `requests/projects.http` y `requests/catalog-import.http`.
6. **Limpieza de archivos sin referencia.** Una rutina, solo para una instancia y fuera de las cargas activas, que elimina de `artifacts/` los archivos cuya clave no aparece en `catalog_snapshots`. Cubre los fallos del paso posterior al commit.
7. **Cuenta y retención (según E3 y E4).** Implementar `DELETE /users/me` y la retención en incrementos propios solo si se deciden.

## Comprobación prevista

- **Integración con PGlite:** el borrado en cascada no deja filas ni trabajos; `RESTRICT` sigue impidiendo borrar un proyecto fuera de la transacción prevista.
- **E2E:** Bob no puede borrar recursos de Alice (`404`); se obtiene el `409` con un trabajo activo; tras borrar, `GET` responde `404`.
- **Unitarias:** el archivo se retira solo después del commit y un fallo al borrarlo no revierte la base.
- **Manual:** un `PATCH` de configuración se permite de nuevo tras borrar el último snapshot.
- **Regresión:** `pnpm build`, `pnpm lint`, `pnpm test:features`, `pnpm users:verify`. Aplicar la migración en Cloud SQL según el [plan 04](04-plan-migraciones-remotas-y-fechas.md).

## Límites y continuidad

- Sin interfaz web.
- No borra cuentas de Descope.
- La limpieza de archivos presupone una sola instancia; varias réplicas pertenecen a la fase B.
- Investigar fuentes (borrado lógico, auditoría y retención) antes de cerrar E1–E4.
