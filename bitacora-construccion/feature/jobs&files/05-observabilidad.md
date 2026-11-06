# 05 — Observabilidad: requestId, salud, registros de los trabajos y colas atascadas (E6)

Fecha de creación: 2026-11-05  
Estado: Implementado y verificado en local. Sin migración.  
Ámbito: etapa E6 del [plan 01](../../../docs/plans/feature/jobs&files/01-plan-ejecucion-y-archivos.md) (D12). La E5 del plan (recibos) quedó absorbida por la E4 de borradores, que lleva otra sesión: ver el plan.  
Relacionada con: [plan 01](../../../docs/plans/feature/jobs&files/01-plan-ejecucion-y-archivos.md), ficha [01](../../../docs/fonts/feature/jobs&files/01-estado-real-y-antecedentes.md) (H5, E10), [docs-diagrams/17](../../../../docs-diagrams/17-trabajos-integraciones-operacion-y-expansion.md) («Archivos, observabilidad y recuperación»).  
Revisión de partida: `612b745` con E1–E4 sin commit.

## Necesidad

El `requestId` solo existía al responder un error, salvo en la importación, que creaba el suyo. No había ruta de salud, y para saber si una cola estaba parada había que consultar la base a mano (ficha 01, E10). 17 pide correlación por `requestId` y `jobId`, la antigüedad de las colas y no registrar datos del catálogo.

## Evidencia y decisiones

| Decisión | Evidencia | Aplicación |
| --- | --- | --- |
| Un `requestId` por petición, de principio a fin | H5 («correlación por requestId/jobId») | [`assignRequestId`](../../../src/common/http/request-id.ts), el primer *middleware* de `configureHttp`. Acepta un `X-Request-Id` válido (8–128 caracteres `A-Za-z0-9._:-`) o genera un UUID, y lo devuelve en la misma cabecera (también en CORS). El filtro de errores lo pone en el cuerpo. La importación lo guarda en su trabajo (`request_id`). |
| Salud pública y sin detalles | H5 | [`GET /api/v1/health`](../../../src/health/health.controller.ts): `200 { status: 'ok' }` si `SELECT 1` responde; `503 SERVICE_UNAVAILABLE` si no. No dice qué falló ni cuántos trabajos hay. |
| Registros de las transiciones | H5, RNF05 | Importación y evaluación registran `*_CLAIMED` (intento), `*_SUCCEEDED` (duración), `*_RETRY_SCHEDULED` (intento y espera) y `*_FAILED` (código e intentos). Solo ids, códigos y cifras. |
| Aviso de cola atascada | H5 (antigüedad de la cola y del outbox) | [`QueueMonitor`](../../../src/health/queue-monitor.ts) en `HealthModule`, cada minuto: por cola (importaciones, evaluaciones, actualizaciones del feed y outbox), cuántos trabajos están listos y desde cuándo espera el más antiguo. Si pasa de 10 min, registra `QUEUE_BACKLOG`. Vive en `health`, no en una feature, porque lee las cuatro tablas. |
| Sin Prometheus | D12 | No hay dónde ver las métricas todavía; se deja para cuando lo haya. |

### Ajustes al escribir el código

- **`SERVICE_UNAVAILABLE` ya existía** en `error-codes.ts`; se reutiliza y se quitó la entrada duplicada que se había añadido.
- **Un reintento cuenta desde que le tocó** (`COALESCE(run_after, created_at)`): un trabajo creado hace horas cuyo reintento empezó a tocar hace un minuto no está atascado.
- **El cuerpo JSON mal formado también lleva `requestId`**, porque el *middleware* va antes que los *parsers*.

## Comprobación

| Comprobación | Resultado |
| --- | --- |
| Pruebas nuevas | 13: 5 E2E de salud y `requestId` (200 sin sesión; id nuevo distinto en cada respuesta; id del cliente conservado o descartado; mismo id en cabecera y cuerpo de un error; JSON roto con `requestId`), 1 unitaria de `503`, 6 de integración del monitor (sin espera, umbral y cuenta, reintento futuro que no cuenta ni como listo, reintento contado desde que tocó, aviso registrado, las cuatro colas) y 1 E2E de importación que guarda el `X-Request-Id` en su trabajo. |
| Batería completa | 69 suites y 1.176 pruebas en verde. |
| `tsc`, `pnpm lint`, `prettier --check` | Sin errores en los archivos de E6. `prettier` avisa de `src/worksheets/worksheets.repository.ts`, que es de otra sesión y no se tocó. |
| Arranque real | `AppModule` completo sobre PGlite: `GET /api/v1/health` → 200, y todas las respuestas con `X-Request-Id`; sin errores; apagado limpio. |
| Defectos a propósito | 8 de 8 detectados. H6 no se detectaba al principio: la prueba del reintento futuro solo miraba el umbral. Se reforzó para comprobar también la cuenta de listos y se repitió. |

Los defectos fueron:

- H1, aceptar cualquier `X-Request-Id`;
- H2, no devolver la cabecera;
- H3, el filtro sin `requestId`;
- H4, el *middleware* sin registrar;
- H5, avisar sin umbral;
- H6, contar reintentos que no tocan;
- H7, salud siempre 200;
- H8, la importación con su propio id.

## Consecuencias

- Una petición se puede seguir por su `X-Request-Id` hasta el trabajo de importación que creó.
- Un balanceador o un monitor externo puede usar `/api/v1/health`.
- **Siguiente:** E7 (cierre: pruebas de fallos y docs-diagrams).
