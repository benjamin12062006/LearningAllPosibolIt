# 06 — Plan de eventos, cancelación, cuotas y contrato del chat

Fecha de creación: 2026-11-14  
Última actualización: 2026-11-14  
Estado: Plan.  
Ámbito: E6.4 y E6.6, Nest y FastAPI.  
Relacionada con: [fuentes 08](../../../fonts/feature/ai-assistant/08-fuentes-de-eventos-cuotas-y-contrato-del-chat.md), [plan E6](01-plan-e6-ia-con-qdrant-y-llamaindex.md), [plan de conversaciones](03-plan-conversaciones-y-mensajes.md), [plan E6.3a](05-plan-catalogo-ejecuciones-y-confirmaciones.md), [diseño 15](../../../../../docs-diagrams/15-chat-ia-herramientas-y-propuestas.md), [contrato de Nuxt](../../../../../docs-diagrams/16-nuxt-tabla-central-chat-y-contratos.md).  
Revisión de partida: Nest `7be788b`, FastAPI `d9f00fd`. Al implementar, comprobar el contrato construido en E6.3a y anotar los ajustes.

## Objetivo

Seguir una ejecución desde Nuxt, retomar el historial de eventos tras perder la conexión, cancelar trabajo pendiente y limitar uso concurrente y consumido. Dejar un contrato comprobado que la web pueda implementar contra Nest.

| Decisión | Aplicación | Evidencia |
| --- | --- | --- |
| D1 | Nest conserva trabajos durables de E6.3a. El worker consume un stream interno de FastAPI con el mismo DTO, autenticación y servicio que la ruta JSON. | H1, E1–E2, F2. |
| D2 | Generar IDs consecutivos en un registro SQL por run. Guardar el hito y el estado o efecto que representa en la misma transacción. | H1, E1, C2, F3. |
| D3 | La pasarela de Nest emite hitos de herramientas con `callId` y `target` derivados del ámbito autorizado. | H2, E3, F4. |
| D4 | Exponer SSE autenticado con replay durable, cursor explícito y consultas acotadas. Conservar GET de run para recuperar el estado. | H1, H4, E5, C1, F1. |
| D5 | Bloquear transición, cancelación y permisos vigentes antes de cualquier efecto. Combinar cancelación durable, aborto del stream y vencimiento del reclamo. | H1, H4, E1–E2, C2, F3. |
| D6 | Reservar y conciliar una vez por run, contando concurrencia por conversación, persona, proyecto y organización. FastAPI comprueba límites acumulados. | H3, E1, E3–E4, F3. |
| D7 | Revisar T02 en cada frontera y proyectar datos antes de enviarlos a FastAPI, persistir un evento o responder a Nuxt. | H4–H5, E3, E5–E6, F4. |
| D8 | Guardar rutas, errores, ejemplos y esquemas o fixtures de SSE en `contracts/chat/`. Comprobar que coinciden con Nest arrancado. | H4–H5, E6, F1. |

## E6.4 — Camino de los eventos

### D1. FastAPI transmite a Nest

E6.3a admite `POST P/conversations/:conversationId/runs` con `{ messageId, context? }`, donde `P` es `/api/v1/organizations/:organizationId/projects/:projectId`. Devuelve 202 y el ID del run. El worker reclama la ejecución con lease y credencial efímera para la pasarela. Se conservan `GET P/ai-runs/:runId` y los comandos de confirmar o rechazar una propuesta.

Probar `POST /v1/agent/runs/stream` interno con el mismo `AgentRunRequest`, el token de servicio en Bearer y `StreamingResponse` con `application/x-ndjson`. El POST JSON y el stream comparten el servicio del agente. Validar cada línea UTF-8 con una unión cerrada y límites de tamaño total y por frame. Los frames internos previstos son `status`, `text.delta`, `builtin.started`, `builtin.completed`, `result` y `error`. El resultado incluye el outcome y el uso observado. Nest traduce errores internos a códigos públicos. Un EOF sin resultado o error terminal válido es fallo de transporte.

