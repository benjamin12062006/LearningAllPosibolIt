# Contrato del chat del agente para la web (E6.6)

Lo que necesita la pantalla de chat de Nuxt para hablar con el agente. Todo usa la sesión de Descope de la persona; las conversaciones y las ejecuciones son privadas de su autor (lo ajeno responde 404). `P` es `/api/v1/organizations/:organizationId/projects/:projectId`.

La prueba [`agent-runs.e2e-spec.ts`](../../test/features/agent-runs/agent-runs.e2e-spec.ts) comprueba este contrato contra Nest arrancado: rutas, estados y los campos de cada evento de [`events.json`](events.json).

## Recorrido

1. **Conversación** de una hoja o de un libro: `POST P/worksheets/:worksheetId/conversations` o `POST P/workbooks/:workbookId/conversations` con `{ title }` → 201 `{ conversation }`.
2. **Mensaje** de la persona: `POST P/conversations/:conversationId/messages` con `{ clientMessageId, content }` → 201 `{ message }`. `clientMessageId` es un UUID que genera la web; reintentar con el mismo y el mismo texto devuelve el mismo mensaje.
3. **Ejecución**: `POST P/conversations/:conversationId/runs` con `{ messageId, context?: { revisionId?, selectionId? } }` → 202 `{ run }` en cola. La selección es la de H6 (`POST P/worksheets/:id/selections`).
4. **En vivo**: `GET P/ai-runs/:runId/events` (SSE). Cada evento lleva `id` (su secuencia), `event` (el tipo) y `data` (JSON). Para reanudar, `?after=<id>` o la cabecera `Last-Event-ID`. El flujo se cierra al terminar la ejecución, o a los 5 minutos: la web reconecta con el último `id`.
5. **Estado** en cualquier momento: `GET P/ai-runs/:runId` → `{ run }` con `status`, `outcome`, `answer` y `proposal`.
6. **Confirmar o rechazar** lo que preparó el agente: `POST P/ai-runs/:runId/proposals/:proposalId/confirm` (o `/reject`) con `{ proposalHash }`. El hash es el de la propuesta que se enseñó: si cambió, 409 `AGENT_PROPOSAL_STALE`. El resultado (`result`) dice qué se creó: un borrador (`changesetId`), una hoja (`worksheetId`) o una vista (`savedViewId`). Nada se aplica solo: un borrador sigue su revisión humana.
7. **Cancelar**: `POST P/ai-runs/:runId/cancel` → 200 `{ run }` cancelada. Lo que el agente prepare después ya no vale.
8. **Historial**: `GET P/conversations/:conversationId/messages` (la respuesta del agente es un mensaje `assistant`).

GraphQL tiene lo mismo menos el SSE: `startAgentRun`, `agentRun`, `confirmAgentProposal`, `rejectAgentProposal` y `cancelAgentRun`.

## Estados

| `status`    | Significa                                                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `queued`    | En cola; todavía no empezó                                                                                                                                 |
| `running`   | El agente está trabajando                                                                                                                                  |
| `succeeded` | Terminó; `outcome` dice cómo: `answered`, `confirmation_required` (hay `proposal`), `needs_clarification` (la respuesta es una pregunta) o `limit_reached` |
| `failed`    | El agente no pudo terminar (`error.code`, normalmente `AGENT_RUN_FAILED`)                                                                                  |
| `expired`   | Nadie la atendió a tiempo o venció mientras corría                                                                                                         |
| `cancelled` | La canceló la persona                                                                                                                                      |

## Eventos SSE

| `event`          | `data`                                                 | Para qué                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run.queued`     | `conversationId`, `userMessageId`                      | Enseñar «pensando…»                                                                                                                                                          |
| `run.started`    | —                                                      | El agente empezó                                                                                                                                                             |
| `tool.started`   | `callId`, `operation`, `mode`, `target`                | Qué está mirando o preparando. `target` solo lleva IDs (hoja, columnas, selección, vista previa…), nunca valores de celdas: con él la web resalta la zona y mueve la mascota |
| `tool.completed` | `callId`, `operation`, `status`, `target`              | `succeeded` o `failed`; el mismo `target` que al empezar, para quitar el resaltado                                                                                           |
| `proposal.ready` | `proposalId`, `operation`, `summary`, `hash`, `target` | Enseñar la propuesta con «Confirmar» y «Rechazar»                                                                                                                            |
| `run.completed`  | `outcome`, `answerMessageId`                           | Leer la respuesta (`GET P/ai-runs/:runId` o el historial)                                                                                                                    |
| `run.failed`     | `status` (`failed` o `expired`), `code`                | Enseñar el error con «Reintentar»                                                                                                                                            |
| `run.cancelled`  | —                                                      | Cerrar el «pensando…»                                                                                                                                                        |

Todos llevan además `createdAt`. El último evento de una ejecución es siempre `run.completed`, `run.failed` o `run.cancelled`.

La respuesta llega entera al terminar: en esta versión no hay `text.delta` (texto letra a letra) ni eventos `status` intermedios.

## Errores que la web debe tratar

| Código                                                                         | Cuándo                                                                           |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| 503 `AGENT_UNAVAILABLE`                                                        | El agente no está configurado: la conversación funciona, pero no responde        |
| 409 `AGENT_RUN_ACTIVE`                                                         | Ya hay una respuesta en curso en esa conversación                                |
| 429 `AGENT_QUOTA_EXCEEDED`                                                     | Demasiadas respuestas a la vez o en 24 horas                                     |
| 409 `AGENT_PROPOSAL_STALE`, `AGENT_PROPOSAL_DECIDED`, `AGENT_PROPOSAL_EXPIRED` | La propuesta cambió, ya se decidió o caducó (también si se canceló la ejecución) |
| 409 `AGENT_RUN_FINISHED`                                                       | Cancelar una ejecución ya terminada                                              |

## Límites

- 8 llamadas a operaciones por ejecución.
- Una propuesta por ejecución; caduca a los 30 minutos.
- 3 ejecuciones activas por persona y 200 al día.
- Historial enviado al agente: 50 mensajes y 64 KiB.

Nada de esto lleva correos ni datos de otras personas hacia la IA.
