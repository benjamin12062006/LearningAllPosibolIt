# Recorridos de herramientas

Todas las herramientas actúan sobre el proyecto de la sesión. El esquema de cada una es la fuente de los argumentos, tipos y campos obligatorios. Las escrituras devuelven una propuesta con `proposalId`, `summary` y `reviewPath`; nada cambia hasta que la persona la confirma en la web.

## Propuestas

`get_proposal_status` con `proposalId` devuelve `ready`, `confirming`, `confirmed`, `failed`, `rejected` o `expired`, y el resultado o el motivo del fallo. En `failed`, informa del código y del mensaje.

## Por área

| Área | ID de partida y recorrido |
| --- | --- |
| Proyecto | `get_project_overview` primero. `search_knowledge` busca en el contenido indexado del proyecto. |
| Hojas | `list_workbooks` → `list_worksheets` → `get_sheet_schema` → `query_rows`. Los filtros y ediciones usan IDs de columna de `get_sheet_schema`. Incluye historial (`list_sheet_history`), comparación (`compare_revisions`), duplicados (`find_duplicates`), selección y vista previa de transformaciones, además de crear, renombrar, archivar, restaurar y duplicar hojas. |
| Borradores | Lee con `open_changeset`. Prepara con `prepare_sheet_edits`, `submit_changeset`, `reopen_changeset`, `reject_changeset`, `rebase_changeset`, `apply_changeset`, `cancel_changeset` o `propose_revert` según el estado. Ante un conflicto, consulta historial y revisiones antes de preparar el rebase. |
| Vistas y mapeos | `list_saved_views` y `list_import_mappings` reciben `worksheetId`. Descubre la visibilidad y los IDs antes de `suggest_view`, `update_saved_view`, `delete_saved_view`, `create_import_mapping` o `delete_import_mapping`. |
| Catálogo | `list_catalog_imports` y `get_catalog_snapshot`. Prepara `open_catalog_as_worksheet`, `propose_catalog_from_sheet` (después de aplicar los cambios de la hoja) o `delete_catalog_import`. |
| Reglas y evaluaciones | `get_ruleset` → `preview_rules` → `create_ruleset` con la última revisión como base. `request_evaluation` con el snapshot y la revisión de reglas; después `get_evaluation_report` y `approve_export`. |

## Archivos

Un cliente MCP no escribe en el disco de la persona: el archivo vuelve en la respuesta como `{ fileName, contentType, encoding, bytes, content }`, con texto UTF-8 para CSV/TSV y base64 para XLSX, hasta 1 MiB.

| Herramienta | Archivo |
| --- | --- |
| `read_worksheet_export_file` | La exportación de hoja de una propuesta `export_worksheet` ya confirmada. |
| `read_catalog_export_file` | Una exportación aprobada (`exportId`). |
| `read_feed_version_file` | Una versión del feed (`feedId` y `versionId`). |

## Feed y Merchant Center

1. `get_feed_status` devuelve el feed del proyecto y su versión actual. Si no existe, prepara `create_feed`.
2. Con el `feedId`, consulta `get_feed_configuration`, `get_feed_delivery_status` y `list_feed_versions`. Para ver productos, `list_feed_products` con `feedId` y `versionId`, o con `exportId` para una exportación aprobada.
3. Para automatizar, prepara `set_feed_source`, `approve_feed_policy` y `set_feed_schedule`. Relee el estado después de cada confirmación.
4. Para actualizar ahora, prepara `refresh_feed`. Tras confirmar, toma el ID de la actualización de `get_proposal_status` y consulta `get_feed_refresh`.
5. Para publicar, `publish_feed` con una exportación aprobada; para recuperar una versión anterior, `republish_feed_version`.
6. `disable_feed_delivery` retira la URL pública. Crear o rotar la URL de entrega se hace en la web, en **Feed**.