Ejecutar y consumir el mismo `WorkflowHandler`. Adaptar el LLM guionizado a deltas y habilitar LlamaIndex streaming en el adaptador tras comprobar la versión fijada. Los deltas corresponden al texto de respuesta pública. Los pasos privados, argumentos y resultados crudos permanecen dentro de la ejecución. Si una respuesta parcial solo se distingue de un paso de herramienta cuando este termina, retener ese fragmento y seguir enviando hitos en vivo. Agrupar deltas por tamaño y tiempo, vaciar el lote antes del terminal y limitar el texto total. Al abortar la petición Nest→FastAPI, el generador cancela y espera el productor y el workflow. El cierre de Nuxt→Nest tiene un ciclo de vida independiente.

### D2. Persistencia y terminales

Registrar eventos en `ai_run_events` con `UNIQUE(run_id, seq)`. Asignar `seq` dentro de la misma transacción que el hito, bajo bloqueo de la fila del run y con el reloj SQL. Un claim inválido, vencido o cancelado impide agregar hitos y terminar el run como éxito. La transacción terminal fija el estado, guarda el mensaje completo cuando procede y concilia la reserva. Los resultados de E6.3a, `answered`, `confirmation_required`, `needs_clarification` y `limit_reached`, conservan su campo aparte del estado.

| Evento público | Momento y datos mínimos |
| --- | --- |
| `run.started` | Reclamo confirmado. ID y hora de inicio. |
| `status` | Estado intermedio acotado, por ejemplo `searching`, `generating` o `cancel_requested`. |
| `tool.started` | Llamada autorizada con `callId`, operación y `target`. |
| `tool.completed` | Mismo `callId`, estado público, `target` y resumen acotado si aporta contexto. |
| `text.delta` | Fragmento de respuesta pública. Los límites también se aplican al texto acumulado. |
| `proposal.ready` | Propuesta pendiente persistida con su ID, versión o hash exigidos por E6.3a y `target`. |
| `run.completed` | `status: succeeded`, outcome e IDs del mensaje final o propuesta, cuando proceda. |
| `run.failed` | Estado `failed` o `expired`, código y mensaje público. |
| `run.cancelled` | `status: cancelled` y referencia a la propuesta pendiente si ya existía. |

Un solo terminal cierra el stream. Un segundo resultado o el retorno de un worker vencido carece de efecto. Los límites previstos pueden terminar en `succeeded` con outcome `limit_reached` si existe respuesta persistida. Si vence el lease de un run que pudo iniciar proveedor, cerrar el mismo run como `expired` con un evento y conciliar como consumo desconocido. Evitar un segundo despacho del mismo trabajo mientras se desconoce el resultado del primero. La persona puede iniciar otra ejecución por el contrato de E6.3a.

### D3. Identificar qué toca una herramienta

Cada `tool.started` y `tool.completed` incluye el `callId` UUID de E6.3a y un `target` derivado de la operación, los datos del run y sus argumentos ya autorizados. Nest persiste el objetivo al aceptar la llamada y lo reutiliza al terminar. Conservar el orden de bloqueo organización → run → propuesta → recurso de dominio, según la operación. Un reintento del mismo `callId` recupera el registro. Los reintentos con otro modo, operación o argumentos se rechazan.

| `target.kind` | Identidades que entrega Nest |
| --- | --- |
| `project` | `projectId` del run para conocimiento, aclaración u operaciones de proyecto o catálogo. |
| `workbook` | `projectId` y `workbookId` autorizado, para operaciones de libro o propuesta de inicialización de hoja. |
| `worksheet` | `projectId`, `workbookId`, `worksheetId` y `revisionId` de la lectura o base de propuesta. Si están determinados, `rowIds`, `columnIds` o `cells: [{ rowId, columnId }]`. |

Los IDs de hoja, revisión, filas y columnas salen del contexto fijado y de los servicios de hojas. Usar `cells` si se afectan pares concretos. Para objetivos extensos, acotar el número de IDs del evento y marcar `truncated: true` con un recuento autorizado cuando exista. La propuesta y su diff son la referencia para navegar los cambios completos. Cuando los filtros o las búsquedas se completan sin una selección de celdas materializada, emitir el nivel de proyecto u hoja comprobado. Si se informa de un intento rechazado, usar un código público y el ámbito conocido del run. Los eventos de herramienta de ámbito más preciso salen exclusivamente de la pasarela.

La búsqueda de conocimiento pasa por la pasarela autorizada coordinada en E6.3a. FastAPI puede avisar de una aclaración local con el `callId` que generó y el tipo de actividad. Nest toma el proyecto del run para construir su `target`.

### D4. HTTP de Nuxt y reproducción

