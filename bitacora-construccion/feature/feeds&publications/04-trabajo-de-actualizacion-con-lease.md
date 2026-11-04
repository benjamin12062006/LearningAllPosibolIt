# 04 — Trabajo de actualización con lease (E4)

Fecha de creación: 2026-11-03  
Última actualización: 2026-11-03 (etapa cerrada)  
Estado: Implementado y verificado en local. Migración `20261102000300_create_feed_refreshes` **aplicada en Neon** el 2026-11-03 a petición del usuario, junto con las de E1, E3 y las dos de organizaciones (`pnpm db:migrate`; después `pnpm db:status` → «Database schema is up to date!», 15 migraciones).  
Ámbito: etapa E4 del [plan 01](../../../docs/plans/feature/feeds&publications/01-plan-feeds-y-publicaciones.md): tabla `feed_refreshes`, reclamo con lease y token, recuperación de leases vencidos, reintentos, pasos `fetch → import → evaluate`, disparo manual y consulta (D2–D4, D9, parte de D10).  
Relacionada con: [plan 01](../../../docs/plans/feature/feeds&publications/01-plan-feeds-y-publicaciones.md) («Contrato de la descarga para E4»), [bitácora 03](03-fuente-remota-segura.md), [fuentes técnicas](../../../docs/fonts/feature/feeds&publications/02-fuentes-tecnicas.md) (F15, F17, F18), [cursos y reconstrucciones](../../../docs/fonts/feature/feeds&publications/03-cursos-y-reconstrucciones.md) (RC1, RC4, C6).  
Revisión de partida: `f6b4bf9` con los cambios sin commit de E1–E3.

## Necesidad y punto de partida

El usuario pidió seguir con la siguiente etapa tras E3, la cortó para cerrar la sesión y después pidió terminarla. En el árbol ya estaban `src/jobs/refresh-retry.ts` y su prueba, escritos por otra sesión: espera creciente con tope, clasificación en temporal, definitivo y «proyecto ocupado», y decisión de recuperación. Se revisaron y se reutilizan.

No hubo investigación externa nueva: las fuentes son F15, F17 y F18, y RC1, RC4 y C6.

## Evidencia y decisiones

| Decisión | Evidencia | Aplicación |
| --- | --- | --- |
| Tabla propia con lease y token (D2) | F3, F5, F7 | `feed_refreshes`: estado, paso, intentos, `run_after` y `lease_until` con el reloj de la base, token, ids previstos, resultado y error. `CHECK` de coherencia; índice único parcial con una activa por feed. |
| Todas las escrituras condicionadas (D3) | RC1, F18 | `claimIsCurrent`: mismo token, `running` **y** lease sin vencer. Con solo el token, un worker con el lease vencido aún podría escribir hasta que otro lo recuperase. |
| Lease vencido = fallo temporal (D3, D4) | F5, refresh-retry | `recoverExpiredLeases` antes de cada reclamo: `retry_wait` con espera o `failed` (`REFRESH_LEASE_EXPIRED`) al agotar intentos; el token antiguo deja de valer. |
| Pasos repetibles sin duplicar (D9) | F5 | Los ids de snapshot, importación y evaluación se guardan antes de crearlos. Al repetir: si el snapshot existe, no se descarga otra vez; si la evaluación no existe, se encola con el mismo id. |
| Esperar no es fallar (D4, R2) | refresh-retry, C6 | `IMPORT_ALREADY_ACTIVE` y `EVALUATION_ALREADY_ACTIVE` devuelven el trabajo a la cola sin gastar intento. Esperar a una importación o evaluación en curso, igual. |
| Errores definitivos sin reintento (D4) | docs-diagrams/08 | CSV inválido, URL no permitida, 4xx del origen, sin reglas o sin fuente → `failed` al primer intento. Lo temporal (red, 5xx, 429, interrupciones, errores internos) se reintenta hasta 3 veces. |
| Sin `interruptRunning` al arrancar | Hallazgo 1 de la ficha 01 | El worker de actualizaciones no marca nada al arrancar. Al apagar, el trabajo vuelve a la cola sin gastar intento. |

### Ajustes al escribir el código (marcados «en E4» en el plan)

