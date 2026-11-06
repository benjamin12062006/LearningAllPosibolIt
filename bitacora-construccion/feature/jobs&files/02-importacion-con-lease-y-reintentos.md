# 02 — Importación con lease, token y reintentos (E2)

Fecha de creación: 2026-11-05  
Estado: Implementado y verificado en local. Migración `20261105000100_add_import_job_lease` creada, probada con PGlite y **aplicada en Neon el 2026-11-05** (`pnpm db:migrate`, lanzado por el usuario, junto con las de hojas y borradores; todas aditivas).  
Ámbito: etapa E2 del [plan 01](../../../docs/plans/feature/jobs&files/01-plan-ejecucion-y-archivos.md) (D4–D6).  
Relacionada con: [plan 01](../../../docs/plans/feature/jobs&files/01-plan-ejecucion-y-archivos.md), [bitácora 01](01-bucle-comun-y-sql-de-lease.md), fichas [01](../../../docs/fonts/feature/jobs&files/01-estado-real-y-antecedentes.md) (E2, E3, E4, E11) y [02](../../../docs/fonts/feature/jobs&files/02-fuentes-tecnicas-y-cursos.md) (C6, F1, F3, F7), [bitácora 04 de feeds](../feeds&publications/04-trabajo-de-actualizacion-con-lease.md) (fallo de zona horaria de Prisma).  
Revisión de partida: `612b745` con E1 sin commit.

## Necesidad

`interruptRunning` marcaba como `failed` todas las importaciones `running` al arrancar y al apagar. Con dos instancias, la que arranca mata los trabajos de la otra. Un reinicio obliga al usuario a volver a subir el CSV (ficha 01, E2 y E3).

## Evidencia y decisiones

| Decisión | Evidencia | Aplicación |
| --- | --- | --- |
| Lease y token (D4) | F1 (`SKIP LOCKED`), F3 (fencing), feeds E4 | `catalog_import_jobs` gana `attempts`, `run_after`, `lease_until` y `execution_token`, con dos `CHECK`: `running` ⇔ lease, y lease ⇔ token. `claim` da un token nuevo; `appendBatch`, `complete`, `fail`, `retryLater` y `release` solo escriben con `claimIsCurrent`. |
| Renovar con cada escritura (D5) | F3 | `appendBatch` renueva `lease_until` a `now() + leaseMs` (2 min) en el mismo `UPDATE` que comprueba el reclamo. |
| Reintentar = volver a `queued` desde cero (D4) | C6 (reintentos con espera exponencial y máximo) | `requeueLocked` borra las filas parciales, pone `processed_rows = 0` y `started_at = NULL`, deja el snapshot `pending` y fija `run_after` con el reloj de la base. No hay estado nuevo: la API y la web ven `queued`. |
| Qué se reintenta | ficha 01, E11 | **Definitivo**: `ImportFailure` de datos (CSV, límites, integridad). **Temporal**: cualquier otro error, la interrupción y el lease vencido. Tres intentos con esperas de 5 s a 60 s (`IMPORT_JOB_DEFAULTS`). Al agotarlos: `IMPORT_PROCESSING_FAILED` o `IMPORT_INTERRUPTED`, los códigos de siempre. |
| Arranque y apagado (D6) | H4, F7 | Se retira `interruptRunning`. Cada pasada empieza con `recoverExpiredLeases`. Al apagar, el trabajo abortado se suelta (`release`) sin gastar intento. |
| Transición (D6) | H4 («drenar o registrar pendientes») | La migración da a las filas `running` existentes un lease ya vencido y un token que nadie tiene. |

### Ajustes al escribir el código (marcados en el plan)

- **`run_after` admite nulos y nulo significa «listo ya».** La primera versión tenía `DEFAULT CURRENT_TIMESTAMP` y `@default(now())`. Prisma calcula `now()` en el cliente y lo envía sin zona horaria, así que los trabajos nuevos quedaban unas 5 h en el futuro y no se reclamaban: es el mismo fallo de feeds E4. Con `dbgenerated(...)` Prisma no reconoce el valor por defecto de la base y el esquema deja de coincidir con las migraciones. Con nulos no hace falta valor por defecto: solo un reintento lo rellena, con `nowPlus`. Por eso la cola conserva su orden por `created_at` y su índice.
- **Cada trabajo se atiende como mucho una vez por pasada** (`skip`, como feeds). Sin esto, un reintento con una espera muy corta se reclamaba en la misma pasada.
- **`retry-delay.ts`**: la espera creciente se sacó de `refresh-retry.ts` a `src/jobs/retry-delay.ts` (`retryDelay`, `RetryOptions`). `refresh-retry` conserva `nextRetryDelay` con la política de feeds por defecto, así que su prueba no cambia.
- **Un solo `LostClaimError`**, en `src/jobs/lease-sql.ts`. Feeds lo reexporta desde sus tipos.
- **`leaseMs` y `retry` son opcionales** en `CatalogImportOptions`, con `IMPORT_JOB_DEFAULTS`, para no tocar las pruebas que crean el worker con sus opciones.

