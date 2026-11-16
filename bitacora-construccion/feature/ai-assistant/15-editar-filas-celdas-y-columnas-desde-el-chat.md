# 15 — Editar filas, celdas y columnas desde el chat, y recorrido por MCP

Fecha de creación: 2026-11-15  
Última actualización: 2026-11-15  
Estado: Implementado y verificado  
Ámbito: Nest, catálogo del agente y MCP delegado. Etapa 2 del plan 09 y recorrido del flujo del proyecto con el MCP `ktsu`.  
Relacionada con: [plan 09](../../../docs/plans/feature/ai-assistant/09-plan-asistente-general-de-hojas.md), [fuentes 11](../../../docs/fonts/feature/ai-assistant/11-fuentes-asistente-general-de-hojas.md), [bitácora 14](14-consultar-hoja-e-historial-desde-el-chat.md).  
Revisión de partida: `32caecc` con la etapa 1 sin commit.

## Necesidad

El chat debe preparar cambios de filas, celdas y columnas en un borrador nuevo o en uno abierto, sin perder lo que ya tenía, y la persona los confirma. Dos casos concretos: cambiar el sufijo `USD` por `BOB` conservando el número (plan 09, caso 4) y borrar duplicados mostrando el criterio (caso 2). Después, el usuario pidió recorrer con el MCP todo el flujo del proyecto: Hojas, Catálogo, Reglas, Evaluaciones, Feed y Productos.

## Antes de empezar: dos fallos previos de la batería

- `projects.repository.int-spec.ts` esperaba 41 migraciones; el repositorio tiene 42 desde la de conversaciones de proyecto. Ahora espera 42.
- La matriz de C7 no tenía `GET …/conversations/:conversationId/runs/latest`. Se añadió como ruta solo REST (la web la lee al reabrir el panel) y `coverage.spec.ts` pasa a 140 rutas, 24 en REST.

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| E5: los borradores ya admiten celdas, filas y columnas, con `normalizeOperations` y sus validadores. | D3: el chat usa las mismas operaciones; Nest las valida como al guardar desde el editor. | `prepare_sheet_edits` (escritura, `worksheet.write`) recibe operaciones de borrador. `ChangesetsService.checkEdits` las valida sin escribir y `saveEdits` guarda lo confirmado. |
| E6 y D4: un borrador existente tiene versión; otro puede guardar mientras tanto. | Las nuevas van detrás de las del borrador y se validan juntas. Al confirmar se usa la versión que se vio. | Con `changesetId`, `checkEdits` normaliza `[...anteriores, ...nuevas]`. `saveEdits` guarda con `If-Match` de esa versión: 412 si otro guardó. Un borrador enviado da 409; uno de otra hoja, 404. |
| D4: un borrador nuevo nace sobre la revisión vigente. | Si la hoja avanzó entre preparar y confirmar, se prepara otra vez. | `saveEdits` compara el head con `baseRevisionId` del plan: 409 `CHANGESET_BASE_OUTDATED`. |
| E7: las transformaciones solo reemplazaban el valor completo. | Una operación genérica de fragmento, distinta de convertir moneda. | `replace_text { find, replace, match: contains, prefix o suffix }` en `worksheet-transform.ts`, solo en columnas de texto. La descripción al modelo dice que no convierte importes. |
| H3: quitar duplicados mostrando qué se conserva. | Criterio explícito y recorrido completo en Nest. | `find_duplicates` recorre la revisión por páginas en el orden de la hoja (`DuplicateFinder`). Devuelve el criterio (columnas, `exact` o `normalized`, `first` o `last`), los recuentos de toda la hoja y una muestra de grupos. Las filas sin clave no se agrupan. |
| Bitácora 12: el MCP solo recibe lo que está en su lista. | El MCP debe poder recorrer el flujo del proyecto con las mismas confirmaciones. | `DELEGATED_OPERATIONS` suma `prepare_sheet_edits`, `find_duplicates`, `get_catalog_snapshot`, `propose_catalog_from_sheet`, `create_ruleset`, `preview_rules` y `request_evaluation`. |

## Ajustes al escribir el código

- **Copiar o rellenar rangos no tiene operación propia.** El modelo los expresa con `set_cell` e `insert_row`; rellenar vacíos ya cabe en `replace_exact` con `from: null`.
- **Un cambio sin efecto cuenta como `noop`.** Vaciar una celda que ya estaba vacía aparece así en la revisión del borrador, igual que en el editor.
- **Las operaciones del agente tienen un máximo de 500**, por debajo de las 1.000 de un borrador, para que la tarjeta se pueda leer.
- **La selección por filtro sigue limitada a 200 filas** (`TRANSFORM_LIMITS`). `find_duplicates` sí recorre la hoja entera porque solo lee.

## Comprobaciones realmente ejecutadas