- **Una pasada atiende cada actualización como mucho una vez.** Con una espera de 0 ms (o la de 1 ms de «ocupado» en pruebas), el worker volvía a reclamar al instante el trabajo que acababa de dejar esperando y `runUntilIdle` no terminaba nunca. Fue la causa de la ejecución colgada. `claim` recibe las actualizaciones ya atendidas en la pasada y las salta.
- **`run_after` lo pone la base (defecto real).** Prisma calcula `@default(now())` en el cliente y lo envía sin zona horaria. Con la sesión de PGlite en `Etc/GMT+5`, la fila quedaba cinco horas en el futuro y no se reclamaba. Se comprobó con un script contra una base temporal: con SQL, `run_after ≤ now()`; con `feedRefresh.create`, 5 h por delante. La fila se inserta con SQL y el esquema conserva `@default(now())`, porque Prisma no admite otra forma de ese valor sin volver a calcularlo. La sesión de Neon está en GMT y allí no se habría notado. Una primera hipótesis (redondeo de milisegundos) resultó falsa y se deshizo.
- **`refresh-retry.ts` (de la otra sesión):** su lista de errores definitivos incluía dos códigos inexistentes. Se sustituyeron por los reales, con constantes de `ErrorCodes`. Su prueba se adaptó a la lista (58 casos).
- **Provisional hasta E5:** sin política, la evaluación usa la última revisión de reglas y el trabajo termina con resultado `evaluated`.
- **`CatalogImportService.accept` admite ids previstos** (`PlannedImportIds`) y **`EvaluationsService.acceptPlanned`** encola con un id dado. Sin ids previstos, la importación se comporta como antes.

## Implementación y funcionamiento

- [migration.sql](../../../prisma/migrations/20261102000300_create_feed_refreshes/migration.sql) y modelo `FeedRefresh`.
- [src/feed-refreshes/](../../../src/feed-refreshes/):
  - `feed-refreshes.repository.ts`;
  - `feed-refresh.steps.ts`: pasos `fetch`, `import` y `evaluate`, y las clases `RefreshStepFailure` y `LostClaimError`;
  - `feed-refresh.worker.ts`;
  - `feed-refreshes.service.ts` y `feed-refreshes.controller.ts`: `POST …/feeds/:feedId/refreshes` → `202` con `statusUrl`, y `GET …/refreshes/:refreshId`;
  - `feed-refreshes.module.ts`, por encima de importación, evaluación y descarga, y registrado en `AppModule`.
- Códigos `FEED_SOURCE_NOT_CONFIGURED`, `FEED_REFRESH_ALREADY_ACTIVE`, `FEED_REFRESH_NOT_FOUND`, `REFRESH_LEASE_EXPIRED`, `REFRESH_SOURCE_MISSING`, `REFRESH_RULESET_MISSING` y `REFRESH_IMPORT_MISSING`, con textos es/en.

## Comprobación

| Comprobación | Resultado |
| --- | --- |
| Pruebas nuevas de E4 | 36: 21 de integración (PGlite, un origen HTTP local y los tres workers), 5 E2E, 7 generadas por los códigos nuevos y 3 más en `refresh-retry.spec.ts`. |
| Suite completa | 50 suites y 899 pruebas en verde. Incluye las de la feature de organizaciones, de otra sesión. |
| `tsc --noEmit`, `pnpm lint`, `prettier --check src test/features` | Sin errores. |
| Esquema frente a migraciones; `pnpm db:verify` | «This is an empty migration»; 3/3. |
| Arranque real con el worker encendido | Las rutas nuevas responden `401` sin sesión; el worker consulta la base al arrancar sin registrar errores. |
| Neon | 5 migraciones aplicadas. Revisión con solo lecturas: la base está vacía (0 usuarios, proyectos, evaluaciones y feeds), así que no hay datos que corregir. |

**Defectos a propósito:** 13 de 14 detectados, con restauración comprobada byte a byte.

| Defecto | Resultado |
| --- | --- |
| Q1 sin comprobar el lease en las escrituras | Detectado |
| Q2 sin comprobar el token | Detectado |
| Q3 recuperar un lease no gasta intento | Detectado |
| Q4 descargar aunque el snapshot exista | Detectado |
| Q5 «ocupado» tratado como fallo | Detectado. Su primera versión (cambiar el número de intentos al esperar) no tenía efecto, porque al esperar no se guardan intentos; se rehízo |
| Q6 una importación fallida no vuelve a `fetch` | Detectado |
| Q7 al apagar no vuelve a la cola | Detectado |
| Q8 `CSV_DUPLICATE_ID` se reintenta | Detectado |
| Q9 sin el índice de una activa por feed | Detectado |
| Q10 el CSV se queda en `tmp/` si falla guardarlo | Detectado tras añadir una prueba: con la carpeta `artifacts/` sin permisos. Cuando la importación rechaza por ocupada, el temporal ya lo borra ella |
| Q11 `run_after` enviado por la aplicación | Detectado (15 fallos): reproduce el defecto de la zona horaria |
| Q12 reclamo sin `SKIP LOCKED` | **Sobrevive**: PGlite es de una sola conexión (R4) |

## Consecuencias y continuidad

- **Lo que PGlite no demuestra:** que dos workers reclamen a la vez la misma actualización (`SKIP LOCKED`) y las esperas entre transacciones. Sí se demuestra, en secuencia, que un token viejo o un lease vencido no escriben.
- **Una sola instancia:** importación y evaluación siguen marcando sus trabajos como interrumpidos al arrancar, así que la API debe seguir con una sola instancia (R1 del plan).
- **Siguiente:** E5 (política aprobada y publicación automática). Sustituye el resultado provisional `evaluated` y la «última revisión de reglas».
