# 10 — Plan: IA interna con contexto, memoria, TOON y acceso completo

Fecha de creación: 2026-11-21  
Estado: En curso  
Ámbito: Nest (`LearningAllPosibolIt`), FastAPI (`LearningAllPosibolIt-ai`) y Nuxt (`LearningAllPosibolIt-web`), rama `feature/ia-contexto` creada desde `deploy/vercel`  
Revisión de partida: Nest `55a04a1`, FastAPI `bdf72e0` y Nuxt `9ceec48`  
Relacionada con: [fuentes 12](../../../fonts/feature/ai-assistant/12-fuentes-ia-con-contexto-memoria-y-toon.md), [plan 09](09-plan-asistente-general-de-hojas.md) (sus etapas 3 a 5 se cubren aquí), [plan 05](05-plan-catalogo-ejecuciones-y-confirmaciones.md) y el [contrato del chat](../../../../contracts/chat/README.md).

## Objetivo

Que la IA del chat pueda hacer en Hojas, Catálogo, Reglas, Evaluaciones y Feed todo lo que una persona hace a mano en la web, salvo subir archivos. Debe recordar lo que hizo entre mensajes, seguir sola cuando la persona confirma, recuperarse de los errores y empezar cada chat conociendo el proyecto. Los datos le llegan en TOON para gastar menos tokens.

## Hecho antes de este plan

- 2026-11-21: `CHAT_MODEL` de `ktsu-ai` en Vercel pasó de `gemini-3.5-flash-lite` a `gemini-3.5-flash` (F1). Se redesplegó con el mismo código: `READY`, y `/health` respondió 200.

## Decisiones

| ID | Decisión | Respaldo |
| --- | --- | --- |
| D1 | **Memoria = actividad del turno.** Nest manda con cada mensaje del asistente del historial la actividad de su ejecución: cada llamada (operación, estado y los IDs de `target`) y la propuesta (operación, resumen, estado, resultado o error). Sale de `ai_run_calls` y `ai_proposals`, que ya existen. FastAPI la añade en TOON al texto de ese mensaje. No se reconstruyen llamadas a funciones parciales: F1 pide el contexto completo u omitirlo. | E1, E2, C1, C4, F1 |
| D2 | **Límites a la medida del modelo.** Historial de 100 mensajes y 256 KB (contando la actividad), con el número de mensajes omitidos para que el modelo lo sepa. 40 llamadas y 40 turnos por ejecución (*ajustado en E1:* 48 turnos, para que el límite de llamadas llegue antes, como los 24 para 20 de antes). 180 s en FastAPI, 210 s de espera en Nest y 240 s de reclamo. Hasta 60 KB por resultado (igual que `readResultBytes`) y 512 KB por ejecución. El recorte se hace por líneas y con aviso; nunca devuelve un texto vacío. Razonamiento `MEDIUM` por defecto. | E9, E10, C2, F1 |
| D3 | **TOON dentro de FastAPI.** `toon-format==1.2.0` fijado (F3, M1). Todo lo que va al modelo sale por un único módulo, `model_text`: resultados de herramientas, escrituras aplicadas, búsquedas de conocimiento, actividad del historial y ficha del proyecto. Antes de codificar, un paso sin pérdida separa las listas de objetos anidadas en una tabla hermana con la clave del padre (M4 → M5). Los esquemas de herramientas siguen en JSON Schema, porque lo exige Gemini, y el contrato Nest ↔ FastAPI sigue en JSON. | E15, F2, F3, M1–M5 |
| D4 | **Errores que el modelo entiende.** FastAPI pasa al modelo cualquier 4xx de Nest salvo el 401, con su código y el mensaje en el idioma de la ejecución. Un fallo de transporte o un 5xx sigue siendo genérico. | E8 |
| D5 | **Ficha del proyecto en cada ejecución.** Nest la arma con una sola consulta acotada: configuración y rol; libros activos con sus hojas (filas, columnas con tipo, revisión vigente y borradores abiertos); últimas importaciones del catálogo con su estado; última revisión de reglas; evaluaciones; feed; y las últimas acciones confirmadas por esa persona en el proyecto, que sirven de memoria entre chats. Va en el campo `project` de la petición. Se manda siempre, no solo en el primer mensaje, porque los datos cambian mientras la IA trabaja. | E12, C1 |
| D6 | **Búsqueda previa en Qdrant.** Antes de llamar al modelo, FastAPI busca en el conocimiento del proyecto autorizado con el mensaje actual y los dos anteriores de la persona (C3), hasta 6 resultados. Los añade al prompt en TOON, marcados como datos. Si Qdrant falla, la ejecución sigue sin ellos y queda registrado. | E13, C3 |
| D7 | **Confirmas y sigue sola** (decisión del usuario). Al confirmar una propuesta del chat, Nest guarda, en la misma transacción que la continuación, el mensaje de la persona «Confirmé: …» (`client_message_id` = `proposal:<id>`). Después pone en cola una ejecución con el mismo contexto y responde `{ proposal, continuation }`. Si confirmar falla, la propuesta pasa a `failed` con su error y la continuación recibe «No se pudo aplicar: … Motivo: …». Rechazar no continúa. Si la cuota o una ejecución activa impiden continuar, la confirmación vale igual y la respuesta lo dice. Las propuestas del MCP no cambian. | E2–E4, C5 |
| D8 | **Herramientas que faltan**, sobre los servicios de la web y con los mismos permisos que su ruta REST: `submit_changeset`, `reopen_changeset`, `reject_changeset`, `rebase_changeset`, `propose_revert`, `duplicate_worksheet`, `open_catalog_as_worksheet`, `list_saved_views`, `update_saved_view` (y `suggest_view` con visibilidad de equipo), `list_import_mappings`, `create_import_mapping`, `delete_import_mapping`, `export_worksheet`, `list_catalog_imports`, `delete_catalog_import`, `set_feed_source`, `set_feed_schedule` y `approve_feed_policy`. | E5–E7 |
| D9 | **Guía de trabajo en el prompt:** el ciclo de un borrador («llevar a main» = enviar, aprobar y aplicar), qué hacer ante `CHANGESET_BASE_OUTDATED` o un conflicto (`rebase_changeset`), que una importación es un trabajo en segundo plano y solo cabe una activa por proyecto, qué significa un mensaje «Confirmé:» y cómo usar la ficha del proyecto. | E5, E11 |
| D10 | **Nuxt** sigue la ejecución que continúa tras confirmar, muestra una propuesta `failed` con su motivo y refresca o enlaza lo que tocan las herramientas nuevas. | D7, D8 |

