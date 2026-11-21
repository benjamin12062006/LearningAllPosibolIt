# 12 — Fuentes: IA interna con contexto, memoria, TOON y acceso completo

Fecha de creación: 2026-11-21  
Estado: Investigación  
Revisión de partida: Nest `55a04a1`, FastAPI `bdf72e0` y Nuxt `9ceec48` (rama `deploy/vercel`, la que está en producción); trabajo en la rama `feature/ia-contexto` de los tres repositorios.  
Relacionada con: [plan 09 del asistente de hojas](../../../plans/feature/ai-assistant/09-plan-asistente-general-de-hojas.md), [plan 05 de ejecuciones y confirmaciones](../../../plans/feature/ai-assistant/05-plan-catalogo-ejecuciones-y-confirmaciones.md), [ficha 07](07-fuentes-de-catalogo-ejecuciones-y-confirmaciones.md), [ficha 01 del agente en FastAPI](../../../../../LearningAllPosibolIt-ai/docs/fonts/feature/agente/01-fuentes-del-agente.md), [ficha 03 de Gemini](../../../../../LearningAllPosibolIt-ai/docs/fonts/feature/agente/03-fuentes-de-gemini-para-el-agente.md) y el [despliegue en Vercel](../../../../../deploys/bitacora-construccion/07-vercel-desde-github.md).

## Necesidad

En producción, la IA del chat falla al gestionar Hojas y Catálogo. Hace una acción y después no sabe seguir, no se recupera de los errores y no conoce el proyecto cuando empieza un chat nuevo. El usuario pide:

- que la IA tenga acceso a todo lo que se puede hacer a mano desde la web, salvo subir archivos (decidido el 2026-11-21: los adjuntos, después);
- que recuerde lo que hizo y, al confirmar una propuesta, continúe la tarea sola (decisión del usuario: «Confirmas y sigue sola»);
- que los datos lleguen al modelo en TOON y no en JSON, convertidos dentro de la capa de IA antes de pasárselos, para gastar menos tokens;
- que un chat nuevo tenga contexto del proyecto y de sus datos, aprovechando Qdrant;
- usar Gemini Flash (hecho el 2026-11-21 en Vercel: `CHAT_MODEL` pasó de `gemini-3.5-flash-lite` a `gemini-3.5-flash`).

El bucket propio en Vercel queda fuera por decisión del usuario.

## Hallazgos del código desplegado (E)

| ID | Hallazgo | Dónde |
| --- | --- | --- |
| E1 | El historial que recibe la IA es solo el texto de los mensajes. No incluye las llamadas, sus IDs ni el resultado de las propuestas. | `AgentRunsRepository.promptOf` y `boundedHistory` |
| E2 | Confirmar una propuesta no escribe nada en la conversación. El turno siguiente no sabe si se aplicó ni qué IDs creó. | `ProposalDecisions.confirm` |
| E3 | Hay una escritura por ejecución (`AGENT_PROPOSAL_EXISTS`) y, sin `AI_AUTO_CONFIRM`, la ejecución termina al preparar una. Cada paso de una tarea pide un mensaje nuevo. | `AgentGatewayService.prepare`, `llamaindex_agent._make_tool` |
| E4 | Si confirmar falla, la propuesta vuelve a `ready` con el mismo plan congelado. Reintentarla repite el fallo, y la IA no se entera. | `ProposalDecisions.confirm` (`abortConfirm`) |
| E5 | `apply_changeset` envía, aprueba y aplica en tres pasos no atómicos. Si la hoja cambió, falla con `CHANGESET_BASE_OUTDATED` o `WORKSHEET_HEAD_CHANGED` y la IA no tiene `rebase` ni `reopen`. | `project-action-operations.ts`, `submitApproveAndApply` |
| E6 | Faltan herramientas de acciones manuales: enviar, reabrir, rechazar, rebase y revertir borradores; duplicar una hoja; abrir un catálogo como hoja; listar, editar y compartir vistas; plantillas de mapeo; exportar una hoja; listar y borrar importaciones del catálogo; configurar la fuente, el horario y la política del feed. El plan 09 tiene pendientes sus etapas 3 a 5. | `AgentOperationCatalog`, plan 09 |
| E7 | `delete_saved_view` pide un ID que la IA no puede descubrir: no hay ninguna lectura de vistas. | `project-action-operations.ts` |
| E8 | FastAPI solo pasa al modelo el mensaje de los errores 400, 403, 404 y 409. Un 422 (`AGENT_RESULT_TOO_LARGE`, «pide menos filas») o un 429 llegan como «No se pudo completar la operación en Nest». | `nest_operation_gateway.py`, `NEST_REJECTIONS` |
| E9 | Cada resultado se corta en 16.000 caracteres (el JSON queda roto) y hay 64 KB por ejecución. Agotado ese total, los resultados llegan vacíos sin avisar. | `agent_toolbox.py`, `_bound_output` |
| E10 | Límites propios: historial de 50 mensajes y 64 KB, 20 llamadas, 24 turnos del modelo, 120 s por ejecución y razonamiento `HIGH` por defecto. | `AGENT_RUN_LIMITS`, `agent_service.py`, `configuration.py` |
| E11 | El prompt de sistema no explica el ciclo de un borrador («llevar a main»), que una importación es un trabajo en segundo plano, que solo cabe una activa por proyecto, ni qué hacer ante un conflicto. | `llamaindex_agent.SYSTEM_PROMPT` |
| E12 | Un chat nuevo no recibe nada del proyecto. Solo `get_project_overview`, si el modelo decide llamarla, trae las 5 últimas importaciones, evaluaciones y 20 libros, sin hojas ni columnas. | `projectOverview` |
| E13 | Qdrant indexa la organización, el proyecto, libros, hojas y filas, catálogo, evaluaciones, reglas, feed, borradores e importaciones de hoja. La IA solo lo consulta si llama a `search_knowledge`, con el texto del mensaje actual. | `knowledge.types.ts`, `agent_toolbox._search` |
| E14 | El selector de herramientas por Qdrant (8 como máximo) existe, pero no está conectado. | `qdrant_operation_selector.py`, `bootstrap/services/agent.py` |
| E15 | Los resultados van al modelo como `json.dumps` con espacios. | `agent_toolbox._encode` |