| Comprobación | Resultado |
| --- | --- |
| `tsc`, `pnpm lint`, `pnpm format:check` | Limpios; el aviso de oxlint es el previo de `catalog-rules-operations.ts`. |
| [`sheet-edit-operations.e2e-spec.ts`](../../../test/features/agent-runs/sheet-edit-operations.e2e-spec.ts) (8) y [`text-and-duplicates.spec.ts`](../../../test/features/worksheet-tools/text-and-duplicates.spec.ts) (4) | Pasan, junto con `worksheet-tools.e2e` y las de la etapa 1 (29 en total en esa tanda). |
| Batería completa | **1.965 pasadas, 7 omitidas, 0 fallos** (131 suites). La prueba del borrador de otra hoja se añadió después y se ejecutó en la tanda de defectos. |
| Defectos a propósito en una copia | **10 de 10 detectados**: sufijo buscado en cualquier sitio, borrador abierto que pierde sus cambios, borrador enviado aceptado, borrador de otra hoja aceptado, guardar sobre una revisión vieja, guardar con una versión que no se vio, regla de conservar al revés, normalizado sin quitar espacios, claves vacías agrupadas y Viewer con la edición. |

## Recorrido del flujo con el MCP `ktsu`

Proyecto «Prueba» (la credencial es de ese proyecto; el MCP no crea proyectos). Cliente MCP de Python contra `ktsu-mcp` por `stdio`, con Nest local y Cloud SQL. El catálogo MCP pasó de 14 a 25 herramientas.

| Sección | Qué hizo el MCP | Resultado |
| --- | --- | --- |
| Hojas | `get_project_overview`, `list_workbooks`, `list_worksheets`, `get_sheet_schema`, `query_rows` | Lee todo. «price» es texto con moneda mezclada (`59.99 BOL`, `34.90 USD`). |
| Hojas | `propose_sheet_layout` «Tienda Andina» | Propuesta lista para confirmar. |
| Hojas | `find_duplicates` por `id` y por `title` | 0 grupos: la hoja no tiene repetidos. |
| Hojas | `select_rows` (filtro, 30 filas) y dos `preview_transform` con `replace_text` sufijo | 29 cambios `… USD` → `… BOB` y 1 `59.99 BOL` → `59.99 BOB`, sin problemas. |
| Hojas | `create_change_proposal` (29) y `prepare_sheet_edits` (1) | Dos propuestas de borrador listas para confirmar. |
| Catálogo | `get_catalog_snapshot`, `propose_catalog_from_sheet` | Lee la importación (30 filas, `id` como identificador). Propone una importación nueva desde la hoja. |
| Reglas | `get_ruleset`, `preview_rules`, `create_ruleset` | La prueba sin publicar cambia el título de los 30 productos y confirma que el problema persiste: `PRICE_CURRENCY_MISMATCH` en 30. Propuesta de la revisión 3. |
| Evaluaciones | `get_evaluation_report`, `request_evaluation` | 30 de 30 inválidos por la moneda del precio. Propuesta de evaluación lista. El primer intento sin `rulesetRevision` dio 400, como debe. |
| Feed | `get_feed_status` | Sin versión publicada: `no_published_version`. |
| Productos | `list_feed_products`, `list_sheet_history` de exportaciones | No hay exportación aprobada ni versión publicada, así que no hay productos que listar. |
| Conocimiento | `search_knowledge` | Sin resultados: el índice no tiene este proyecto (el reconciliador o FastAPI no estaban indexando). |

**Lo que el MCP no hace, por diseño:** confirmar sus propuestas, enviar, aprobar o aplicar borradores, aprobar la exportación, crear o publicar el feed y crear proyectos. Son pasos de la persona en la web (`FORBIDDEN_OPERATIONS`). Las seis propuestas del recorrido esperan su confirmación en `/projects/df68e46b-8e43-4a32-8ed1-da5405e2273c/integrations/proposals/…`.

**Orden para terminar el flujo en la web:** confirmar los dos borradores de moneda, enviarlos, aprobarlos y aplicarlos. Después confirmar la importación desde la hoja y las reglas 3, evaluar ese catálogo nuevo (no el antiguo, que guarda los precios con `USD`), aprobar la exportación y publicar el feed. La propuesta de evaluación preparada apunta al catálogo antiguo y dará los mismos 30 inválidos; conviene rechazarla y pedir otra sobre la importación nueva.

## Consecuencias

- La etapa 2 del plan 09 queda cubierta en Nest, en el chat y en el MCP, con los criterios del plan: cambios validados como en el editor, borradores existentes conservados y duplicados con criterio visible.
- El MCP ya alcanza todas las secciones del proyecto: lee Hojas, Catálogo, Reglas, Evaluaciones, Feed y Productos, y prepara los cambios de Hojas, Catálogo, Reglas y Evaluaciones. Lo que queda en la web es lo que se dejó a propósito para la persona.
- En la hoja «probnado» sigue abierto el borrador «Revertir la revisión 2», que devolvería `59.99 BOB` a `USD`. Conviene cancelarlo al aplicar los de moneda.
- Pendiente: la etapa 3 (enviar, aprobar y aplicar guiados desde el chat), el índice de conocimiento de «Prueba» y una prueba E2E del MCP con `prepare_sheet_edits` y las herramientas de catálogo recién delegadas.