## Implementación

- [migration.sql](../../../prisma/migrations/20261105000100_add_import_job_lease/migration.sql) y el modelo `CatalogImportJob`.
- [`catalog-import.repository.ts`](../../../src/catalog-import/catalog-import.repository.ts): `recoverExpiredLeases`, `claim(leaseMs, skip)`, `appendBatch`, `complete`, `fail`, `retryLater`, `release`, `whileClaimed`, y las funciones `holdsCurrentClaim`, `lockCurrentClaim`, `requeueLocked` y `failLocked`. No se tocaron las líneas de la sesión de hojas (`hasWorkbooks`).
- [`catalog-import.worker.ts`](../../../src/catalog-import/catalog-import.worker.ts): `consume` con recuperación y `skip`, `handleFailure`, `retryOrFail`, `saveOutcome` e `isDataFailure`.

## Comprobación

| Comprobación | Resultado |
| --- | --- |
| Pruebas nuevas | 14 de integración en [`import-lease.int-spec.ts`](../../../test/features/catalog-import/import-lease.int-spec.ts): reclamo con token y lease, reintento que todavía no toca, renovación por lote, token viejo sin efectos tras la recuperación y con el lease vencido, recuperación desde cero, agotar intentos, lease vigente intacto, error temporal reintentado, error de datos definitivo, error temporal agotado, apagado que suelta, pasada que recupera y termina, y `CHECK` de la base. |
| Pruebas cambiadas por el cambio de comportamiento | 4: la del arranque (ya no interrumpe un `running` con lease vigente); la de la escritura final que falla (ahora agota tres intentos antes de `failed`; la misma aserción de que `ready` se deshace); el spec de cierre del worker (suelta en vez de fallar); y la de feeds que simula una importación interrumpida (ahora con `fail`). Más el conteo y la lista de migraciones. |
| Batería completa | 65 suites y 1.145 pruebas. Antes de actualizar el conteo de migraciones, fallaban 2: el conteo (21 → 23, que incluye mi migración y `20261105100000_create_worksheet_changesets` de otra sesión) y una E2E de multipart incompleto que pasó 3 de 3 veces por separado. Esta última depende de un borrado asíncrono del temporal y no la toca E2. |
| Esquema frente a migraciones | «This is an empty migration». |
| Transición de la migración (ensayo a mano con PGlite) | Migraciones anteriores, un trabajo `running` y otro `queued` con el esquema viejo, y después esta migración. Resultado: el `running` queda con el lease vencido y un token (recuperable); el `queued`, intacto. |
| `tsc --noEmit`, `pnpm lint`, `prettier --check` | Sin errores en los archivos de E2. `tsc` muestra errores de `src/changesets/` (otra sesión, a medio escribir). |
| Defectos a propósito | 10 de 10 detectados. |
| Arranque real | Hecho al cerrar E3, cuando `src/changesets/` ya compilaba: `AppModule` completo sobre PGlite con los workers encendidos, sin errores ([bitácora 03](03-evaluacion-con-lease-y-reintentos.md)). |

Los defectos fueron:

- I1, `appendBatch` sin `claimIsCurrent`;
- I2, el reintento no borra las filas parciales;
- I3, la recuperación no gasta intento;
- I4, soltar gasta intento;
- I5, un error de datos se reintenta;
- I6, el reclamo no respeta `run_after`;
- I7, `>` en lugar de `>=` al agotar intentos;
- I8, sin el `CHECK` de lease;
- I9, la recuperación toca leases vigentes;
- I10, sin la lista `skip` de la pasada.

**Incidencia:** la carpeta temporal se vació otra vez a mitad de etapa y hubo que recrear el script de defectos. Ahora solo da «no compila» si el error es del archivo que se rompió, porque la copia hereda los errores de compilación de `src/changesets/`.

## Consecuencias

- Varias instancias ya pueden importar a la vez sin matarse los trabajos.
- La actualización del feed que espera una importación sigue esperando mientras esté `queued` o `running`. `IMPORT_INTERRUPTED` solo aparece cuando se agotan los intentos.
- **Siguiente:** E3 (evaluación con lease y reintentos).