## Cursos (C)

| ID | Pasaje original | Uso |
| --- | --- | --- |
| C1 | [*Aplicaciones GenAI y Sistemas Multiagente*, sección 13, «141. LangChain Conversation Memory»](</Users/benji/Documents/chrome-extencions/trancripciones/Python/Aplicaciones GenAI y Sistemas Multiagente/Sección 13 Conversation User Interface/141. LangChain Conversation Memory.md>) (`Python/Aplicaciones GenAI y Sistemas Multiagente/…`), línea 15: «A conversation memory system must support two operations. Read and write.» | La memoria se lee antes del modelo y se escribe después. Aquí lo que se escribe no es solo el texto: también la actividad del turno (E1). |
| C2 | Misma lección, línea 17: un contexto grande lleva a «LLM response latency» y a más coste. Línea 29: usar ventana o resumen para «control the size of the conversation history». | Subir los límites sin enviarlo todo: ventana por bytes, aviso de lo omitido y datos compactos en TOON. |
| C3 | [*RAG Multimodal y Agéntico*, sección 7, «30. Advanced RAG Techniques-Conversational Memory»](</Users/benji/Documents/chrome-extencions/trancripciones/Python/RAG Multimodal y Agéntico/Sección 7 Vector Stores And Vector Databases/30. Advanced RAG Techniques-Conversational Memory.md>), líneas 17 y 29: el contexto de la conversación «should also be added while we are searching» y se reformula una sola pregunta con el historial. | La búsqueda previa en Qdrant usa el mensaje actual junto con los anteriores de la persona, no solo un «sí, hazlo». |
| C4 | [*RAG Multimodal y Agéntico*, sección 21, «110. RAG With Persistant Memory With LangGraph»](</Users/benji/Documents/chrome-extencions/trancripciones/Python/RAG Multimodal y Agéntico/Sección 21 RAG With Persistant Memory/110. RAG With Persistant Memory With LangGraph.md>), línea 45: con un *checkpointer* «we have applied a persistent memory itself», por hilo. | La memoria persiste por conversación en las tablas que ya existen (`ai_run_calls`, `ai_proposals`), no en el proceso. |
| C5 | Ya citada en la [ficha 01 del agente](../../../../../LearningAllPosibolIt-ai/docs/fonts/feature/agente/01-fuentes-del-agente.md) como C7: *LlamaIndex para Aplicaciones LLM*, «45. Agents In Production», líneas 13–19. Cada paso encadenado baja la probabilidad de acierto total. | Dividir la tarea en ejecuciones cortas que continúan tras cada confirmación, en lugar de un turno larguísimo. |

