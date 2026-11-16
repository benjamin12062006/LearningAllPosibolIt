# 10 — E6.3a: ejecuciones del agente, pasarela y confirmación humana

Fecha de creación: 2026-11-14  
Estado: Implementado y verificado (2026-11-14). Se guarda en el mismo commit que E6.4 y E6.6 ([bitácora 11](11-eventos-cancelacion-cuotas-y-contrato-del-chat.md)).  
Ámbito: Nest (y un ajuste del contrato en FastAPI).  
Relacionada con: [plan 05](../../../docs/plans/feature/ai-assistant/05-plan-catalogo-ejecuciones-y-confirmaciones.md), [fuentes 07](../../../docs/fonts/feature/ai-assistant/07-fuentes-de-catalogo-ejecuciones-y-confirmaciones.md), [bitácora 08, conversaciones](08-conversaciones-y-mensajes.md), [bitácora 09, H6](09-selecciones-y-vistas-previas-de-hoja.md), [contrato A11 del agente](../../../../LearningAllPosibolIt-ai/docs/plans/feature/agente/01-plan-agente-con-llm-simulado.md).  
Revisión de partida: Nest `ddbf9b4`, FastAPI `3f75db5`.

## Necesidad

FastAPI ya tenía el agente (E6.3b) y esperaba de Nest tres cosas, ninguna de las cuales existía:

- una ejecución con su catálogo de operaciones;
- una credencial por ejecución;
- una pasarela interna a la que llamar.

La persona tenía conversaciones (E6.2), pero nada que lanzara al agente ni que le dejara confirmar lo que este prepara.

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| Plan 05, D1–D2: un run por mensaje y la tabla como cola durable | `ai_runs` con índice único por mensaje y otro parcial para una sola ejecución activa por conversación. Un worker (`WorkerLoop`) la reclama, llama al agente fuera de transacción y guarda la respuesta como mensaje del asistente con el reclamo vigente | Migración 38 (`create_ai_runs`), [`agent-runs.repository.ts`](../../../src/agent-runs/agent-runs.repository.ts), [`agent-run.worker.ts`](../../../src/agent-runs/agent-run.worker.ts) |
| D3: credencial de 32 bytes y solo su SHA-256 | Se emite al reclamar y se borra al terminar. Una restricción de la tabla impide que quede una credencial en una ejecución que no está en curso | [`run-credential.ts`](../../../src/agent-runs/run-credential.ts); `ai_runs_credential_only_running_check` |
| D4: catálogo declarado una vez | 13 operaciones: 10 lecturas y 3 escrituras. Cada una tiene nombre, descripción, JSON Schema cerrado, permiso, validación con el DTO de REST (`validateAs`) y el servicio de siempre, llamado con la identidad de la persona. Ninguna se llama como las 24 prohibidas | [`agent-operation-catalog.ts`](../../../src/agent-runs/operations/agent-operation-catalog.ts) |
| D6: el plan se guarda y se ejecuta al confirmar | La escritura deja una propuesta (`ai_proposals`) con su plan, resumen y hash. La confirmación ejecuta el plan guardado, no lo que diga el modelo. Para evitar dos efectos, la propuesta pasa por `ready → confirming → confirmed` | [`agent-runs.service.ts`](../../../src/agent-runs/agent-runs.service.ts) |
| A11: `POST /internal/v1/agent-runs/:runId/operations/:name`, sin prefijo ni versión | Controlador `VERSION_NEUTRAL`, con la ruta excluida del prefijo `/api` | [`agent-gateway.controller.ts`](../../../src/agent-runs/agent-gateway.controller.ts), `configure-http.ts` |
| E6.5: le faltaba al agente el contexto de la ejecución | Nest manda `context` con libro, hoja, revisión y selección autorizados. FastAPI lo acepta, con un modelo estricto, y lo añade al prompt | FastAPI: `AgentContextRequest`, `system_prompt_for` |

No se consultaron cursos nuevos: las fuentes 07 que dejó la otra sesión cubren el diseño.

## Contrato

Bajo `P = /api/v1/organizations/:organizationId/projects/:projectId`, con sesión de Descope:

| Ruta | Resultado |
| --- | --- |
| `POST P/conversations/:conversationId/runs` `{ messageId, context?: { revisionId?, selectionId? } }` | 202 `{ run }`. El mismo mensaje y contexto devuelven la misma ejecución. Errores: 409 `AGENT_RUN_CONTEXT_CHANGED` si cambia el contexto; 409 `AGENT_RUN_ACTIVE` si hay otra activa; 404 si el mensaje o la conversación son ajenos o no existen; 403 sin `ai.use`; 503 `AGENT_UNAVAILABLE` sin agente configurado |
| `GET P/ai-runs/:runId` | 200 `{ run }` con estado, desenlace, respuesta y propuesta (`hash` incluido). Solo para su autor |
| `POST P/ai-runs/:runId/proposals/:proposalId/confirm` `{ proposalHash }` | 200 `{ proposal }` con `result`. Repetir devuelve lo mismo. 409 si el hash no coincide, si ya se decidió o si caducó |
| `POST …/reject` `{ proposalHash }` | 200 `{ proposal }` rechazada |

GraphQL: `startAgentRun`, `agentRun`, `confirmAgentProposal` y `rejectAgentProposal`, con los mismos servicios.

