# 05 — Inventario de la API y alcance de C7 (GraphQL para FastAPI y Nuxt)

Fecha de creación: 2026-11-13  
Última actualización: 2026-11-14 (las 21 rutas de H1–H5 entran en la matriz; C7 construido).  
Estado: Investigación con piloto medido (2026-11-13). Matriz, alcance recomendado y mediciones de tres recorridos. C7 construido el 2026-11-14 (ver la nota de la matriz).  
Relacionada con: [23, plan C7](../../../../../docs-diagrams/23-graphql-nest-para-fastapi-y-nuxt.md), [plan 02 de cierre](../../../plans/feature/cierre-backend/02-plan-terminar-hojas-visor-y-agente.md), [plan aplazado de GraphQL](../../../plans/feature/graphql&rulesets-evaluations-exports/01-plan-aplazado-sincronizacion-graphql.md), [04, mapa de necesidades](04-mapa-de-necesidades-para-el-plan.md), [fuentes 04 de cierre](../cierre-backend/04-fuentes-de-terminar-hojas-visor-y-agente.md).  
Revisión de partida: `feature/cierre-backend` `3733be4` más V5 sin commit.

## Cómo se hizo

Un script recorre los decoradores `@Controller`, `@Get`, `@Post`, `@Put`, `@Patch` y `@Delete` de los 21 controladores de `src/` y saca una fila por método y ruta. Cada fila se clasifica a mano y el script falla si una ruta montada queda sin clasificar o si se clasifica una que no existe: los recuentos salen de la matriz, no de una suma aparte. El equivalente que ya existe se comprobó contra `test/features/graphql/schema.expected.graphql`.

## Resultado

*Actualizado el 2026-11-14 con las rutas de H1–H5.* La foto del 2026-11-13 tenía 88 rutas; H1–H5 añadieron 21, todas elegibles y todas con equivalente previsto.

| Dato | Rutas | Cálculo |
| --- | --- | --- |
| Rutas REST montadas | 109 | 88 del 2026-11-13 + 21 de H1–H5 |
| Se quedan en HTTP por contrato | 10 | 3 subidas multipart, 3 descargas, URL pública del feed, salud, sesión (`auth/me`) y alta al iniciar sesión |
| **Elegibles** | **99** | 109 − 10 |
| Elegibles que se quedan en REST | 14 | 12 de organizaciones y 2 del token de entrega |
| Ya tenían equivalente GraphQL | 10 | perfil, proyectos e importaciones de catálogo |
| Añadidas por el piloto (2026-11-13) | 7 | hoja y sus filas; feed, entrega y comparación; evaluación y «Requiere atención» |
| Quedan por añadir | 68 | 47 del 2026-11-13 + 21 de H1–H5 |
| **Con equivalente al cerrar C7** | **85** | 10 + 7 + 68 |

- **Cobertura sobre el total: 85 / 109 = 78,0 %.** Dentro de la referencia del 70–85 %.
- **Cobertura sobre las elegibles: 85 / 99 = 85,9 %.**
- Antes del piloto: 10 / 109 = 9,2 %. Con el piloto: 17 / 109 = 15,6 %.
- **Nuxt** puede usar las 85. **FastAPI (el agente)** tiene permitidas 61: las 46 de antes y 15 de H1–H5. Las otras 24 son solo de la persona.
- Usar una plantilla de mapeo al importar (`mappingId`) va dentro de la subida multipart: sigue en HTTP.

<!-- Recuentos del 2026-11-13, antes de H1–H5: 88 rutas, 78 elegibles, 64 con equivalente (72,7 % y 82,1 %), 46 para el agente. -->

### Por qué no más

Llegar al 85 % del total (75 rutas) obligaría a pasar a GraphQL casi todo organizaciones. No se gana nada:

- Sus pantallas ya existen en la web con REST y son lecturas simples o un botón; no hay lectura compuesta que ahorre llamadas.
- El agente tiene prohibido cambiar miembros y roles (D9 del plan E6), y la lista de miembros lleva correos, que no salen hacia la IA (D18).
- El token de entrega se enseña una sola vez: dos caminos para un secreto son dos sitios donde equivocarse.

### Por qué no menos

Por debajo del 70 % habría que dejar fuera mutaciones de borradores o de reglas. Entonces el agente y la web necesitarían los dos clientes para un mismo recorrido (leer por GraphQL y escribir por REST), que es justo lo que C7 quiere evitar.

## Las operaciones GraphQL que el agente no puede usar

