# 01 — Estado real de la ejecución y los archivos antes de E2

Fecha de creación: 2026-11-05  
Tipo de fuente: código del proyecto y diseño de `docs-diagrams`.  
Fecha de consulta: 2026-11-05  
Revisión del proyecto: `612b745` (`feature/feeds-publications`), con cambios sin commit de organizaciones y hojas de cálculo en el árbol.  
Relacionada con: [fuentes 02](02-fuentes-tecnicas-y-cursos.md), [mapa 03](03-mapa-de-necesidades-para-el-plan.md), [docs-diagrams/17](../../../../../docs-diagrams/17-trabajos-integraciones-operacion-y-expansion.md), [18](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md) (E2), [13](../../../../../docs-diagrams/13-revisiones-aprobaciones-y-conflictos.md) (recibos), [plan de feeds](../../../plans/feature/feeds&publications/01-plan-feeds-y-publicaciones.md) (D2–D4).

## Qué pide E2

| Id | Fuente | Requisito |
| --- | --- | --- |
| H1 | [18](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md), fila E2 | «Jobs/outbox/recibos; migración del consumidor anterior; retry/fencing; registro de archivos; observabilidad». Salida: «Reinicio/duplicado/Redis caído no pierden efectos ni publican resultados parciales». |
| H2 | [17](../../../../../docs-diagrams/17-trabajos-integraciones-operacion-y-expansion.md), «Ejecución durable» | Propone Postgres para el estado, el outbox y los recibos, y BullMQ/Redis como transporte. Añade: «Si la fase B ya adoptó otra ejecución durable que satisface las pruebas, reutilizarla o justificar la migración antes de añadir otro scheduler». |
| H3 | 17, «Outbox, inbox y fallos» | `outbox_events` con lease y token; el relay reclama, entrega y marca; el consumidor deduplica por evento. Tabla de fallos: Redis caído, entrega doble, lease perdido, 429/5xx, fallo permanente. «No mantener transacción SQL abierta mientras espera Redis, IA, disco o API externa.» |
| H4 | 17, «Transición de los workers actuales» | «El código actual que marca trabajos running como interrumpidos al arrancar no puede ejecutarse indiscriminadamente en cada réplica futura.» |
| H5 | 17, «Archivos, observabilidad» | Registro de artefactos (namespace, tenant, checksum, retención y estado); «ningún consumidor elimina archivos de otro por desconocer su tabla»; métricas de antigüedad del outbox y de la cola, reintentos; correlación por `requestId` y `jobId`, sin datos del catálogo en los registros. |
| H6 | [13](../../../../../docs-diagrams/13-revisiones-aprobaciones-y-conflictos.md) | `operation_receipts`: organización, actor, recurso, operación, `idempotencyKey`, `payloadHash` y resultado, con `UNIQUE` del ámbito y la clave. «Mismo payload devuelve resultado, distinto payload → conflicto.» E4 los necesita (fila E4 de 18: «recibos de E2»). |
| H7 | [18](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md), T30 y T31 | T30: «Redis cae tras commit, worker pierde lease, salida externa incierta». T31: «outbox no duplica efectos externos». |
| H8 | [19](../../../../../docs-diagrams/19-fuentes-trazabilidad-y-decisiones-pendientes.md), P08 | «Redis/almacenamiento/despliegue: reutilizar solución de B/C si cumple; medir concurrencia/pool y volumen; E2.» |

## Estado del código