Pasarela (solo HTTP, credencial de la ejecución): `POST /internal/v1/agent-runs/:runId/operations/:name` con `{ callId?, mode, arguments }`.
- Una lectura devuelve su JSON, como mucho 60 KiB (422 `AGENT_RESULT_TOO_LARGE` si se pasa).
- Una escritura devuelve `{ proposalId, summary, expiresAt }`.
- Errores: 401 si la credencial no vale; 404 si la operación es desconocida o prohibida, o el recurso es ajeno; 400 si el modo no corresponde o los argumentos no son válidos; 409 si ya hay propuesta o se llega a las 8 llamadas.

Catálogo:

| Lecturas (`execute`) | Escrituras (`prepare` → confirmación humana) |
| --- | --- |
| `get_project_overview`, `list_worksheets`, `get_sheet_schema`, `query_rows`, `select_rows`, `preview_transform`, `get_evaluation_report`, `get_ruleset`, `get_feed_status`, `list_feed_products` | `create_change_proposal` → borrador `ai`; `propose_sheet_layout` → hoja vacía; `suggest_view` → vista personal |

## Ajustes al escribir el código

- **Sin `callId` obligatorio.** El agente de hoy no lo manda; Nest pone uno si falta y deduplica cuando llega.
- **Sin `proposalId` en la respuesta de FastAPI.** Como solo hay una propuesta por ejecución, Nest la encuentra por la ejecución.
- **`propose_sheet_layout` crea la hoja al confirmar**, con el servicio de siempre; no hay reserva ni revisión aparte (ajuste de H6, bitácora 09).
- **La ejecución termina `succeeded` con su desenlace** (`answered`, `confirmation_required`, `needs_clarification` o `limit_reached`); un fallo del agente la deja `failed` con `AGENT_RUN_FAILED`. Las ejecuciones vencidas y las colas sin atender pasan a `expired` en la pasada siguiente, que también borra las selecciones y vistas previas caducadas de H6.
- **Cliente del servicio de IA:** `runAgent` con su propio plazo (150 s) y la señal de apagado del worker.
- **Fallo encontrado de paso:** el lector de controladores de `coverage.spec.ts` no admitía un `@Controller(...)` partido en varias líneas, como lo deja Prettier. Desde el commit de H6 la prueba fallaba sin que se viera. Corregido.

## Comprobaciones realmente ejecutadas (2026-11-14)

- **Pruebas en Nest:** 8 E2E en [`agent-runs.e2e-spec.ts`](../../../test/features/agent-runs/agent-runs.e2e-spec.ts). Un servidor HTTP hace de agente y llama a la pasarela real con la credencial de la ejecución, como FastAPI:
  - **el recorrido del 5 %:** leer el esquema, seleccionar, calcular y preparar. La persona confirma y solo entonces nace el borrador `ai` con `11.03` y `12.60`; la hoja no cambia, y repetir la confirmación da lo mismo;
  - la credencial errónea o ya usada, una operación desconocida o prohibida, el modo cambiado, los argumentos inválidos o de más, y una hoja ajena;
  - una propuesta por ejecución y el límite de 8 llamadas;
  - `suggest_view` confirmada como vista personal, y `propose_sheet_layout` confirmada (crea la hoja) y rechazada (no crea nada);
  - la idempotencia por mensaje, otra ejecución activa, un mensaje ajeno, otra organización, el Viewer, la conversación y la ejecución de otra persona, y una selección ajena en el contexto;
  - el fallo del agente;
  - la paridad GraphQL;
  - sin agente configurado, 503 y la conversación sigue funcionando.
- **Pruebas en FastAPI:** el contexto se acepta y se rechaza con campos de más; el prompt nombra el contexto. `make check`: 128 pasan y 30 omitidas (las que necesitan Qdrant o Google).
- **Matriz de C7:** 5 filas nuevas. Quedan 99 de 124 con equivalente (79,8 %) y 11 solo HTTP, porque la pasarela es una ruta interna. El esquema esperado está regenerado.
- **Esquema frente a las 38 migraciones:** «This is an empty migration».
- **Defectos a propósito:** 12 de 12 detectados por las pruebas (tabla de abajo).
- **Pendiente:** la prueba con FastAPI real (proceso aparte, modelo guionizado) contra Nest real, del plan 05 (D8). Se hace en la prueba local de punta a punta (bitácora de cierre del Bloque C).
- La migración 38 la aplica el usuario en Cloud SQL.

## Defectos a propósito (12 de 12 detectados)

Cada defecto se aplicó solo, en una copia del proyecto, y se ejecutó `agent-runs.e2e-spec.ts`.

| Defecto | Prueba que lo detecta |
| --- | --- |
| La credencial no se compara | La credencial solo vale durante su ejecución |
| Sin comprobar el modo (`execute` o `prepare`) | La pasarela valida todo |
| Una operación prohibida entra en el catálogo | El recorrido del 5 % y la pasarela |
| Confirmar con otro hash | El recorrido del 5 % |
| Confirmar dos veces ejecuta dos veces | El recorrido del 5 % |
| Ver ejecuciones de otras personas | Lo ajeno, 404 |
| Dos ejecuciones activas en una conversación | Una segunda activa, 409 |
| Sin límite de llamadas | Una propuesta por ejecución y un límite de llamadas |
| El agente recibe otro proyecto | El recorrido del 5 % |
| Argumentos sin validar | La pasarela valida todo |
| Selección del contexto sin comprobar | Una selección ajena en el contexto |
| Un fallo del agente deja la ejecución abierta | Si el agente falla, queda fallida |