`GET P/ai-runs/:runId/events?after=<seq>` devuelve `text/event-stream` con `id: <seq>`, `event: <type>` y `data: <JSON>`. El JSON expone `{ runId, seq, type, at, data }`. `seq` empieza en 1 y `after` es exclusivo. `after=0` inicia desde el primer evento. Si también se admite `Last-Event-ID`, normalizar ambos con el mismo parser y responder 400 si difieren. Rechazar antes de abrir el stream valores malformados o superiores a la secuencia actual. Si en el futuro se acorta la retención, un cursor anterior al mínimo disponible devuelve un error de cursor caducado para recuperar el estado por GET. El piloto conserva los eventos mientras conserve el run.

El lector comprueba sesión, conversación y ámbito. Lee páginas pequeñas por `runId, seq > after ORDER BY seq` desde el mismo registro SQL, tanto en la reproducción del histórico como al seguir novedades. Autorizar cada página con datos frescos evita conservar permisos revocados en la caché C7. Devolver conexiones SQL al pool entre lecturas, serializar escrituras al socket, acotar el buffer de un cliente lento y limpiar timer, listeners y suscripción al cerrar. Usar comentarios de mantenimiento durante pausas. Cerrar antes de la expiración de sesión que devuelve Descope o al llegar al plazo máximo de conexión, lo que ocurra primero. La secuencia avanza al entregar tramas completas. Un cursor que ya apunta al terminal puede cerrar el stream sin emitir otro evento.

Nuxt envía `Authorization: Bearer` con `fetch` y `AbortSignal`, actualiza su cursor al procesar cada evento y deduplica por `(runId, seq)`. Tras un 401 renueva la sesión una vez como en el cliente actual. Si el stream no está disponible, consulta GET de run; un run fallido o cancelado sigue respondiendo 200 con su estado y, cuando aplica, el error público. CORS admite `Last-Event-ID` si se soporta y expone `Retry-After` para el 429. Registrar SSE como HTTP en C7. Cuando se elija `@Sse`, ampliar el detector de decoradores en la prueba de cobertura.

### D5. Cancelar con carreras

`POST P/ai-runs/:runId/cancel` devuelve 200 con el run. Autorizar al actor que puede ver y cancelar bajo la privacidad de la conversación. En `queued`, pasar a `cancelled`, cerrar la reserva y emitir una vez. En `running`, persistir `cancelRequestedAt` e informar el hito `cancel_requested`. El worker observa la petición incluso si llega a otra instancia. Combinar esa señal con apagado, plazo y lease y abortar la petición a FastAPI. Si el run ya es terminal, devolverlo.

El bloqueo del run decide la carrera entre finalizar, pedir cancelación y persistir una propuesta. Una solicitud que gana impide escrituras posteriores del worker o pasarela. Nest puede cerrar la ejecución aunque el proveedor tarde en responder. Si una propuesta pendiente se guardó antes de cancelar, continúa visible. La confirmación la ordena la persona, con revalidación de permiso y revisión del borrador. Si se revoca la membresía durante el trabajo, bloquear llamadas, emisiones y confirmaciones de esa identidad, abortar y cerrar con un código acotado. El lease cubre un worker que desaparezca antes de liquidar la cancelación.

### D6. Admisión, límite y contabilidad

En una transacción corta, bloquear y autorizar según E6.3a. Recuperar un reintento del mensaje disparador antes de comprobar un nuevo presupuesto. Proponer valores iniciales configurables de 1 por conversación, 2 por persona, 3 por proyecto y 4 por organización. La cuota de persona se aplica dentro de la organización. Conservar el conflicto de E6.3a para un segundo run activo de la misma conversación. Los demás límites responden 429 con código y motivo públicos. Añadir `Retry-After` cuando se conozca el siguiente momento de admisión. Contar `queued`, `running` y cancelación pendiente hasta guardar su terminal. Las lecturas de chat y el resto del backend siguen disponibles si falla el proveedor.

Insertar en la misma transacción el run, la reserva de uso por `runId` y los contadores de la ventana de organización y proyecto. Aplicar la cuota personal de uso si el piloto la configura. Usar ventanas claras en UTC, unidades enteras y una revisión de presupuesto por ejecución. Cubrir entrada, salida y razonamiento máximo previsibles, con tarifas configuradas por modelo y versión para activar la cuota de coste. Si faltan datos confiables de coste, comprobar la cuota de tokens en local y dejar constancia de ese alcance.

