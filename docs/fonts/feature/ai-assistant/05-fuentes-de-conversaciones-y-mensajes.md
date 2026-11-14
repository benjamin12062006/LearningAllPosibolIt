# 05 — Fuentes de conversaciones y mensajes

Fecha de creación: 2026-11-14  
Última actualización: 2026-11-14  
Estado: Investigación para E6.2.  
Relacionada con: [plan 03](../../../plans/feature/ai-assistant/03-plan-conversaciones-y-mensajes.md), [bitácora 08](../../../../bitacora-construccion/feature/ai-assistant/08-conversaciones-y-mensajes.md), [fuentes 01](01-fuentes-del-visor-qdrant-y-llamaindex.md).  
Revisión de partida: Nest `7be788b`, FastAPI `d9f00fd`.

## Necesidad

Una persona necesita recuperar su historial al volver a un proyecto, una hoja o un libro. Si pierde la respuesta HTTP después de guardar la pregunta, repetir la petición debe recuperar ese mensaje. El historial debe conservarse dentro del mismo ámbito de acceso que la hoja y solo puede leerlo su autor en esta etapa.

## Diseño del producto

| ID | Requisito | Procedencia |
| --- | --- | --- |
| H1 | Nest conserva conversación y mensajes. El contexto se vincula a una hoja o al libro que recibirá una propuesta de hoja. La conversación es privada. Cada mensaje tiene rol, autor, secuencia y `clientMessageId` único por conversación y autor. | [Diseño 15](../../../../../docs-diagrams/15-chat-ia-herramientas-y-propuestas.md), líneas 14–30 y 118–122. |
| H2 | Crear desde libro u hoja, exponer historial paginado y resolver los IDs dentro de la organización y el proyecto. Si cambia el contenido asociado a una clave repetida, responder 409. | [Diseño 16](../../../../../docs-diagrams/16-nuxt-tabla-central-chat-y-contratos.md), líneas 79, 105–114. |
| H3 | E6.2 entrega almacenamiento, rutas y privacidad. E6.3a incorpora la ejecución. La secuencia de entrega permite hacer el contrato del mensaje persistido antes de integrar el run, aunque los diseños 15 y 16 describan ambos juntos. | [Plan E6](../../../plans/feature/ai-assistant/01-plan-e6-ia-con-qdrant-y-llamaindex.md), D8 y apartado «Etapas»; [contexto de continuidad](../../../../../CONTEXTO-SIGUIENTE-CHAT.md), sección 5. |
| H4 | Comprobar 404 para conversación ajena en T02. C7 prevé consultas y mutaciones de chat para Nuxt; los eventos quedan en SSE cuando se incorporen. | [Diseño 18](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md), T02; [ficha 05 de C7](../graphql&rulesets-evaluations-exports/05-inventario-y-alcance-de-c7.md), líneas 98–111. |

## Código existente

| ID | Hallazgo | Archivo y símbolo |
| --- | --- | --- |
| E1 | Las escrituras de hojas toman el bloqueo de la organización y consultan membresía y ámbito dentro de la misma transacción. El rol Editor, Manager, Admin y Owner tiene `ai.use`; Viewer tiene `organization.read`. La comprobación de hoja activa cubre también el archivado de su libro. | [`lockProjectFor` y `assertWorksheetActive`](../../../../src/worksheets/worksheets.repository.ts), líneas 617–640 y 727–747; [`permissionsFor`](../../../../src/organizations/organization-roles.ts), líneas 13–61. |
| E2 | Una vista personal filtra por propietario en su consulta. El caso de uso de proyecto bloquea antes de reconocer una clave repetida y usa el mismo código de conflicto si cambia su contenido. | [`SavedViewsRepository.find`](../../../../src/worksheets/saved-views.repository.ts), líneas 56–94; [`ProjectsRepository.create`](../../../../src/projects/projects.repository.ts), líneas 80–132. |
| E3 | El esquema permite referenciar un libro por organización, proyecto e ID. La pertenencia exacta de la hoja al libro se puede fijar con una clave compuesta adicional. Los libros y las hojas usan borrado restringido y los proyectos con libros ya son indelebles por la ruta pública. | [Esquema Prisma](../../../../prisma/schema.prisma), modelos `Workbook` y `Worksheet`; [`CatalogImportRepository.deleteProject`](../../../../src/catalog-import/catalog-import.repository.ts), líneas 389–412. |
| E4 | FastAPI recibe el disparador como `message` y el historial aparte. Acepta hasta 50 entradas, roles `user` y `assistant`, y contenidos de 1 a 16.000 caracteres. | [`AgentRunRequest` y `AgentHistoryRequest`](../../../../../LearningAllPosibolIt-ai/src/ktsu_ai/http/agent_http/agent_dto.py), líneas 59–73. |
| E5 | El pipe global rechaza campos extra y conserva errores públicos. Hay un cursor de hoja que valida su ámbito, aunque su contenido sea específico de revisiones y filtros. La cobertura C7 contrasta decoradores REST, matriz y esquema GraphQL. | [`VALIDATION_OPTIONS`](../../../../src/common/http/validation-options.ts), líneas 9–15; [`readCursor`](../../../../src/worksheets/worksheet-rows.service.ts), líneas 182–204; [cobertura C7](../../../../test/features/graphql/coverage.spec.ts), líneas 94–123. |