Borrar (`deleteProject`, `deleteImport`), aprobar o aplicar (`approveExport`, `decideChangeset`, `applyChangeset`, `approveFeedPolicy`), publicar o lo que puede acabar publicando (`publishFeed`, `requestFeedRefresh`), configurar el feed (`createFeed`, `setFeedSource`, `setFeedSchedule`), gastar cuota (`reindexKnowledge`), y las que son de la persona en la web (`updateMe`, `createProject`, `updateProject`, `reopenChangeset`, `cancelChangeset`, `Project.knowledge`). Desde H1–H5 se añaden archivar y restaurar libros y hojas (son de Manager) y borrar plantillas y vistas: 24 en total. El catálogo de operaciones de E6.3a es quien lo hace cumplir; esta columna es su punto de partida.

## Piloto y mediciones (2026-11-13)

Se añadió al GraphQL existente un piloto con dos lecturas compuestas y se midió contra REST. El piloto se queda como primera porción de C7: `worksheet { columns, rows }`, `feed { delivery, comparison }` y `evaluation { attention }` (`src/graphql/worksheets`, `feeds` y `evaluations`), con seis pruebas de paridad en [`pilot.e2e-spec.ts`](../../../test/features/graphql/pilot.e2e-spec.ts).

**Cómo se midió.** Un script monta `GraphqlApiModule` sobre PGlite, escucha por HTTP real y recorre cada camino 40 veces tras 5 de calentamiento, con el mismo actor, los mismos datos y la misma página. Cuenta las llamadas HTTP, los bytes del cuerpo de las respuestas, las sentencias SQL (interceptando `pg.Client.query`) y la latencia del recorrido completo. En REST las llamadas van una detrás de otra, como las encadena un cliente.

**Datos.** Una hoja de 1.000 filas y cinco columnas, página de 100. Un catálogo publicado de 500 productos y un candidato de 500 (470 válidos, 20 inválidos y 10 excluidos) con 50 precios cambiados, 10 productos nuevos y 40 que salen.