Fuera de este plan: subir archivos desde el chat (decisión del usuario), el bucket de Vercel (decisión del usuario), la etapa 6 del plan 09 (análisis y agregados), desactivar la entrega del feed y rotar su token (rotar está prohibido y reactivarla lo exige). El selector de herramientas por Qdrant sigue desconectado: ocultaría herramientas, y Gemini maneja el catálogo completo (E14).

## Etapas

| Etapa | Qué | Comprobación |
| --- | --- | --- |
| ✅ E1 | FastAPI: módulo `model_text` (separar listas y TOON), resultados de herramientas y conocimiento en TOON, recorte con aviso, errores 4xx con código e idioma, límites de D2 y `MEDIUM` por defecto. | Pruebas unitarias; medición de tokens repetida con el módulo real; `ruff`, `mypy --strict`, `import-linter` y la batería completa; defectos a propósito. |
| E2 | Memoria (D1): Nest añade a `promptOf` la actividad y los mensajes omitidos y sube los límites; FastAPI acepta y pinta la actividad en TOON. | Nest: pruebas de integración con PGlite y E2E de la petición enviada. FastAPI: contrato y pintado. Defectos en ambos. |
| E3 | Ficha del proyecto (D5) y búsqueda previa en Qdrant (D6). | Nest: la ficha respeta el acceso (otro propietario no ve nada), los topes y los archivados. FastAPI: prompt con ficha y conocimiento, y la ejecución sigue con Qdrant caído. Defectos. |
| E4 | Confirmar y seguir (D7): migración del estado `failed` y su error, continuación y respuesta nueva; Nuxt la sigue (D10). | Nest: E2E de confirmar → continuación, fallo → `failed` + continuación, rechazo sin continuación, cuota agotada, idempotencia y MCP sin cambios. Esquema frente a migraciones. Nuxt: pruebas del chat. Defectos. |
| E5 | Herramientas de D8 y su reflejo en Nuxt (D10). | Pruebas por herramienta con dos organizaciones, roles y lo ajeno (404); catálogo describiendo las nuevas sin nombres prohibidos. Defectos. |
| E6 | Prompt de trabajo (D9) y evaluación con casos sintéticos de varios pasos. | Pruebas del prompt y de la evaluación con el modelo guionizado. |
| E7 | Cierre: batería completa de los tres repositorios, arranque real, recorrido local Nest + FastAPI con un modelo guionizado, contrato del chat y documentos de diseño. | Cifras en la bitácora de cierre; lo que no se pudo probar en producción queda escrito. |

## Límites del plan

- No se hace commit ni push sin que el usuario lo pida. Desplegar es hacer push a `deploy/vercel`.
- La migración de E4 se prueba en local. En Neon solo se aplica si el usuario lo pide, con `migrate status` y después `migrate deploy`.
