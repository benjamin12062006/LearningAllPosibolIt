# 14 — Consultar hoja e historial desde el chat

Fecha de creación: 2026-11-15  
Última actualización: 2026-11-15  
Estado: Implementado y verificado  
Ámbito: Nest, catálogo del agente (chat interno y MCP delegado). Etapa 1 del plan 09.  
Relacionada con: [plan del asistente general de hojas](../../../docs/plans/feature/ai-assistant/09-plan-asistente-general-de-hojas.md), [fuentes 11](../../../docs/fonts/feature/ai-assistant/11-fuentes-asistente-general-de-hojas.md), [bitácora del historial de la hoja](../worksheets/05-historial-de-la-hoja.md), [acceso MCP desde Nest](12-acceso-mcp-desde-nest.md).  
Revisión de partida: `32caecc` con el trabajo sin commit de E6.7 y del chat de proyecto (bitácoras 12 y 13).

## Necesidad

Desde un chat de proyecto, la persona quiere listar los borradores de una hoja concreta, abrir uno que ya existía y comparar dos revisiones con el recuento de filas añadidas, quitadas o editadas y las diferencias de esquema (plan 09, etapa 1). Antes de esta etapa, el catálogo solo listaba las hojas de un libro y leía el esquema vigente (ficha 11, E1 y E4).

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| E2, E4: la API ya lista libros, revisiones, borradores, importaciones y exportaciones por páginas, también de una hoja archivada. | D1: el chat reutiliza esos servicios con la identidad de la persona. | `list_workbooks` y `list_sheet_history` llaman a `WorksheetsService`, `ChangesetsService`, `WorksheetImportsService` y `WorksheetExportsService`. Los 404 y los permisos son los de REST. |
| E6: `ChangesetsService.review` da cambios, conflictos y problemas frente a la revisión vigente. | D2, D5: abrir un borrador muestra datos reales y dice cuánto se ve. | `open_changeset` devuelve el borrador sin sus operaciones (`operationCount`) y su revisión con totales y una muestra (`total`, `items`, `truncated`). Un borrador aplicado o cancelado no se revisa; su resultado es `appliedRevisionId`. |
| E4: comparar dos revisiones cualesquiera es distinto de revisar un borrador. Las filas se guardan como versiones `[from, to)` por número de revisión (E3.2). | D2: el cálculo se hace en Nest sobre todo el conjunto. | `findRowsChangedBetween` busca las filas con una versión nueva en el tramo y lee su estado en cada extremo. `revision-comparison.ts` clasifica altas, bajas y ediciones y compara los esquemas por ID de columna. |
| E3: el lector ya lee filas de una revisión antigua, pero el esquema del agente era solo el vigente. | D2: el alcance usa la revisión pedida. | `get_sheet_schema` acepta `revisionId` y devuelve las columnas de esa revisión (`WorksheetRowsService.revisionSchema`). |
| [Bitácora 12](12-acceso-mcp-desde-nest.md) e `integration-gateway.service.ts`: el MCP externo solo recibe las operaciones de una lista. | D1: el cliente externo pide el ámbito de forma explícita. | Las cuatro lecturas entran en `DELEGATED_OPERATIONS`. Las que leen una hoja exigen `worksheetId`. |
| C1 (lección 74 de *NestJS API Profesional*): filtros enlazados y resultados paginados. | Las listas del agente son más cortas que las de REST. | `AGENT_PAGE`: 20 por defecto, 50 como máximo. La salida de cada herramienta en FastAPI se corta a 16.000 caracteres. |

## Contrato

Todas son lecturas con permiso `organization.read`, así que un Viewer también las tiene.

| Operación | Entrada | Salida |
| --- | --- | --- |
| `list_workbooks` | `archived?`, `limit?` (1–50), `offset?` | `{ workbooks: [{ id, name, archived, createdAt }], page }` |
| `list_sheet_history` | `worksheetId?`, `kind` (`revisions`, `changesets`, `imports` o `exports`), `status?` (solo con `changesets`), `limit?`, `offset?` | `{ worksheetId, kind, items, page }`, con los mismos elementos que REST |
| `open_changeset` | `changesetId`, `limit?` | `{ worksheetId, changeset, review }`. `review` es `null` en un borrador aplicado o cancelado. |
| `compare_revisions` | `worksheetId?`, `fromRevisionId`, `toRevisionId?` (la vigente si falta), `limit?` | `{ worksheetId, from, to, columns: { added, removed, changed }, rows: { counts, items, truncated } }` |
| `get_sheet_schema` | se añade `revisionId?` | se añade `revision` (`null` sin `revisionId`) |

Una revisión de otra hoja responde `404 WORKSHEET_REVISION_NOT_FOUND`. Un borrador de otra organización, `404 CHANGESET_NOT_FOUND`. `status` con otra lista, 400.

## Ajustes al escribir el código

- **Sin ruta REST ni GraphQL en esta etapa.** La comparación vive en el servicio y la usan el chat y el MCP. La ruta y su fila en la matriz de C7 llegan con la pantalla de Nuxt (etapa 6). Así no se toca el esquema GraphQL, que tiene cambios sin commit de E6.7.
- **Qué celdas se comparan.** Solo las guardadas en las dos revisiones: una columna calculada no guarda celdas, y una columna nueva o quitada ya aparece en `columns`. Sin esta regla, añadir «Moneda» contaría cada fila como editada. Una celda sin clave equivale a `null`; el texto vacío no.
- **Una fila que cambia y vuelve a su valor no es una diferencia** entre las dos revisiones. Tampoco una que nace y se borra entre ellas.
- **Se puede comparar en los dos sentidos.** De la revisión 3 a la 1, lo añadido aparece como quitado.
- **`worksheetOf` se movió a `agent-operation.ts`** para que el catálogo y el nuevo archivo de operaciones compartan la misma regla.
- **El contexto del chat sigue sin el borrador abierto.** `open_changeset` recibe el ID, que sale de `list_sheet_history`. Llevar `changesetId` en el contexto queda para la etapa 2, que edita borradores existentes.

