# 11 — E6.4 y E6.6: eventos en vivo, cancelación, cuotas y contrato del chat

Fecha de creación: 2026-11-14  
Estado: Implementado y verificado (2026-11-14).  
Ámbito: Nest.  
Relacionada con: [plan 06](../../../docs/plans/feature/ai-assistant/06-plan-eventos-cuotas-y-contrato-del-chat.md), [fuentes 08](../../../docs/fonts/feature/ai-assistant/08-fuentes-de-eventos-cuotas-y-contrato-del-chat.md), [bitácora 10, ejecuciones](10-ejecuciones-pasarela-y-confirmacion.md), [contrato del chat](../../../contracts/chat/README.md), [plan de la mascota de la web](../../../../LearningAllPosibolIt-web/docs/plans/ui/04-plan-sistema-visual-interaccion-y-mascota.md).  
Revisión de partida: Nest `ddbf9b4` más E6.3a sin commit.

## Necesidad

Con E6.3a la web solo podía preguntar por el estado de una ejecución. Le faltaba:

- ver en vivo qué hace el agente y **qué zona de la hoja toca**, para resaltarla y mover la mascota;
- retomar el flujo si se cae la conexión;
- cancelar una respuesta en curso;
- un límite de uso por persona;
- un contrato escrito y comprobado contra Nest, para construir la pantalla de chat sin leer el código.

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| Plan 06, D2: secuencia por ejecución, en la misma transacción que el estado | Tabla `ai_run_events` con clave `(run_id, sequence)`. Cada hito se guarda en la transacción que cambia el estado, con la fila de la ejecución bloqueada para que dos hitos no compitan por el número | Migración 39 (`create_ai_run_events`); `appendEvent` en [`agent-runs.repository.ts`](../../../src/agent-runs/agent-runs.repository.ts) |
| D3 y la petición de la web: `target` en los eventos de herramienta | La pasarela guarda `tool.started` y `tool.completed` con el `target` que calcula cada operación del catálogo: solo IDs (hoja, columnas, selección, vista previa), nunca valores de celdas | [`agent-gateway.service.ts`](../../../src/agent-runs/agent-gateway.service.ts) |
| D4: SSE con cursor | `GET P/ai-runs/:runId/events`, con `id` igual a la secuencia. Se reanuda con `?after=` o `Last-Event-ID`. El acceso se comprueba antes de abrir el flujo, así lo ajeno responde 404 en JSON. Latido cada 15 s y cierre a los 5 minutos | [`agent-runs.controller.ts`](../../../src/agent-runs/agent-runs.controller.ts), `events()` en el servicio |
| D5: cancelar con carreras | `POST P/ai-runs/:runId/cancel`. En la misma transacción la ejecución pasa a `cancelled` y pierde su credencial. Si el agente responde en este proceso, se corta la llamada. Lo que llegue después no se guarda, porque el worker ya no tiene el reclamo | `cancel` en repositorio y servicio; `abort` en el worker |
| D6: cuotas | Por persona: 3 ejecuciones activas y 200 en 24 horas (429 `AGENT_QUOTA_EXCEEDED`). Repetir el mismo mensaje no gasta cuota | `assertWithinQuota` |
| D8: contrato en `contracts/chat/` | README con el recorrido, estados, eventos, errores y límites, y `events.json` con los campos exactos de cada evento. La prueba E2E lee ese archivo y lo compara con los eventos reales | [`contracts/chat/`](../../../contracts/chat/README.md) |

No se consultaron cursos nuevos: las fuentes 08 cubren el diseño.

## Contrato

Rutas nuevas (el resto está en la bitácora 10):

| Ruta | Resultado |
| --- | --- |
| `GET P/ai-runs/:runId/events?after=<n>` | 200 `text/event-stream`. Solo para el autor de la ejecución |
| `POST P/ai-runs/:runId/cancel` | 200 `{ run }` cancelada. Repetir devuelve lo mismo. 409 `AGENT_RUN_FINISHED` si ya terminó de otro modo |

GraphQL: `cancelAgentRun`. El SSE es solo HTTP.

