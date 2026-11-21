# 16 — Memoria entre mensajes del agente

Fecha de creación: 2026-11-21  
Estado: Implementado y verificado  
Revisión de partida: Nest `55a04a1` y FastAPI `bdf72e0` (`deploy/vercel`), rama `feature/ia-contexto`  
Relacionada con: [plan 10, etapa E2](../../../docs/plans/feature/ai-assistant/10-plan-ia-con-contexto-memoria-y-toon.md), [fuentes 12](../../../docs/fonts/feature/ai-assistant/12-fuentes-ia-con-contexto-memoria-y-toon.md) y la [bitácora 06 de FastAPI](../../../../LearningAllPosibolIt-ai/bitacora-construccion/feature/agente/06-toon-errores-y-limites.md).

## Necesidad

Cada mensaje nuevo empezaba sin saber qué hizo la IA antes. El historial era solo texto: sin las llamadas, sin los IDs que encontró y sin saber si la persona confirmó (fuentes 12: E1, E2 y E10).

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| C1: la memoria se lee antes del modelo y se escribe después. C4: memoria persistente por hilo. | D1: la actividad de cada ejecución viaja con su respuesta, leída de las tablas que ya existen. | [`AgentRunsRepository.promptOf`](../../../src/agent-runs/agent-runs.repository.ts), `activitiesOf`, `withActivity` y el tipo `RunActivity` |
| F1: el historial lleva el contexto completo o nada | D1: la actividad va como texto, no como llamadas a funciones sueltas | FastAPI: [`model_text.history_content`](../../../../LearningAllPosibolIt-ai/src/ktsu_ai/application/agent_application/model_text.py), en TOON debajo del mensaje del asistente |
| C2: controlar el tamaño del historial | D2: 100 mensajes y 256 KB contando la actividad; aviso de lo omitido | `AGENT_RUN_LIMITS`, `boundedHistory` y `sizeOf`; `omittedMessages`; FastAPI: `omitted_history_note` |
| E10 | D2: 40 llamadas, 210 s de espera y 240 s de reclamo en Nest | `AGENT_RUN_LIMITS.calls`, `requestTimeoutMs` y `leaseMs` |

## Contrato Nest → FastAPI (añadidos)

```json
{
  "history": [
    { "role": "user", "content": "Sube un 5 % los precios" },
    {
      "role": "assistant",
      "content": "Crear un borrador en la hoja «Precios» con 2 cambios…",
      "activity": {
        "calls": [{ "operation": "get_sheet_schema", "status": "succeeded", "target": { "worksheetId": "…" } }],
        "proposal": { "operation": "create_change_proposal", "status": "rejected", "result": null }
      }
    }
  ],
  "omittedMessages": 0
}
```

- `activity.calls` sale de `ai_run_calls`, en orden de llamada. `target` solo trae los IDs que tocó cada llamada (nunca valores de celdas).
- `activity.proposal` sale de `ai_proposals`. Una propuesta `ready` vencida se manda como `expired`.
- FastAPI acepta hasta 100 mensajes en el historial, hasta 64 KB de actividad por mensaje y `omittedMessages ≥ 0`.

## Ajustes al escribir el código

- `promptOf` recibe ahora el reloj (`now`) para marcar las propuestas vencidas con la misma hora que usa el resto de la ejecución.
- `boundedHistory` se exporta para probar el recorte con actividad sin tener que crear cientos de ejecuciones.

## Comprobaciones realmente ejecutadas

- Nest: `tsc --noEmit` sin errores. `pnpm lint` solo da un aviso que ya existía (`catalog-rules-operations.ts:268`, `no-misused-spread`). Prettier aplicado a los archivos tocados.
- Nest, pruebas nuevas (PGlite):
  - E2E «el historial lleva lo que hizo cada ejecución…»: cuatro llamadas en orden, cada una con su `target`, y la propuesta rechazada. Comprueba también que no viajan valores de celdas.
  - E2E «una propuesta que nadie confirmó a tiempo llega como vencida».
  - E2E «el historial se recorta por bytes, por lo más viejo, y dice cuántos mensajes faltan».
  - Unitaria [`bounded-history.spec.ts`](../../../test/features/agent-runs/bounded-history.spec.ts): la actividad cuenta en el recorte.
  - Las pruebas existentes «el agente lee y prepara…» y «una propuesta por ejecución y un límite de llamadas» siguen en verde con 40 llamadas.
- FastAPI: 180 pruebas pasan y 30 se omiten. Las nuevas cubren la actividad en TOON, el aviso de omitidos, los topes del contrato y que la actividad llega al modelo pasando por la ruta HTTP.

### Defectos a propósito: 12 de 12 detectados

| ID | Defecto | Lo detectó |
| --- | --- | --- |
| M1 | El historial pierde la actividad | E2E de actividad |
| M2 | Una propuesta vencida sigue `ready` | E2E de vencida |
| M3 | El recorte no cuenta la actividad | `bounded-history.spec.ts` |
| M4 | No dice cuántos mensajes faltan | E2E de recorte |
| M5 | El recorte se queda con lo más viejo | E2E de recorte y unitaria |
| M6 | La actividad no se busca | E2E de actividad |
| A1 | FastAPI no pinta la actividad | Ruta: `test_history_activity_reaches_the_model_through_the_route` |
| A2 | No avisa de los omitidos | `test_history_carries_each_turn_activity_in_toon_and_the_omitted_count` |
| A3 | Actividad sin tope | `test_run_accepts_history_activity_and_bounds_its_size` |
| A4 | Historial sin tope de mensajes | Ídem |
| A5 | Omitidos negativos | Ídem |
| A6 | La ruta descarta la actividad | Ruta |

## Consecuencias

- La batería completa de Nest y el arranque real se ejecutan en la etapa E7. Aquí se ejecutaron las pruebas del agente afectadas.
- El límite de llamadas tiene que coincidir en Nest (`AGENT_RUN_LIMITS.calls`) y FastAPI (`MAX_TOOL_CALLS`). Ninguna prueba cruza los dos repositorios; queda anotado en ambos sitios con un comentario.