## Implementación

- [`revision-comparison.ts`](../../../src/worksheets/revision-comparison.ts): funciones puras para comparar esquemas y filas.
- [`WorksheetRowsRepository.findRowsChangedBetween`](../../../src/worksheets/worksheet-rows.repository.ts): una consulta con `changed` y dos `LEFT JOIN` a la versión viva en cada revisión.
- [`WorksheetRowsService`](../../../src/worksheets/worksheet-rows.service.ts): `revisionSchema` y `compareRevisions`.
- [`sheet-history-operations.ts`](../../../src/agent-runs/operations/sheet-history-operations.ts): las cuatro operaciones y sus entradas. El [catálogo](../../../src/agent-runs/operations/agent-operation-catalog.ts) las registra y amplía `get_sheet_schema`. `AgentRunsModule` importa `ChangesetsModule`, `WorksheetImportsModule` y `WorksheetExportsModule`.
- [`integration-gateway.service.ts`](../../../src/integrations/integration-gateway.service.ts): las cuatro lecturas en la lista del MCP delegado.

FastAPI no cambia: construye las herramientas con lo que le manda Nest.

## Comprobaciones realmente ejecutadas

| Comprobación | Resultado |
| --- | --- |
| `tsc --noEmit`, `pnpm lint`, `pnpm format:check` | Limpios. El único aviso de oxlint es previo (`catalog-rules-operations.ts:268`). |
| Pruebas nuevas: [`revision-comparison.spec.ts`](../../../test/features/worksheets/revision-comparison.spec.ts) (4) y [`sheet-history-operations.e2e-spec.ts`](../../../test/features/agent-runs/sheet-history-operations.e2e-spec.ts) (6) | 10/10. La E2E usa PGlite, dos organizaciones, un Viewer, una hoja ajena del mismo proyecto y un borrador aplicado por REST con cambios de esquema. |
| Prueba añadida al final de [`integrations.e2e-spec.ts`](../../../test/features/integrations/integrations.e2e-spec.ts) | Pasa. El catálogo MCP ofrece las cuatro lecturas, exige `worksheetId`, lee y da 404 a la hoja de otro proyecto. Con `agent-runs`: 3 suites, 33 pruebas pasadas y 1 omitida. |
| Batería completa (`pnpm test:features`) | 1.951 pasadas, 7 omitidas y **2 fallos previos ajenos a esta etapa**: `projects.repository.int-spec` espera 41 migraciones y el repositorio tiene 42; la matriz de C7 no tiene `GET …/conversations/:conversationId/runs/latest`, ruta del chat de proyecto (bitácora 13). Esta etapa no añade migraciones ni rutas. |
| Defectos a propósito en una copia | **10 de 10 detectados** (tabla abajo). Uno no compilaba en su primera versión; se reescribió y se repitió la tanda completa. |
| Arranque real | El Nest local (`nest start --watch`, Cloud SQL por el proxy) recargó el código. Con el MCP `ktsu` instalado en Claude Code: el catálogo pasa de 14 a 18 herramientas, `list_workbooks` y `list_sheet_history` (revisiones y borradores) leen el proyecto «Prueba», `open_changeset` abre el borrador «Revertir la revisión 2» con su revisión, y `compare_revisions` entre las revisiones 1 y 2 devuelve 1 fila editada (`59.99 USD` → `59.99 BOL`) y ningún cambio de esquema. |

No se ejecutaron `pnpm db:verify` ni el esquema frente a migraciones: esta etapa no toca la base.

| Defecto | Detectado por |
| --- | --- |
| Las filas borradas cuentan como vivas | E2E de comparación |
| Ignora la última revisión del tramo | E2E de comparación |
| Una celda sin clave deja de valer `null` | Unitaria |
| Compara columnas que no estaban en la revisión de origen | Unitaria |
| Acepta `status` en cualquier lista | E2E, 400 |
| Revisa también un borrador aplicado | E2E de `open_changeset` |
| La muestra no se corta con `limit` | E2E, `truncated` |
| Ignora `toRevisionId` | E2E de comparación |
| `get_sheet_schema` lee siempre el esquema vigente | E2E del esquema y del 404 de revisión ajena |
| El MCP no exige la hoja al comparar | E2E de integraciones |

## Consecuencias

- La etapa 1 del plan 09 queda cubierta en Nest, en el chat interno y en el MCP. Su criterio de aceptación (listar borradores de una hoja, abrir uno existente y comparar dos revisiones con recuentos y esquema) se comprobó con datos sintéticos y con el proyecto local real.
- La revisión 2 del proyecto «Prueba» guarda `BOL`, no `BOB`. Corresponde al caso 4 del plan (cambio de sufijo de moneda), que se construye en la etapa 2.
- Pendiente para la etapa 2: `changesetId` en el contexto del chat y la búsqueda y reemplazo por fragmento o sufijo.
- Pendiente para la etapa 6: la ruta REST o el campo GraphQL de la comparación, con su pantalla en Nuxt.
- Los dos fallos previos de la batería requieren su propia corrección: actualizar el recuento de migraciones y añadir la fila de `runs/latest` a la matriz de C7.
