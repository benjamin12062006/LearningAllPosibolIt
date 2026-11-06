# 04 — Outbox y borrado de archivos tras el commit (E4)

Fecha de creación: 2026-11-05  
Estado: Implementado y verificado en local. Migración `20261105000300_create_outbox_events` creada, probada con PGlite y **aplicada en Neon el 2026-11-05** (`pnpm db:migrate`, lanzado por el usuario, junto con las de hojas y borradores; todas aditivas).  
Ámbito: etapa E4 del [plan 01](../../../docs/plans/feature/jobs&files/01-plan-ejecucion-y-archivos.md) (D8–D10).  
Relacionada con: [plan 01](../../../docs/plans/feature/jobs&files/01-plan-ejecucion-y-archivos.md), fichas [01](../../../docs/fonts/feature/jobs&files/01-estado-real-y-antecedentes.md) (E6–E8) y [02](../../../docs/fonts/feature/jobs&files/02-fuentes-tecnicas-y-cursos.md) (C1–C4, C6, F2, F3), [bitácoras 01–03](01-bucle-comun-y-sql-de-lease.md).  
Revisión de partida: `612b745` con E1–E3 sin commit.

## Necesidad

Al borrar una importación o un proyecto, o al retirar versiones antiguas del feed, los archivos se borraban **después** del commit y «a lo mejor». Si el proceso caía entre medias o el borrado fallaba, el archivo quedaba hasta la limpieza del siguiente arranque, que en un servidor que no se reinicia no llega nunca (ficha 01, E6 y E7).

## Evidencia y decisiones

| Decisión | Evidencia | Aplicación |
| --- | --- | --- |
| El evento va en la transacción del dueño (D8) | C2 («persistencia atómica»), F2 («stores each outgoing message in an outbox as part of the same local transaction») | [`enqueueArtifactsDelete(tx, folder, keys)`](../../../src/outbox/outbox-events.ts) con `INSERT` directo, dentro de `deleteSnapshot`, `deleteProject` y `retireOldFiles`. Si la transacción se deshace, el evento tampoco existe. |
| Relay por sondeo con lease y token (D8) | C3 (el «cartero» que revisa la bandeja de salida), F2 (*polling publisher*), F3 | [`OutboxRelay`](../../../src/outbox/outbox.relay.ts) con `WorkerLoop` y [`OutboxRepository`](../../../src/outbox/outbox.repository.ts): `recoverExpiredLeases`, `claim(leaseMs, skip)`, `complete`, `retryLater`, `release` y `fail`, todo con `claimIsCurrent`. |
| Entrega «al menos una vez» y manejador idempotente (D8) | F2 (el relay puede publicar dos veces; el consumidor debe ser idempotente), C8 | Un manejador por tipo; `done` es el recibo. `artifacts.delete` trata `ENOENT` como hecho (`ArtifactStore.removeStored`). |
| Reintentos y fallo conservado | C6 (reintentar con espera y tope; el fallo definitivo se conserva para revisarlo) | Cinco intentos con esperas de 10 s a 10 min (`OUTBOX_DEFAULTS`). Después, `failed` con el código. Un evento mal formado (`OUTBOX_PAYLOAD_INVALID`) o de tipo desconocido falla sin reintentos. |
| Primer consumidor real: borrar archivos (D9) | Ficha 01, E6 | Los servicios ya no borran «a lo mejor»: después del commit piden la entrega (`deliverNow`) y, si falla, registran `OUTBOX_DELIVERY_DEFERRED` sin fallar la petición. |
| Sin tabla central de artefactos (D10) | Ficha 01, E7 y E8 | No se crea. La limpieza de huérfanos se queda como red de seguridad. |

### Ajustes al escribir el código

- **`WorkerLoop.runFreshPass` y `OutboxRelay.deliverNow`.** `runUntilIdle` devuelve la pasada en curso si la hay. Esa pasada puede haber mirado la cola antes del commit y terminar sin ver el evento nuevo, que entonces esperaría al siguiente sondeo (5 s). `runFreshPass` espera a la pasada en curso y lanza otra que empieza después de la llamada.
- **El borrado en curso termina al apagar.** Borrar es rápido e idempotente: el relay no lo interrumpe y, al apagarse, ya no reclama el siguiente. Solo se suelta un evento si su manejador falla mientras se aborta.
- **El payload se comprueba con un predicado** (`isArtifactsDeletePayload`, con `in` y `FINAL_FOLDERS`), sin `as`. La carpeta solo puede ser una de las tres finales y la clave pasa por la validación de `ArtifactStore`.
- **Fechas en texto ISO** (`created_at`, `processed_at`), como en las demás tablas de trabajos, y `run_after` nulo = listo ya (bitácora 02). Así Prisma no calcula ninguna fecha en el cliente.
- **Al recortar el servicio de importación se perdieron sus funciones de módulo** (`buildAcceptance` y otras); `tsc` lo detectó. El archivo no tenía cambios ajenos y se recuperaron de `HEAD`. El diff final contiene solo el cambio previsto.

## Comprobación

| Comprobación | Resultado |
| --- | --- |
| Pruebas nuevas | 12 de integración en [`outbox.int-spec.ts`](../../../test/features/outbox/outbox.int-spec.ts): rollback sin evento, evento confirmado, sin claves no guarda nada, borrado en las tres carpetas, entrega doble con un solo efecto, archivo ausente cuenta como hecho, fallo de disco con reintentos hasta `failed`, evento mal formado, lease vencido y token viejo, apagado, y `CHECK` de la base. Más 1 de T31 en `catalog-import.repository.int-spec.ts` (se confirma el borrado del proyecto, nadie entrega, los archivos siguen; el relay los borra después) y 1 unitaria de `runFreshPass`. |
| Pruebas reescritas | Las 7 unitarias del borrado en `catalog-import.service.spec.ts` describían el borrado archivo a archivo después del commit; ahora son 4: entrega solo tras el commit (proyecto e importación), nada si la base rechaza, y un fallo de entrega que no falla la petición. Qué claves se encolan lo comprueba T31. |
| Batería completa | 66 suites y 1.163 pruebas en verde (la E2E de multipart incompleto también pasó esta vez). |
| Esquema frente a migraciones | «This is an empty migration» (25 migraciones; lista y conteo actualizados). |
| `tsc`, `pnpm lint`, `prettier --check` | Sin errores. |
| Arranque real | `AppModule` completo sobre PGlite con el relay encendido: 401, 401, 404; sin errores; apagado limpio. |
| Defectos a propósito | 8 de 8 detectados. |

Los defectos fueron:

- O1, `deleteProject` no encola los CSV;
- O2, el relay no marca `done`;
- O3, el manejador no tolera `ENOENT`;
- O4, sin validar el payload;
- O5, `complete` sin `claimIsCurrent`;
- O6, `runFreshPass` no lanza una pasada nueva;
- O7, la retención del feed no encola;
- O8, el servicio no entrega tras el borrado.

## Consecuencias

- Un borrado confirmado ya no deja archivos huérfanos aunque el proceso caiga: es T31 para los efectos que hay hoy.
- E4 de la ampliación (revisiones) podrá añadir sus tipos de evento a la lista del `CHECK` y a `OutboxRelay.handle`.
- **Siguiente:** E5 (recibos de operación).