| Recorrido | Vía | Llamadas HTTP | Bytes | SQL | p50 (ms) | p95 (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| Hoja con columnas y 100 filas | REST | 2 | 33.646 | 9 | 5,6 | 6,3 |
| | GraphQL | 1 | 33.457 | 9 | 5,1 | 5,9 |
| Diagnóstico del feed (feed, entrega, comparación y «Requiere atención») | REST | 4 | 4.595 | 33 | 16,6 | 20,2 |
| | GraphQL | 1 | 3.474 | 38 | 16,2 | 17,7 |
| Control: un proyecto | REST | 1 | 209 | 3 | 1,1 | 1,3 |
| | GraphQL | 1 | 219 | 3 | 1,3 | 1,8 |

### Qué dicen

1. **GraphQL ahorra viajes, no trabajo.** Las llamadas bajan de 2 a 1 y de 4 a 1, pero el servidor hace lo mismo: las mismas 9 sentencias en la hoja y casi el mismo tiempo. Con todo en la misma máquina la latencia no cambia; el ahorro aparece cuando cada viaje cuesta, es decir, en el navegador (Nuxt) más que en FastAPI, que estará junto a Nest.
2. **En el diagnóstico GraphQL hace más SQL: 38 frente a 33.** Cada campo llama a su servicio y cada servicio vuelve a comprobar el acceso al proyecto y a buscar el feed o la evaluación. En REST eso mismo se reparte entre cuatro peticiones; aquí se repite dentro de una. No es un N+1 por lista, pero crece con cada campo que se añada.
3. **Los bytes bajan donde el cliente elige campos** (un 24 % en el diagnóstico) y no bajan donde se piden todos (la hoja).
4. **La lectura simple no gana nada**: mismo SQL, 10 bytes más y unas décimas más de latencia.
5. **Un fallo encontrado al probar:** Nest no aplica los filtros de error a los campos (`@ResolveField`) si no se le pide. Un 409 lanzado desde `comparison` salía como `INTERNAL_ERROR`. Corregido con `fieldResolverEnhancers: ['filters']` en `graphql-config.ts`. Los guards no se activan por campo a propósito: la consulta raíz ya validó la sesión y repetirlo sería una llamada al proveedor de identidad por campo.

### Qué cambia en el alcance

El alcance recomendado se mantiene (64 rutas, 72,7 %), con tres condiciones para construirlo:

- **Priorizar las lecturas compuestas** (hoja, diagnóstico, resumen del proyecto, borrador con su diff). Las lecturas simples se añaden por coherencia del cliente, no por rendimiento.
- **Recordar el acceso dentro de una petición** (una caché por petición del acceso al proyecto, y del recurso padre) antes de añadir más campos, y volver a medir: el objetivo es que el diagnóstico no pase de las 33 sentencias de REST.
- **DataLoader en cuanto un campo cuelgue de una lista** (`Project.feeds { delivery }`, `Workbook.worksheets`): ahí sí habría N+1. En el piloto no hay ninguna lista de padres con campos hijos.

### Límites de la medición

- PGlite en el mismo proceso, un solo cliente y sin concurrencia. Las latencias sirven para comparar las dos vías, no como cifra de producción. Contra Cloud SQL cada sentencia cuesta un viaje de red, así que las 5 sentencias de más pesarían más que aquí.
- No hay caché en ninguna de las dos vías, así que no hay diferencia entre frío y caliente que medir.
- La consulta de filas del piloto admite página, cursor y revisión; el filtro y el orden de REST son árboles y necesitan un tipo de entrada, que llega con C7.

## Otros recorridos (sin medir)

| Recorrido | Hoy con REST | Con GraphQL |
| --- | --- | --- |
| Resumen del proyecto | 6 llamadas: proyecto, acceso, importaciones, reglas, evaluaciones y feeds | 1: `project { access, imports, rulesets, evaluations, feeds }` |
| Revisar un borrador | 2: el borrador y su diff | 1: `changeset { diff }` |

## Decisiones que la matriz deja tomadas

1. **Campos en lugar de consultas sueltas.** Lo que cuelga de un recurso se expone como campo suyo (`Evaluation.rows`, `Feed.delivery`, `Worksheet.rows`), con `@ResolveField`: es lo que permite las lecturas compuestas.
2. **`rulesPreview` es una consulta**, aunque en REST sea `POST`: no guarda nada.
3. **Mismos servicios que REST.** Ningún resolver toca un repositorio: validación, permisos y errores son los de REST (ajeno 404, sin permiso 403, organización archivada 409).
4. **Identidad del agente.** GraphQL no decide qué puede hacer el agente: lo decide el catálogo de E6.3a con el token por ejecución. En C7 solo se prueba una llamada autenticada desde Python y el rechazo de una credencial o un alcance incorrectos.

## Operaciones que todavía no existen

H1–H5 ya existen y están en la matriz (2026-11-14). Quedan fuera hasta que existan:

| Etapa | Operaciones previstas | Equivalente previsto | Consumidor |
| --- | --- | --- | --- |
| E6.3a–E6.4 | Ejecuciones, confirmaciones y eventos por SSE | Consultas y mutaciones; SSE sigue en HTTP | Nuxt |
| H6 | Herramientas de hoja para el agente (`preview_transform`, `create_change_proposal`, `propose_sheet_layout`) | Mutaciones | FastAPI |

## Lo que falta de la evaluación

*Hecho al construir C7 (2026-11-14):* `isOneOf` funciona (bitácora 03 de C7), el cliente Python llama a Nest con dos organizaciones y una credencial inválida (bitácora 06) y el diagnóstico repetido con la caché baja a 22 sentencias (bitácora 02). La identidad de servicio de FastAPI y el alcance delegado pasan a E6.3a.

- El experimento de `@InputType({ isOneOf: true })` con el `ValidationPipe` global (N2 del [mapa](04-mapa-de-necesidades-para-el-plan.md)), del que depende `createRuleset`.
- Decidir cómo valida Nest la identidad de servicio de FastAPI y el alcance delegado; se prueba al construir C7 con un cliente Python mínimo.
- Repetir la medición del diagnóstico después de la caché de acceso por petición.

## Matriz

*Nota del 2026-11-14, al cerrar C7:* las 68 filas «Añadir» están construidas. La prueba [`coverage.spec.ts`](../../../../test/features/graphql/coverage.spec.ts) lee esta tabla, la compara con las rutas montadas en los controladores y comprueba que cada equivalente existe en el esquema esperado: 109 rutas, 85 con equivalente, 10 solo HTTP y 14 en REST. Las decisiones se dejan como se tomaron. La consulta de filas ya admite filtro, orden, columnas y vista guardada. El experimento de `isOneOf` está hecho (bitácora 03 de C7).

`…/proyecto` es `/api/v1/projects/:projectId` y `…/org/proyecto` es `/api/v1/organizations/:organizationId/projects/:projectId`. Decisión: **Existe** (ya estaba en el esquema), **Existe (piloto)** (añadida el 2026-11-13), **Añadir** (C7), **REST** (elegible, pero se queda como está) y **HTTP** (no elegible por contrato).

E6.2 añade seis rutas de conversaciones y mensajes con equivalente GraphQL. Cobertura resultante: 91 de 115 rutas, 10 solo HTTP y 14 en REST.

| Módulo | Ruta | Permiso | Equivalente GraphQL | Consumidor | Decisión | Motivo |
| --- | --- | --- | --- | --- | --- | --- |
| `auth` | `GET /auth/me` | Sesión | — | — | HTTP | Diagnóstico de la sesión; el perfil ya es `me` |
| `catalog-import` | `POST …/proyecto/imports` | Editor | — | Nuxt | HTTP | Subida multipart |
| `catalog-import` | `GET …/proyecto/imports` | Miembro | `Project.imports` | Ambos | Añadir | Lista dentro del resumen del proyecto |
| `catalog-import` | `GET …/proyecto/imports/:snapshotId` | Miembro | `importSnapshot` | Ambos | Existe |  |
| `catalog-import` | `DELETE …/proyecto` | Admin | `deleteProject` | Nuxt | Existe | Prohibido al agente (borrar) |
| `catalog-import` | `DELETE …/proyecto/imports/:snapshotId` | Editor | `deleteImport` | Nuxt | Existe | Prohibido al agente (borrar) |
| `catalog-import` | `GET …/proyecto/jobs/:jobId` | Miembro | `importJob` | Ambos | Existe |  |
| `changesets` | `POST …/org/proyecto/worksheets/:worksheetId/changesets` | Editor | `createChangeset` | Ambos | Añadir |  |
| `changesets` | `GET …/org/proyecto/changesets/:changesetId` | Miembro | `changeset` | Ambos | Añadir |  |
| `changesets` | `PUT …/org/proyecto/changesets/:changesetId/operations` | Editor | `saveChangesetOperations` | Ambos | Añadir | Conserva `draftVersion` (412) |
| `changesets` | `GET …/org/proyecto/changesets/:changesetId/diff` | Miembro | `Changeset.diff` | Ambos | Añadir | Borrador y diff en una llamada |
| `changesets` | `POST …/org/proyecto/changesets/:changesetId/submit` | Editor | `submitChangeset` | Ambos | Añadir |  |
| `changesets` | `POST …/org/proyecto/changesets/:changesetId/reopen` | Editor | `reopenChangeset` | Nuxt | Añadir |  |
| `changesets` | `POST …/org/proyecto/changesets/:changesetId/cancel` | Editor | `cancelChangeset` | Nuxt | Añadir |  |
| `changesets` | `POST …/org/proyecto/changesets/:changesetId/decisions` | Manager | `decideChangeset` | Nuxt | Añadir | Prohibido al agente (aprobar) |
| `changesets` | `POST …/org/proyecto/changesets/:changesetId/apply` | Manager | `applyChangeset` | Nuxt | Añadir | Prohibido al agente (aplicar); conserva la idempotencia |
| `changesets` | `POST …/org/proyecto/changesets/:changesetId/rebase` | Editor | `rebaseChangeset` | Ambos | Añadir |  |
| `changesets` | `POST …/org/proyecto/revisions/:revisionId/revert-proposal` | Editor | `proposeRevert` | Ambos | Añadir | Crea un borrador, no aplica |
| `conversations` | `POST …/org/proyecto/conversations` | Editor | `createProjectConversation` | Nuxt | Existe | Conversación privada del proyecto |
| `conversations` | `POST …/org/proyecto/workbooks/:workbookId/conversations` | Editor | `createWorkbookConversation` | Nuxt | Existe | Conversación privada |
| `conversations` | `POST …/org/proyecto/worksheets/:worksheetId/conversations` | Editor | `createWorksheetConversation` | Nuxt | Existe | Conversación privada |
| `conversations` | `GET …/org/proyecto/conversations` | Miembro autor | `Project.conversations` | Nuxt | Existe | Lista privada por proyecto |
| `conversations` | `GET …/org/proyecto/conversations/:conversationId` | Miembro autor | `conversation` | Nuxt | Existe | Detalle privado |
| `conversations` | `POST …/org/proyecto/conversations/:conversationId/messages` | Editor autor | `appendConversationMessage` | Nuxt | Existe | `clientMessageId` idempotente |
| `conversations` | `GET …/org/proyecto/conversations/:conversationId/messages` | Miembro autor | `Conversation.messages` | Nuxt | Existe | Historial privado con cursor |
| `worksheet-tools` | `POST …/org/proyecto/worksheets/:worksheetId/selections` | Editor con `ai.use` | `createWorksheetSelection` | Ambos | Existe | H6: fija filas y columnas de una revisión |
| `worksheet-tools` | `POST …/org/proyecto/worksheets/:worksheetId/transform-previews` | Editor con `ai.use` | `previewWorksheetTransform` | Ambos | Existe | H6: diff calculado sin escribir |
| `worksheet-tools` | `GET …/org/proyecto/worksheets/:worksheetId/transform-previews/:previewId` | Editor con `ai.use` | `worksheetTransformPreview` | Ambos | Existe | H6: diff paginado |
| `worksheet-tools` | `POST …/org/proyecto/worksheets/:worksheetId/change-proposals` | Editor con `ai.use` | `createWorksheetChangeProposal` | Ambos | Existe | H6: solo crea un borrador de origen `ai` |
| `agent-runs` | `POST …/org/proyecto/conversations/:conversationId/runs` | Editor autor | `startAgentRun` | Nuxt | Existe | E6.3a: 202, ejecución en cola |
| `agent-runs` | `GET …/org/proyecto/conversations/:conversationId/runs/latest` | Miembro autor | — | Nuxt | REST | Chat de proyecto: última ejecución al reabrir el panel |
| `agent-runs` | `GET …/org/proyecto/ai-runs/:runId` | Miembro autor | `agentRun` | Nuxt | Existe | E6.3a: estado, respuesta y propuesta |
| `agent-runs` | `POST …/org/proyecto/ai-runs/:runId/proposals/:proposalId/confirm` | Editor autor | `confirmAgentProposal` | Nuxt | Existe | E6.3a: solo la persona; prohibido al agente |
| `agent-runs` | `POST …/org/proyecto/ai-runs/:runId/proposals/:proposalId/reject` | Editor autor | `rejectAgentProposal` | Nuxt | Existe | E6.3a: solo la persona |
| `agent-runs` | `POST /internal/v1/agent-runs/:runId/operations/:name` | Credencial de la ejecución | — | Servicio de IA | HTTP | Pasarela interna del agente (A11) |
| `agent-runs` | `POST …/org/proyecto/ai-runs/:runId/cancel` | Editor autor | `cancelAgentRun` | Nuxt | Existe | E6.4: la credencial deja de valer al momento |
| `agent-runs` | `GET …/org/proyecto/ai-runs/:runId/events` | Miembro autor | — | Nuxt | HTTP | E6.4: SSE con `after` o `Last-Event-ID` |
| `integrations` | `GET …/org/proyecto/integrations/credentials` | Miembro | — | Nuxt | REST | Metadatos paginados, sin secretos |
| `integrations` | `POST …/org/proyecto/integrations/credentials` | Miembro | — | Nuxt | REST | Idempotencia y entrega puntual del secreto |
| `integrations` | `POST …/org/proyecto/integrations/credentials/:credentialId/revoke` | Titular o gestor de miembros | — | Nuxt | REST | Revocación de una credencial del proyecto |
| `integrations` | `GET …/org/proyecto/integrations/proposals/:proposalId` | Titular | — | Nuxt | REST | Revisión humana de una propuesta externa |
| `integrations` | `POST …/org/proyecto/integrations/proposals/:proposalId/confirm` | Editor titular o superior | — | Nuxt | REST | Confirmación humana con el hash revisado |
| `integrations` | `POST …/org/proyecto/integrations/proposals/:proposalId/reject` | Titular | — | Nuxt | REST | Rechazo humano con el hash revisado |
| `integrations` | `GET /integrations/session` | Credencial CLI | — | CLI | REST | Ámbito y capacidades |
| `integrations` | `GET /integrations/operations` | Credencial CLI | — | CLI | REST | Catálogo autorizado |
| `integrations` | `POST /integrations/operations/:name` | Credencial CLI | — | CLI | REST | Lecturas y propuestas |
| `integrations` | `GET /internal/v1/mcp-integrations/session` | Adaptador y delegación MCP | — | MCP | HTTP | Ámbito y capacidades vigentes |
| `integrations` | `GET /internal/v1/mcp-integrations/operations` | Adaptador y delegación MCP | — | MCP | HTTP | Catálogo filtrado de la credencial |
| `integrations` | `POST /internal/v1/mcp-integrations/operations/:name` | Adaptador y delegación MCP | — | MCP | HTTP | Lectura o preparación de propuesta |
| `evaluations` | `POST …/proyecto/evaluations` | Editor | `requestEvaluation` | Ambos | Añadir |  |
| `evaluations` | `POST …/proyecto/evaluations/preview` | Editor | `rulesPreview` (consulta) | Ambos | Añadir | No guarda nada: es una lectura |
| `evaluations` | `GET …/proyecto/evaluations` | Miembro | `Project.evaluations` | Ambos | Añadir |  |
| `evaluations` | `GET …/proyecto/evaluations/:evaluationId` | Miembro | `evaluation` | Ambos | Existe (piloto) |  |
| `evaluations` | `GET …/proyecto/evaluations/:evaluationId/rows` | Miembro | `Evaluation.rows` | Ambos | Añadir | Campo paginado: resumen y filas en una llamada |
| `evaluations` | `GET …/proyecto/evaluations/:evaluationId/attention` | Miembro | `Evaluation.attention` | Ambos | Existe (piloto) | Diagnóstico del feed en una llamada |
| `evaluations` | `GET …/proyecto/evaluations/:evaluationId/errors.csv` | Miembro | — | Nuxt | HTTP | Descarga de archivo |
| `exports` | `POST …/proyecto/exports` | Manager | `approveExport` | Nuxt | Añadir | Prohibido al agente (aprobar) |
| `exports` | `GET …/proyecto/exports/:exportId` | Miembro | `export` | Ambos | Añadir |  |
| `exports` | `GET …/proyecto/exports/:exportId/productos.tsv` | Miembro | — | Nuxt | HTTP | Descarga de archivo |
| `feed-refreshes` | `POST …/proyecto/feeds/:feedId/refreshes` | Editor | `requestFeedRefresh` | Nuxt | Añadir | Puede acabar publicando: prohibido al agente |
| `feed-refreshes` | `GET …/proyecto/feeds/:feedId/refreshes/:refreshId` | Miembro | `feedRefresh` | Ambos | Añadir |  |
| `feed-viewer` | `GET …/proyecto/exports/:exportId/products` | Miembro | `Export.products` | Ambos | Añadir | Visor |
| `feed-viewer` | `GET …/proyecto/exports/:exportId/product` | Miembro | `Export.product` | Ambos | Añadir | Ficha |
| `feed-viewer` | `GET …/proyecto/feeds/:feedId/versions/:versionId/products` | Miembro | `FeedVersion.products` | Ambos | Añadir | Visor |
| `feed-viewer` | `GET …/proyecto/feeds/:feedId/versions/:versionId/product` | Miembro | `FeedVersion.product` | Ambos | Añadir | Ficha |
| `feed-viewer` | `GET …/proyecto/feeds/:feedId/comparison` | Miembro | `Feed.comparison` | Ambos | Existe (piloto) | Diagnóstico del feed en una llamada |
| `feeds` | `GET /feeds/:file` | Token público | — | Canal | HTTP | URL pública del feed |
| `feeds` | `POST …/proyecto/feeds` | Manager | `createFeed` | Nuxt | Añadir | Devuelve la URL con el token una sola vez |
| `feeds` | `GET …/proyecto/feeds` | Miembro | `Project.feeds` | Ambos | Añadir |  |
| `feeds` | `GET …/proyecto/feeds/:feedId` | Miembro | `feed` | Ambos | Existe (piloto) |  |
| `feeds` | `GET …/proyecto/feeds/:feedId/delivery` | Miembro | `Feed.delivery` | Ambos | Existe (piloto) | Diagnóstico del feed en una llamada |
| `feeds` | `POST …/proyecto/feeds/:feedId/publications` | Manager | `publishFeed` | Nuxt | Añadir | Prohibido al agente (publicar) |
| `feeds` | `GET …/proyecto/feeds/:feedId/versions` | Miembro | `Feed.versions` | Ambos | Añadir |  |
| `feeds` | `PUT …/proyecto/feeds/:feedId/source` | Manager | `setFeedSource` | Nuxt | Añadir |  |
| `feeds` | `PUT …/proyecto/feeds/:feedId/schedule` | Manager | `setFeedSchedule` | Nuxt | Añadir |  |
| `feeds` | `PUT …/proyecto/feeds/:feedId/policy` | Manager | `approveFeedPolicy` | Nuxt | Añadir | Prohibido al agente (aprobar) |
| `feeds` | `POST …/proyecto/feeds/:feedId/delivery-token` | Manager | — | Nuxt | REST | Devuelve un secreto una sola vez; un botón, sin lectura compuesta |
| `feeds` | `DELETE …/proyecto/feeds/:feedId/delivery-token` | Manager | — | Nuxt | REST | Pareja de la anterior |
| `health` | `GET /health` | Ninguno | — | Operación | HTTP | Sonda de salud |
| `knowledge` | `GET …/proyecto/knowledge` | Miembro | `Project.knowledge` | Nuxt | Añadir |  |
| `knowledge` | `POST …/proyecto/knowledge/reindex` | Manager | `reindexKnowledge` | Nuxt | Añadir | Gasta llamadas a Google: prohibido al agente |
| `organizations` | `POST /organizations/:organizationId/invitations` | Admin | — | Nuxt | REST | Administración humana; pantalla ya hecha con REST |
| `organizations` | `GET /organizations/:organizationId/invitations` | Admin | — | Nuxt | REST | Ídem; lleva correos |
| `organizations` | `DELETE /organizations/:organizationId/invitations/:invitationId` | Admin | — | Nuxt | REST | Ídem |
| `organizations` | `POST /invitations/accept` | Sesión | — | Nuxt | REST | Ídem; token de un solo uso |
| `organizations` | `GET /organizations` | Sesión | — | Nuxt | REST | Pantalla ya hecha con REST; lectura simple |
| `organizations` | `POST /organizations` | Sesión | — | Nuxt | REST | Ídem |
| `organizations` | `GET /organizations/:organizationId` | Miembro | — | Nuxt | REST | Ídem |
| `organizations` | `POST /organizations/:organizationId/archive` | Owner | — | Nuxt | REST | Administración humana |
| `organizations` | `POST /organizations/:organizationId/restore` | Owner | — | Nuxt | REST | Ídem |
| `organizations` | `GET /organizations/:organizationId/members` | Miembro | — | Nuxt | REST | Lleva correos; el agente no los ve |
| `organizations` | `PATCH /organizations/:organizationId/members/:userId` | Admin | — | Nuxt | REST | Cambiar roles: prohibido al agente |
| `organizations` | `DELETE /organizations/:organizationId/members/:userId` | Admin | — | Nuxt | REST | Ídem |
| `projects` | `GET /organizations/:organizationId/projects` | Miembro | `organizationProjects` | Ambos | Añadir | Contexto: qué proyectos ve quien actúa |
| `projects` | `GET /projects/:id/access` | Miembro | `Project.access` | Ambos | Añadir | Campo del proyecto: rol y permisos, sin otra llamada |
| `projects` | `GET /projects` | Miembro | `projects` | Ambos | Existe |  |
| `projects` | `POST /projects` | Editor de la organización | `createProject` | Nuxt | Existe |  |
| `projects` | `GET /projects/:id` | Miembro | `project` | Ambos | Existe |  |
| `projects` | `PATCH /projects/:id` | Manager | `updateProject` | Nuxt | Existe |  |
| `rulesets` | `POST …/proyecto/rulesets` | Editor | `createRuleset` | Ambos | Añadir | Entrada `oneOf` por tipo de regla (N2) |
| `rulesets` | `GET …/proyecto/rulesets` | Miembro | `Project.rulesets` | Ambos | Añadir |  |
| `rulesets` | `GET …/proyecto/rulesets/:revision` | Miembro | `ruleset` | Ambos | Añadir |  |
| `users` | `GET /users/me` | Sesión | `me` | Ambos | Existe |  |
| `users` | `PUT /users/me` | Sesión | — | — | HTTP | Alta al iniciar sesión, antes de cualquier consulta |
| `users` | `PATCH /users/me` | Sesión | `updateMe` | Nuxt | Existe |  |
| `worksheet-catalog-snapshots` | `POST …/org/proyecto/worksheets/:worksheetId/catalog-snapshots` | Editor y propietario | `sendWorksheetToCatalog` | Ambos | Añadir |  |
| `worksheet-catalog-snapshots` | `GET …/org/proyecto/worksheet-catalog-snapshots/:snapshotId` | Miembro | `worksheetCatalogSnapshot` | Ambos | Añadir |  |
| `worksheet-exports` | `POST …/org/proyecto/worksheets/:worksheetId/exports` | Editor | `exportWorksheet` | Ambos | Añadir |  |
| `worksheet-exports` | `GET …/org/proyecto/worksheet-exports/:exportId` | Miembro | `worksheetExport` | Ambos | Añadir |  |
| `worksheet-exports` | `GET …/org/proyecto/worksheet-exports/:exportId/file` | Miembro | — | Nuxt | HTTP | Descarga de archivo |
| `worksheet-imports` | `POST …/org/proyecto/worksheets/:worksheetId/imports/preview` | Editor | — | Nuxt | HTTP | Subida multipart |
| `worksheet-imports` | `POST …/org/proyecto/worksheets/:worksheetId/imports` | Editor | — | Nuxt | HTTP | Subida multipart |
| `worksheet-imports` | `GET …/org/proyecto/worksheet-imports/:importId` | Miembro | `worksheetImport` | Ambos | Añadir |  |
| `worksheets` | `POST …/org/proyecto/workbooks` | Editor | `createWorkbook` | Ambos | Añadir |  |
| `worksheets` | `GET …/org/proyecto/workbooks` | Miembro | `Project.workbooks` | Ambos | Añadir |  |
| `worksheets` | `POST …/org/proyecto/workbooks/:workbookId/worksheets` | Editor | `createWorksheet` | Ambos | Añadir |  |
| `worksheets` | `GET …/org/proyecto/workbooks/:workbookId/worksheets` | Miembro | `Workbook.worksheets` | Ambos | Añadir | Libros con sus hojas en una llamada |
| `worksheets` | `GET …/org/proyecto/worksheets/:worksheetId` | Miembro | `worksheet` | Ambos | Existe (piloto) | Hoja con columnas y revisión |
| `worksheets` | `POST …/org/proyecto/worksheets/:worksheetId/rows/query` | Miembro | `Worksheet.rows` | Ambos | Existe (piloto) (sin filtro ni orden todavía) | Hoja, columnas y filas en una llamada |
| `worksheets` | `PATCH …/org/proyecto/workbooks/:workbookId` | Editor | `renameWorkbook` | Ambos | Añadir | H1 |
| `worksheets` | `POST …/org/proyecto/workbooks/:workbookId/archive` | Manager | `archiveWorkbook` | Nuxt | Añadir | H1; de Manager: prohibido al agente |
| `worksheets` | `POST …/org/proyecto/workbooks/:workbookId/restore` | Manager | `restoreWorkbook` | Nuxt | Añadir | Ídem |
| `worksheets` | `PATCH …/org/proyecto/worksheets/:worksheetId` | Editor | `renameWorksheet` | Ambos | Añadir | H1 |
| `worksheets` | `POST …/org/proyecto/worksheets/:worksheetId/archive` | Manager | `archiveWorksheet` | Nuxt | Añadir | H1; de Manager: prohibido al agente |
| `worksheets` | `POST …/org/proyecto/worksheets/:worksheetId/restore` | Manager | `restoreWorksheet` | Nuxt | Añadir | Ídem |
| `worksheets` | `POST …/org/proyecto/worksheets/:worksheetId/duplicate` | Editor | `duplicateWorksheet` | Ambos | Añadir | H1; crea una hoja nueva, no cambia la de origen |
| `worksheets` | `GET …/org/proyecto/worksheets/:worksheetId/revisions` | Miembro | `Worksheet.revisions` | Ambos | Añadir | H2; campo paginado de la hoja |
| `changesets` | `GET …/org/proyecto/worksheets/:worksheetId/changesets` | Miembro | `Worksheet.changesets` | Ambos | Añadir | H2 |
| `worksheet-imports` | `GET …/org/proyecto/worksheets/:worksheetId/imports` | Miembro | `Worksheet.imports` | Ambos | Añadir | H2 |
| `worksheet-exports` | `GET …/org/proyecto/worksheets/:worksheetId/exports` | Miembro | `Worksheet.exports` | Ambos | Añadir | H2 |
| `worksheet-imports` | `POST …/org/proyecto/worksheets/:worksheetId/import-mappings` | Editor | `createImportMapping` | Ambos | Añadir | H3 |
| `worksheet-imports` | `GET …/org/proyecto/worksheets/:worksheetId/import-mappings` | Miembro | `Worksheet.importMappings` | Ambos | Añadir | H3 |
| `worksheet-imports` | `GET …/org/proyecto/import-mappings/:mappingId` | Miembro | `importMapping` | Ambos | Añadir | H3 |
| `worksheet-imports` | `DELETE …/org/proyecto/import-mappings/:mappingId` | Editor | `deleteImportMapping` | Nuxt | Añadir | H3; prohibido al agente (borrar) |
| `worksheets` | `POST …/org/proyecto/worksheets/:worksheetId/saved-views` | Miembro o Editor | `saveView` | Ambos | Añadir | H4; `suggest_view` de 15 |
| `worksheets` | `GET …/org/proyecto/worksheets/:worksheetId/saved-views` | Miembro | `Worksheet.savedViews` | Ambos | Añadir | H4 |
| `worksheets` | `GET …/org/proyecto/saved-views/:viewId` | Quien la ve | `savedView` | Ambos | Añadir | H4 |
| `worksheets` | `PUT …/org/proyecto/saved-views/:viewId` | Autor o Manager | `replaceSavedView` | Ambos | Añadir | H4 |
| `worksheets` | `DELETE …/org/proyecto/saved-views/:viewId` | Autor o Manager | `deleteSavedView` | Nuxt | Añadir | H4; prohibido al agente (borrar) |
| `worksheet-catalog-snapshots` | `POST …/org/proyecto/workbooks/:workbookId/worksheets/from-catalog` | Editor | `openCatalogAsWorksheet` | Ambos | Añadir | H5; crea una hoja, no cambia el catálogo |