## Curso y reconstrucciones

Curso local `Angular/Angular OpenAI con NestJS`, sección 15 «Backend - Asistentes de OpenAI». El original lo identifica como *Imágenes, modelos, audio a texto, texto a audio, asistentes, transcripciones, traducciones, librería de OpenAI y más.* Consulta del 2026-11-14.

| ID | Lección y evidencia | Reconstrucción derivada |
| --- | --- | --- |
| C1 | [134. Crear módulo - Assistant](</Users/benji/Documents/chrome-extencions/trancripciones/Angular/Angular OpenAI con NestJS/Sección 15 Backend - Asistentes de OpenAI/134. Crear módulo - Assistant.md>), líneas 13–17 y 21–29. Define un módulo con controlador y servicio, un DTO de pregunta y dos operaciones. Localizador «una funcionalidad totalmente independiente». | [RC1, fases 1–3 y `QuestionDto`](<reconstrucciones/salida-2026-11-14/Sección 15 Backend - Asistentes de OpenAI/134. Crear módulo - Assistant - Reconstrucción guiada.md>). Los nombres exactos de rutas y decoradores se reconstruyen a partir del comportamiento narrado. |
| C2 | [135. Crear Thread - Caso de Uso](</Users/benji/Documents/chrome-extencions/trancripciones/Angular/Angular OpenAI con NestJS/Sección 15 Backend - Asistentes de OpenAI/135. Crear Thread - Caso de Uso.md>), líneas 13–19 y 25–29. El hilo conserva mensajes entre sesiones y devuelve un identificador. Localizador «contenedor de mensajes». | Contexto heredado en RC2, código de `createThreadUseCase`. |
| C3 | [136. Crear Mensaje - Caso de Uso](</Users/benji/Documents/chrome-extencions/trancripciones/Angular/Angular OpenAI con NestJS/Sección 15 Backend - Asistentes de OpenAI/136. Crear Mensaje - Caso de Uso.md>), líneas 13–23 y 25–33. El caso de uso recibe el ID del hilo y la pregunta, fija el rol de usuario y añade el mensaje. Localizador «la creación de un mensaje no lo ejecuta». | [RC2, fases 1–3 y `createMessageUseCase`](<reconstrucciones/salida-2026-11-14/Sección 15 Backend - Asistentes de OpenAI/136. Crear Mensaje - Caso de Uso - Reconstrucción guiada.md>). El curso ilustra la operación del SDK beta y deja la llamada al run para más adelante. |

Las recetas y la salida se conservaron bajo `reconstrucciones/`, siguiendo la convención documental de este repositorio. Los enlaces al original se resolvieron hacia la biblioteca durante el renderizado. La herramienta comprobó dos guías y las huellas de tres transcripciones. Las comprobaciones que muestran las guías son ejercicios del curso.

## Necesidad, evidencia y decisión propuesta

| Necesidad | Evidencia | Decisión del plan 03 |
| --- | --- | --- |
| Retomar la conversación entre sesiones | C1/RC1 delimita el módulo. C2/RC2 recupera el historial por hilo. H1 y H3 sitúan la persistencia en Nest. | D1, `ConversationsModule` y dos tablas en PostgreSQL. |
| Proteger conversaciones privadas | H1 y H4 fijan la privacidad. E1 y E2 muestran autorización por membresía, permiso y propiedad. | D2, validar ámbito y autor antes de errores de estado o permiso. |
| Recuperar un envío repetido sin duplicarlo | C3/RC2 distingue añadir el mensaje de ejecutar el asistente. H2 y E2 sustentan el conflicto. E3 da la estructura para protegerlo en SQL. | D3, unicidad, secuencia bajo bloqueo y POST que devuelve el mensaje persistido. |
| Leer historial paginado y preparar el contrato del agente | H2 y H4 piden historial recuperable y C7. E4 y E5 delimitan el contenido, los cursores y la validación compartida. | D4 y D5, texto plano, cursor estable, paridad REST y GraphQL con los mismos servicios. |
