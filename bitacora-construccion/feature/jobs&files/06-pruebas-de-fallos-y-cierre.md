# 06 — Pruebas de fallos y cierre de E2 (E7)

Fecha de creación: 2026-11-05  
Estado: Cerrado. Plan cerrado. Código en el commit `e6c6bff` (`feature/jobs-files`). Las tres migraciones se aplicaron en Neon el 2026-11-05.  
Ámbito: etapa E7 del [plan 01](../../../docs/plans/feature/jobs&files/01-plan-ejecucion-y-archivos.md) (D13) y actualización de docs-diagrams.  
Relacionada con: [plan 01](../../../docs/plans/feature/jobs&files/01-plan-ejecucion-y-archivos.md), bitácoras [01](01-bucle-comun-y-sql-de-lease.md)–[05](05-observabilidad.md), docs-diagrams [06](../../../../docs-diagrams/06-dominio-y-datos-postgresql.md), [07](../../../../docs-diagrams/07-arquitectura-y-contratos.md), [08](../../../../docs-diagrams/08-secuencias-y-estados.md), [17](../../../../docs-diagrams/17-trabajos-integraciones-operacion-y-expansion.md) y [18](../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md).  
Revisión de partida: `612b745` con E1–E6 sin commit.

## Escenarios de fallo (D13) y dónde están probados

| Escenario | Prueba (PGlite, en secuencia) |
| --- | --- |
| El token viejo no escribe tras recuperar el lease (T30, «worker pierde lease») | `import-lease.int-spec.ts` (lotes, cierre, fallo y suelta), `evaluations.repository.int-spec.ts` (lotes), `outbox.int-spec.ts` (`complete` y `fail`). |
| Con el lease vencido y sin recuperar, el token todavía no escribe | `import-lease.int-spec.ts`. |
| Un lease vencido se recupera como fallo temporal y al final falla con su código | Importación, evaluación y outbox. |
| El apagado suelta el trabajo sin gastar intento | Importación y evaluación; el outbox termina el borrado en curso y no reclama más. |
| Filas `running` de antes del despliegue | Ensayo a mano de la migración de importación ([bitácora 02](02-importacion-con-lease-y-reintentos.md)); la de evaluación usa el mismo SQL. |
| El proceso cae entre el commit y el efecto externo (T31) | `catalog-import.repository.int-spec.ts`: se confirma el borrado del proyecto, nadie entrega y los archivos siguen; el relay los borra después. |
| Entrega doble con un solo efecto (T31, «outbox no duplica efectos») | `outbox.int-spec.ts`: cae tras borrar y antes de marcar; el reintento termina sin error. |
| Un reintento no publica resultados parciales (salida de E2 en 18) | La importación y la evaluación borran sus filas parciales al reintentar. |

**No verificado:** procesos reales en paralelo. PGlite demuestra la secuencia, no la concurrencia entre procesos (el mismo límite que en feeds). «Redis caído» no aplica: no hay Redis (D1).

## docs-diagrams

- **06:** lease de `catalog_import_jobs` y `evaluations`, y `outbox_events`, en el diccionario.
- **07:** `OutboxModule` y `HealthModule` en el diagrama de dependencias, con su dirección; `src/jobs/` común; la ruta de salud y `X-Request-Id`.
- **08:** importación y evaluación ya no marcan como interrumpido lo que esté en curso al arrancar, y la API admite varias instancias.
- **17:** la decisión de reutilizar la cola de PostgreSQL en lugar de BullMQ/Redis, con sus motivos y el punto que habría que cambiar.
- **18:** estado de E2.

Los diagramas Mermaid editados no se renderizaron.

## Resumen de la feature

| Etapa | Resultado |
| --- | --- |
| E1 | `WorkerLoop` y SQL de lease comunes; tres workers sin cambio de comportamiento. |
| E2 | Importación con lease, token y reintentos desde cero; sin `interruptRunning`. |
| E3 | Lo mismo para la evaluación. |
| E4 | Outbox con relay y borrado de archivos tras el commit. |
| E5 | Absorbida por la E4 de borradores (recibos dentro de su transacción). |
| E6 | `requestId`, `GET /api/v1/health`, registros de los trabajos y aviso de colas atascadas. |
| E7 | Escenarios de fallo revisados y docs-diagrams actualizado. |

Cifras finales: 69 suites y 1.176 pruebas en verde; 37 defectos a propósito (5 + 10 + 6 + 8 + 8), todos detectados; dos tras reforzar su prueba (V6 y H6) y W5 tras corregir el script que leía el resultado.

## Pendientes

- ~~Neon~~: hecho el 2026-11-05. El usuario lanzó `pnpm db:migrate`, que aplicó también las dos de hojas (`20261104090000`, `20261104100000`) y la de borradores (`20261105100000`), pendientes en el mismo orden. Las seis eran aditivas. El agente no pudo lanzarlo: el control de permisos lo bloquea como despliegue a producción. Nota para el futuro: `pnpm db:status` termina con código 1 cuando hay pendientes, así que `db:status && db:migrate` nunca llega a migrar.
- **Crear proyecto con doble clic** repite la operación (E5 absorbida). Se puede resolver en la web (desactivar el botón) o con un recibo.
- **La E2E «multipart incompleto devuelve 400 y limpia cualquier temporal»** falla a veces con la batería completa, por un borrado asíncrono en `import-upload.interceptor.ts` ([bitácora 03](03-evaluacion-con-lease-y-reintentos.md)).
- **Fuera del plan:** BullMQ/Redis, `inbox_events` (E9), `unknown_outcome` (E9), Prometheus, almacén S3 y concurrencia por organización.
