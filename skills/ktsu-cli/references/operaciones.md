# Leer, preparar y verificar

Los comandos se ejecutan desde `scripts/ktsu-cli`. Usa `--json` al consumir los resultados con otro programa. Cada archivo de argumentos contiene un objeto JSON. El esquema que devuelve `operations describe` es la fuente para los selectores, tipos y campos obligatorios.

```sh
pnpm run ktsu operations describe duplicate_worksheet
pnpm run ktsu prepare duplicate_worksheet --input duplicar.json
pnpm run ktsu proposals review '<proposalId>'
pnpm run ktsu proposals status '<proposalId>'
```

Abre `reviewUrl` y distingue los estados `ready`, `confirming`, `confirmed`, `failed`, `rejected` y `expired`. En `failed`, informa del código y del mensaje devueltos. `prepare` acepta `--call-id <uuid>` y lo devuelve en la respuesta. Para un intento incierto, usa el mismo UUID con los mismos argumentos y operación.

| Área | ID de partida y recorrido |
| --- | --- |
| Hojas | `list_workbooks` → `list_worksheets` → `get_sheet_schema` → `query_rows`. El catálogo incluye historial, comparación, selección y vista previa de transformaciones, además de creación, renombre, archivo, restauración y duplicación. |
| Borradores | Lee con `open_changeset`. Prepara con `prepare_sheet_edits`, `submit_changeset`, `reopen_changeset`, `reject_changeset`, `rebase_changeset`, `apply_changeset`, `cancel_changeset` o `propose_revert` según el resultado. Ante conflicto, consulta historial y revisiones antes de preparar el rebase. |
| Vistas y mapeos | `list_saved_views` y `list_import_mappings` reciben `worksheetId`. Descubre la visibilidad y los IDs antes de usar `suggest_view`, `update_saved_view`, `delete_saved_view`, `create_import_mapping` o `delete_import_mapping`. |
| Catálogo | `list_catalog_imports` y `get_catalog_snapshot`. Prepara `open_catalog_as_worksheet`, `propose_catalog_from_sheet` o `delete_catalog_import` con el snapshot o la hoja del proyecto. |
| Reglas y exportaciones | `get_ruleset`, `preview_rules`, `create_ruleset`, `request_evaluation`, `get_evaluation_report`, `approve_export`. `ktsu exports download <exportId> --output ./productos.tsv` obtiene el archivo autorizado. |
| Exportación de hojas | Prepara `export_worksheet` con `worksheetId` y formato CSV o XLSX. Tras confirmar, usa `ktsu proposals download <proposalId> --output ./hoja.csv` con el formato elegido. |
