# Feed y Merchant Center

1. `pnpm run ktsu read get_feed_status` devuelve el feed del proyecto y su generación y versión actual. Si falta, prepara `create_feed`.
2. Guarda `{ "feedId": "<feedId>" }` en `feed.json`. Consulta `get_feed_configuration`, `get_feed_delivery_status` y `list_feed_versions` usando `--input feed.json`. Para ver productos, llama a `list_feed_products` con `feedId` y `versionId`, o con `exportId` para una exportación aprobada.
3. Para automatizar, prepara `set_feed_source` (URL pública HTTPS, columna de ID y separador), `approve_feed_policy` (revisión de reglas y límites) y `set_feed_schedule` (activación, hora y zona horaria). Relee el estado después de cada cambio. Cada escritura necesita el permiso que exige la API web.
4. Para actualizar ahora, prepara `refresh_feed` con el ID del feed. Toma `result.refresh.id` de la respuesta y consulta `get_feed_refresh` con `feedId` y `refreshId`. Comprueba el resultado final y si se publicó una versión.
5. Para publicar manualmente, usa `publish_feed` con una exportación aprobada. Para recuperar una versión histórica, usa `republish_feed_version` con el ID del feed y de la versión. Relee la versión vigente después.
6. Descarga una versión con `pnpm run ktsu feed download '<versionId>' --feed-id '<feedId>' --output ./feed.tsv`. La CLI conserva códigos como `FEED_FILE_UNAVAILABLE` cuando falta el TSV y `FEED_VERSION_FILE_RETIRED` cuando venció su retención.
7. `disable_feed_delivery` retira la URL pública. Para crear o rotar la URL, abre el enlace de `pnpm run ktsu feed delivery` en la cuenta web. Guarda la URL de entrega en el destino que usa Merchant Center.