| # | Hallazgo | Dónde | Consecuencia |
| --- | --- | --- | --- |
| E1 | **Tres workers con el mismo bucle**: temporizador, `wake`, `runUntilIdle`, apagado con `AbortController` y `shutdownMs`. Son unas 80 líneas casi iguales en cada uno. | [`catalog-import.worker.ts`](../../../../src/catalog-import/catalog-import.worker.ts), [`evaluations.worker.ts`](../../../../src/evaluations/evaluations.worker.ts), [`feed-refresh.worker.ts`](../../../../src/feed-refreshes/feed-refresh.worker.ts) | Un cambio en el bucle se tiene que repetir tres veces. |
| E2 | **Importación y evaluación usan `interruptRunning`.** Al arrancar y al apagar (si el trabajo no termina a tiempo) marcan como `failed` (`IMPORT_INTERRUPTED`, `EVALUATION_INTERRUPTED`) **todo** lo que esté `running`, sin mirar quién lo lleva. | [`catalog-import.repository.ts`](../../../../src/catalog-import/catalog-import.repository.ts) `interruptRunning`; ídem en evaluations | Con dos instancias, la que arranca mata los trabajos de la otra (H4). Un reinicio pierde el trabajo: el usuario tiene que volver a subir el CSV o a lanzar la evaluación. Solo una instancia es segura (R1 del plan de feeds). |
| E3 | **Las escrituras del worker solo comprueban `status = 'running'`** (`lockRunning`), sin token. | Ídem | Si dos procesos llegaran a llevar el mismo trabajo, ambos podrían escribir. |
| E4 | **Feeds ya resolvió esto en PostgreSQL**: `lease_until` y `run_after` con el reloj de la base, `execution_token` comprobado en cada escritura (`claimIsCurrent`), `recoverExpiredLeases` (el lease vencido cuenta como fallo temporal), `SKIP LOCKED`, esperas sin gastar intentos y una política de reintentos pura. Está probado con PGlite y con defectos a propósito. | [`feed-refreshes.repository.ts`](../../../../src/feed-refreshes/feed-refreshes.repository.ts), [`refresh-retry.ts`](../../../../src/jobs/refresh-retry.ts), [bitácora 04 de feeds](../../../../bitacora-construccion/feature/feeds&publications/04-trabajo-de-actualizacion-con-lease.md) | Es la «ejecución durable que satisface las pruebas» de H2. |
| E5 | **No hay Redis** en el proyecto: ni dependencia, ni configuración, ni servicio en el despliegue. | `package.json`, `.env` | Añadir BullMQ supone infraestructura nueva, coste y un modo de fallo más («Redis caído»). |
| E6 | **Los archivos se borran después del commit y «a lo mejor»**: si falla, se registra `*_ORPHAN_RETAINED` y lo retira la limpieza de huérfanos. | `catalog-import.service.ts` (`removeDeletedArtifacts`, `removeFeedFiles`), `exports.service.ts` (`discardFile`), `feeds.service.ts` (retención) | Si el proceso cae entre el commit y el borrado, el archivo queda hasta la limpieza siguiente. |
| E7 | **La limpieza de huérfanos solo corre al arrancar**, una vez por carpeta, y su comentario supone una sola instancia. Cada carpeta tiene un único dueño (`artifacts/` importaciones, `exports/` exportaciones, `feeds/` feeds), que decide con su propia consulta qué archivos siguen en uso. | `artifact-cleanup.service.ts`, `export-cleanup.service.ts`, `feed-cleanup.service.ts`, [`remove-orphans.ts`](../../../../src/artifacts/remove-orphans.ts) | Ya cumple «ningún consumidor elimina archivos de otro» (H5). Pero un servidor que no se reinicia nunca no limpia nunca. |
| E8 | **El «registro de archivos» ya existe repartido**: cada fila que usa un archivo guarda su clave, su tamaño y su checksum (`catalog_snapshots.source_hash`, `exports.checksum`, `feed_versions.checksum`); `ArtifactStore.verifyStored` vuelve a leerlo. | `artifact.store.ts`, migraciones | Una tabla central de artefactos repetiría lo que ya dicen las tablas de dominio. |
| E9 | **No hay recibos ni `Idempotency-Key`.** Un doble clic en `POST` de crear proyecto, evaluación, exportación o publicación, o un reintento del cliente tras un tiempo agotado, puede repetir la operación. Solo algunas rutas lo evitan por su dominio (un trabajo activo por proyecto, la generación esperada del feed). | `src/**/**.controller.ts` | E4 necesita recibos con este contrato (H6). |
| E10 | **Correlación parcial**: `requestId` solo se crea en el filtro de errores (o lo trae la importación). Los workers registran `jobId` o `refreshId` y un código, nunca datos. No hay métricas ni ruta de salud. | [`api-exception.filter.ts`](../../../../src/common/http/api-exception.filter.ts) | No se puede ver si una cola está atascada sin consultar la base a mano. |
| E11 | Los pasos de la actualización del feed esperan a la importación y a la evaluación que crean, y tratan `IMPORT_INTERRUPTED` y `EVALUATION_INTERRUPTED` como fallos temporales. | `feed-refresh.steps.ts`, `refresh-retry.ts` | Si la importación y la evaluación se reanudan solas, el feed simplemente espera más; los códigos se conservan para los trabajos antiguos. |

## Límites

- Las cifras de E1 son aproximadas (lectura del código), no una medición.
- E9 no recorre todas las rutas: se revisarán una a una en el plan.