## Documentación oficial (F)

| ID | Fuente (consultada el 2026-11-21) | Dato |
| --- | --- | --- |
| F1 | [Vertex AI, «Gemini 3.5 Flash»](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-5-flash) y su [guía](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-3-5-flash) | ID `gemini-3.5-flash`, GA. Ventana de 1.048.576 tokens y 65.536 de salida. Admite el endpoint `global` y llamadas a funciones. Razonamiento `MINIMAL`, `LOW`, `MEDIUM` o `HIGH`, con `MEDIUM` por defecto. El historial debe incluir el contexto completo (pensamientos, llamadas y respuestas) u omitirlo entero. |
| F2 | [Especificación TOON 4.4](https://github.com/toon-format/spec/blob/main/SPEC.md) (2026-10-08, borrador de trabajo, MIT) | Tabla para listas de objetos uniformes (`items[N]{a,b}:`). Desde 4.4, una columna puede ser un objeto uniforme anidado (`values{…}`). Una lista dentro de un elemento rompe la forma tabular. Claves que no son identificadores se escriben entre comillas. |
| F3 | [`toon-format` 1.2.0 en PyPI](https://pypi.org/project/toon-format/) ([repositorio oficial](https://github.com/toon-format/toon-python)) | Publicado el 2026-10-18, MIT, Python ≥ 3.10, sin dependencias, «Production/Stable». API `dumps(obj, indent_size, delimiter, default, sort_keys)`. |

## Mediciones (M)

Hechas en una carpeta temporal con `toon-format` 1.2.0 y `countTokens` de Vertex AI para `gemini-3.5-flash` (gratuito). Datos sintéticos con la forma real de KTSU.

| ID | Medición | Resultado |
| --- | --- | --- |
| M1 | Fixtures oficiales de codificación de la especificación (`tests/fixtures/encode/*.json`) | 160 de 160 correctos. |
| M2 | `list_sheet_history` con 30 elementos | JSON 2.683 tokens → TOON 2.153 (−20 %). |
| M3 | `search_knowledge` con 8 resultados | 999 → 845 tokens (−16 %). |
| M4 | `query_rows` con 50 filas y 8 columnas, sin cambiar la forma | 19.715 → 19.896 tokens (+1 %). Cada fila lleva `problems: []`, una lista que impide la tabla. |
| M5 | La misma página con la lista vacía de problemas separada de cada fila | 19.715 → 4.500 tokens (**−78 %**). TOON usa la tabla con el grupo anidado `values{…}`. El JSON compacto solo baja un 5 %. |

## Mapa necesidad → fuentes → decisión pendiente

| Necesidad | Fuentes | Decisión pendiente (plan 10) |
| --- | --- | --- |
| Recordar lo hecho entre mensajes | E1, E2, C1, C4, F1 | Mandar con cada mensaje del historial la actividad de su ejecución (llamadas con sus IDs y la propuesta con su resultado). Va como texto en TOON, no como llamadas a funciones parciales (F1). |
| Seguir sola tras confirmar | E2–E4, C5 | Al confirmar, guardar el mensaje «Confirmé: …» de la persona y poner en cola una ejecución que continúa. Si confirmar falla, la propuesta queda `failed` y la ejecución que continúa recibe el motivo. |
| Recuperarse de los errores | E4, E5, E8, E11 | Pasar al modelo cualquier 4xx con su código; herramientas `rebase_changeset` y `reopen_changeset`; un prompt con el ciclo del borrador. |
| Acceso completo salvo adjuntos | E6, E7 | Herramientas nuevas sobre los servicios existentes, con los mismos permisos que la web. |
| Menos tokens | E9, E15, F2, F3, M1–M5 | Convertir a TOON en FastAPI todo lo que va al modelo, con un paso previo sin pérdida que separa las listas anidadas. Los esquemas de herramientas siguen en JSON Schema (lo exige Gemini). |
| Contexto del proyecto en un chat nuevo | E12, E13, C3 | Ficha del proyecto que Nest arma en cada ejecución, más una búsqueda previa en Qdrant con el mensaje y los anteriores de la persona. |
| No cortar sin avisar | E9, E10, C2 | Subir los límites, recortar por líneas con un aviso explícito y razonamiento `MEDIUM` por defecto (F1). |
