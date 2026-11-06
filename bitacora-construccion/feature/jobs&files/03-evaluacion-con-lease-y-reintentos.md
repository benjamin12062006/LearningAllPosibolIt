# 03 — Evaluación con lease, token y reintentos (E3)

Fecha de creación: 2026-11-05  
Estado: Implementado y verificado en local. Migración `20261105000200_add_evaluation_lease` creada y probada con PGlite; **sin aplicar en Neon**.  
Ámbito: etapa E3 del [plan 01](../../../docs/plans/feature/jobs&files/01-plan-ejecucion-y-archivos.md) (D5–D7).  
Relacionada con: [plan 01](../../../docs/plans/feature/jobs&files/01-plan-ejecucion-y-archivos.md), [bitácora 02](02-importacion-con-lease-y-reintentos.md) (el mismo diseño para la importación), ficha [01](../../../docs/fonts/feature/jobs&files/01-estado-real-y-antecedentes.md) (E2, E3, E11).  
Revisión de partida: `612b745` con E1 y E2 sin commit.

## Necesidad

La evaluación tenía el mismo `interruptRunning` que la importación (ficha 01, E2): al arrancar o apagar, toda evaluación `running` pasaba a `failed`.

## Evidencia y decisiones

Las mismas decisiones y fuentes que la [bitácora 02](02-importacion-con-lease-y-reintentos.md), aplicadas a `evaluations`:

| Decisión | Aplicación |
| --- | --- |
| Lease y token (D7) | `evaluations` gana `attempts`, `run_after` (nulo = lista ya), `lease_until` y `execution_token`, con los dos `CHECK` de lease y token. `appendRows`, `complete`, `fail`, `retryLater` y `release` solo escriben con `claimIsCurrent`. |
| Renovar con cada lote (D5) | `appendRows` renueva el lease en el mismo `UPDATE` que comprueba el reclamo. |
| Reintentar desde cero (D7) | `requeueLocked` borra `evaluation_rows` parciales y vuelve a `queued` con `started_at = NULL`. La API y la web siguen viendo los cuatro estados de siempre. |
| Qué se reintenta | **Definitivo**: `EvaluationFailure` distinto de `EVALUATION_INTERRUPTED` (integridad; reglas o moneda guardadas que no se pueden leer). **Temporal**: cualquier otro error, el lease vencido y la interrupción. Tres intentos (`EVALUATION_JOB_DEFAULTS`). Al agotarlos: `EVALUATION_PROCESSING_FAILED` o `EVALUATION_INTERRUPTED`. |
| Arranque, apagado y transición (D6) | Sin `interruptRunning`; `recoverExpiredLeases` en cada pasada; `release` al apagar; la migración da a las filas `running` un lease ya vencido. |
| Una vez por pasada | `claim(leaseMs, skip)`, como la importación y feeds. |

La actualización del feed que espera una evaluación no cambia: sigue esperando mientras esté `queued` o `running` (ficha 01, E11). El índice parcial «una evaluación activa por proyecto» sigue valiendo, porque un reintento continúa siendo `queued`.

### Ajustes al escribir el código

- **`appendRows` recibe la evaluación reclamada**, no su id, porque necesita el token y la duración del lease.
- **`fail` devuelve `boolean`** (`false` si el reclamo ya no es el vigente), igual que la importación.

## Implementación

- [migration.sql](../../../prisma/migrations/20261105000200_add_evaluation_lease/migration.sql) y el modelo `Evaluation`.
- [`evaluations.types.ts`](../../../src/evaluations/evaluations.types.ts): `ClaimedEvaluation` con `token`, `attempts` y `leaseMs`; `EvaluationOptions` con `leaseMs` y `retry` opcionales; `EVALUATION_JOB_DEFAULTS`.
- [`evaluations.repository.ts`](../../../src/evaluations/evaluations.repository.ts): `recoverExpiredLeases`, `claim`, `appendRows`, `complete`, `fail`, `retryLater`, `release`, `whileClaimed`, `holdsCurrentClaim`, `lockCurrentClaim`, `requeueLocked` y `failLocked`. Se retiran `interruptRunning`, `lockRunning` e `isActive`.
- [`evaluations.worker.ts`](../../../src/evaluations/evaluations.worker.ts): `consume` con recuperación y `skip`, `handleFailure`, `retryOrFail`, `saveOutcome` e `isDefinitiveFailure`.

## Comprobación

| Comprobación | Resultado |
| --- | --- |
| Pruebas nuevas o reescritas | 8 de integración en `evaluations.repository.int-spec.ts`. La de la interrupción se reescribió: ahora la recuperación borra las filas y el token viejo ya no guarda. Nuevas: agotar intentos por leases vencidos, un reintento que todavía no toca, error temporal reintentado y terminado, error temporal agotado, apagado que suelta, pasada que recupera y termina, y `CHECK` de la base. |
| Batería completa | 65 suites y 1.151 pruebas; falla 1, la E2E «multipart incompleto devuelve 400 y limpia cualquier temporal». Ver la nota. |
| Esquema frente a migraciones | «This is an empty migration» (24 migraciones; la lista y el conteo de las pruebas, actualizados). |
| `tsc --noEmit` (todo `src/`), `pnpm lint`, `prettier --check` | Sin errores. `src/changesets/`, de otra sesión, ya compila. |
| Arranque real | `AppModule` completo sobre PGlite, con los cuatro workers encendidos: `GET /api/v1/projects` → 401, importaciones → 401, `/feeds/x.tsv` → 404. Las pasadas corren sin errores registrados y `app.close()` apaga limpio. Cubre también el arranque que quedó pendiente en E2. |
| Defectos a propósito | 6 de 6 detectados. V6 no se detectaba al principio: faltaba la prueba de que la pasada recupera una evaluación con el lease vencido. Se añadió y se repitió. |

Los defectos fueron:

- V1, `appendRows` sin `claimIsCurrent`;
- V2, el reintento no borra filas parciales;
- V3, el reclamo no respeta `run_after`;
- V4, el apagado no suelta;
- V5, `>` en lugar de `>=` al agotar intentos;
- V6, la pasada no recupera leases vencidos.

**Nota sobre la E2E de multipart incompleto.** Falló en las dos últimas ejecuciones completas (E2 y E3) y pasa siempre por separado (3 de 3). La causa está en el código de subida, que esta feature no toca. Cuando el multipart se corta, el interceptor responde 400 y borra el temporal en segundo plano (`void this.store.removeTemporary(...)` en `import-upload.interceptor.ts`). La prueba mira la carpeta `tmp/` nada más recibir la respuesta. Con la batería completa, el borrado a veces no ha terminado. Queda como pendiente aparte: esperar el borrado antes de responder, o que la prueba espere a que la carpeta quede vacía.

## Consecuencias

- Importación y evaluación ya admiten varias instancias.
- Con esto se cumple la primera salida de E2 de [18](../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md): «Reinicio… no pierden efectos ni publican resultados parciales» (los resultados parciales se borran al reintentar).
- **Siguiente:** E4 (outbox y borrado de archivos tras el commit).