FastAPI comprueba el límite agregado antes de cada llamada y al procesar herramientas. Aplicar 8 llamadas y 120 s por ejecución, 100 filas máximas por lectura y los topes acumulados de H3. Limitar historial y datos, calcular el presupuesto restante al formar el input y limitar la salida pedida. Recoger métricas por turno con aislamiento por petición; contar razonamiento según el proveedor y tratar métricas incompletas como desconocidas. Persistir contadores, modelo, versión de presupuesto y moneda cuando corresponda.

Conciliar en el cierre del run una sola vez, con el importe observado y validado. Si nunca se despachó, liberar la reserva completa. Si se despachó y el uso es incompleto tras desconexión, cancelación, excepción o lease vencido, registrar consumo provisional por lo reservado y conciliar de forma idempotente cuando haya dato autoritativo. Si el proveedor informa más que lo reservado, guardar el consumo real y bloquear nuevas admisiones al llegar al límite.

## E6.6 — Privacidad y contrato verificable

1. Ejecutar Nest, FastAPI y un Qdrant temporal con embeddings deterministas y modelo guionizado. Crear dos organizaciones, dos proyectos en un mismo equipo y conversaciones privadas entre miembros de un mismo proyecto. Capturar solicitudes y llamadas con marcadores sintéticos distintos. Demostrar que ámbito, conversación, RAG, targets y propuestas permanecen aislados. Cubrir revocación durante una espera e inspeccionar que las credenciales y correos de cuenta queden dentro del límite que los necesita.
2. Comprobar que el historial se arma en Nest para el autor. El índice auxiliar filtra por la organización y los proyectos autorizados. Mantener las conversaciones fuera del índice. El contenido de usuario y celdas se trata como datos y se proyecta según las reglas de columnas y el propósito de la operación. Excluir del DTO de IA identidad de sesión, e-mail de membresías y datos de perfiles innecesarios. Probar que una herramienta inválida o instrucciones encontradas en datos no cambian la autorización. Presentar salida pública como texto o Markdown con renderizado restringido comprobado.
3. Añadir `contracts/chat/` con documentación, esquema de eventos, tramas de ejemplo, matriz de errores y secuencias de iniciar/reanudar/cancelar/confirmar/rechazar. Documentar credenciales, cursores, pérdida de conexión, divergencia de revisión, retención vigente y efecto de cada estado sobre la propuesta. Incluir operaciones GraphQL de Nuxt aprobadas por C7, con los mismos permisos que REST.
4. Consumir esos ejemplos en pruebas HTTP con SSE UTF-8 real. Validar caracteres partidos en bytes, varios eventos por fragmento, eventos partidos entre fragmentos, reanudación desde el último procesado, errores antes de cabeceras y recuperación por GET. Actualizar matriz C7, esquema esperado y prueba de arranque. Registrar resultados, defectos detectados y límites pendientes del piloto o la integración web.

## Etapas y aceptación

| Incremento | Aceptación prevista |
| --- | --- |
| E6.4a, stream interno y persistencia | Modelo guionizado entrega señales antes de terminar. Nest guarda eventos en orden. Un stream truncado o un terminal tardío no producen éxito. Targets contienen IDs autorizados. |
| E6.4b, SSE y cancelación | T21: reanudar sin duplicar propuesta ni saltar secuencias. Cancelar en cola y durante FastAPI, revisar terminal único, aborto, expiración, revocación y limpieza. |
| E6.4c, cuotas | T22: reservas simultáneas al límite con PostgreSQL multiconexión. Verificar 429, reintento al mismo run, devolución una sola vez, uso provisional, cambio de ventana UTC y backend operativo con IA apagada. |
| E6.6, contrato y endurecimiento | T02 y T18b con dos organizaciones y dos personas en una misma organización. Fixtures de contrato validados contra API real, Prisma sin drift, batería Nest en serie y `make check` en FastAPI. |

Los defectos deliberados cubren persistencia antes de emitir, orden y duplicación de secuencia, reintento de `callId` con argumentos distintos, ausencia de `target`, extensión de selección, revocación no comprobada, terminal cancelado sobrescrito, reserva fuera de transacción y devolución doble. La política de retención de despliegue, las tarifas del piloto y la marcha en Cloud Run se acuerdan cuando corresponda. La verificación local usa datos sintéticos y proveedores simulados.