Eventos: `run.queued`, `run.started`, `tool.started`, `tool.completed`, `proposal.ready`, `run.completed`, `run.failed` y `run.cancelled`. Sus campos están en [`events.json`](../../../contracts/chat/events.json).

## Ajustes frente al plan 06

El plan describía más de lo que hace falta para la primera pantalla de chat. Se construyó lo necesario y se deja escrito lo que no:

- **Sin texto letra a letra.** No hay flujo interno entre FastAPI y Nest, así que no existen `text.delta` ni `status`. La respuesta llega entera con `run.completed`. Añadirlo después no cambia los eventos que ya hay.
- **Los nombres son los que espera la web:** `tool.completed` y `run.completed`. Una ejecución vencida sale como `run.failed` con `status: "expired"`, para que la web trate un solo evento de fallo.
- **Cuota simple.** Se cuentan ejecuciones por persona, no tokens ni coste. No hay reserva ni conciliación de consumo.
- **Cancelar una ejecución ya terminada responde 409**, en vez de devolverla: así la web sabe que su botón «Detener» llegó tarde.
- **La propuesta de una ejecución cancelada o vencida no se puede confirmar** (409 `AGENT_PROPOSAL_EXPIRED`).
- **`data` del SSE es el contenido del evento más `createdAt`.** El tipo y la secuencia ya van en `event` e `id`.
- **Carrera corregida al probar.** El lector de eventos leía primero los hitos y después el estado: un hito guardado entre las dos lecturas podía perderse al cerrar. Ahora lee el estado primero; como el hito final se guarda con el estado, el lote siguiente trae todo.

## Comprobaciones realmente ejecutadas (2026-11-14)

- **Pruebas:** 6 E2E nuevas en [`agent-runs.e2e-spec.ts`](../../../test/features/agent-runs/agent-runs.e2e-spec.ts) (14 en total):
  - los 12 eventos del recorrido del 5 %, en orden, con las secuencias 1 a 12 y los campos exactos de `events.json`;
  - `target` con la hoja en `tool.started` y repetido en `tool.completed`; ningún evento contiene precios de las celdas ni correos;
  - el SSE abierto con la ejecución en cola la sigue en vivo hasta `run.completed`;
  - reanudar con `?after=3` y con `Last-Event-ID: 3`; una cabecera rota empieza desde el principio; `after=-1`, 400; otra persona de la misma organización, 404;
  - cancelar en cola (el agente no recibe nada) y en curso (la credencial responde 401, no se guarda respuesta, la propuesta no se confirma); cancelar una terminada, 409;
  - una ejecución sin atender vence y emite `run.failed` con `expired`;
  - la cuota de activas y la diaria, y que repetir el mensaje no la gasta.
- **Matriz de C7:** cancelar tiene equivalente GraphQL y el SSE queda como solo HTTP. 100 de 126 con equivalente. Esquema esperado regenerado.
- **Esquema frente a las 39 migraciones:** «This is an empty migration». `pnpm db:verify`: 3 de 3.
- **Defectos a propósito:** 12 de 12 detectados (tabla de abajo). El primero de los del SSE no lo detectaba nadie: de ahí salió la corrección de la carrera y la prueba en vivo.
- **No comprobado aquí:** el SSE detrás de un proxy real ni desde un navegador; se verá al conectar la web.
- La migración 39 la aplica el usuario en Cloud SQL.

## Defectos a propósito (12 de 12 detectados)

| Defecto | Prueba que lo detecta |
| --- | --- |
| Cancelar no borra la credencial | Cancelar en curso |
| Cancelar una ejecución terminada | Cancelar una terminada, 409 |
| Confirmar la propuesta de una cancelada | Cancelar en curso |
| Sin cuota | La cuota limita |
| La cuota cuenta la repetición del mismo mensaje | La cuota limita |
| El SSE ignora `after` | Reanudar |
| El SSE ignora `Last-Event-ID` | Reanudar |
| El SSE sin comprobar acceso | Lo ajeno, 404 |
| `tool.started` sin `target` | Los hitos con el contrato |
| Un hito con los argumentos (valores) | Los hitos sin datos de celdas |
| Sin hito de propuesta | Los hitos en orden |
| El SSE se cierra antes de que termine la ejecución | El SSE en vivo |
