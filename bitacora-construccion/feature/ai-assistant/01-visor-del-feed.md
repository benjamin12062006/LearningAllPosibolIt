# 01 — V1: visor del feed (lectura JSON del TSV)

Fecha de creación: 2026-11-09  
Última actualización: 2026-11-09  
Estado: Implementado y verificado (2026-11-09). Sin commit.  
Relacionada con: [plan E6](../../../docs/plans/feature/ai-assistant/01-plan-e6-ia-con-qdrant-y-llamaindex.md) (D1), [fuentes 01](../../../docs/fonts/feature/ai-assistant/01-fuentes-del-visor-qdrant-y-llamaindex.md).  
Revisión de partida: `feature/cierre-backend` `b219b30`.

## Necesidad

La web quiere su propio «Merchant Center»: ver dentro de la app los productos que salen en `productos.tsv` y en cada versión publicada del feed. Hoy solo se puede descargar el archivo entero.

## ¿Bastaba lo que ya había?

En parte. Para el diagnóstico, sí: `GET …/evaluations/:id/rows?outcome=valid|invalid|excluded` ya da cada producto con sus valores y sus problemas en es/en (E4 de la ficha). Para ver **lo que recibe el canal**, no: la evaluación puede borrarse con su importación (la versión del feed sigue, E3), y solo había descargas del archivo entero (E2). Por eso el visor lee el archivo.

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| E1: TSV propio, sin escapes, `\n`, mismo número de campos | Leer línea a línea con `split('\t')`; una línea distinta es un archivo dañado | [`tsv-page.ts`](../../../src/feed-viewer/tsv-page.ts) (`readTsvPage`) |
| E2, E3: solo descargas; la versión conserva su archivo | Dos rutas que leen el archivo real | [`feed-viewer.controller.ts`](../../../src/feed-viewer/feed-viewer.controller.ts) |
| E3: la retención retira archivos (`fileRetained: false`) | 410 `FEED_VERSION_FILE_RETIRED` | `FeedsService.openVersionFile`, `FeedsRepository.findVersionFile` |
| E5: el acceso lo resuelven los dueños | El visor no comprueba permisos: lo hacen `ExportsService.openDownload` y `FeedsService.openVersionFile` | [`feed-viewer.service.ts`](../../../src/feed-viewer/feed-viewer.service.ts) |

## Contrato

```http
GET /api/v1/projects/:projectId/exports/:exportId/products?limit=20&offset=0&search=zapatilla
GET /api/v1/projects/:projectId/feeds/:feedId/versions/:versionId/products?limit=20&offset=0&search=…
```

```json
{
  "columns": ["id", "brand", "title", "description", "link", "image_link", "price", "availability"],
  "products": [{ "line": 2, "values": { "id": "SKU-1", "title": "…", "image_link": "https://…", "price": "59.90 EUR" } }],
  "rowCount": 10,
  "page": { "limit": 20, "offset": 0, "hasMore": false }
}
```

- `line`: línea del TSV (la cabecera es la 1), para citarla.
- `rowCount`: productos del archivo entero, aunque haya búsqueda.
- `search`: se recorta; busca en `id` y `title` sin distinguir mayúsculas; máximo 150 caracteres.
- Errores: 401 sin sesión; 404 `EXPORT_NOT_FOUND`, `FEED_NOT_FOUND` o `FEED_VERSION_NOT_FOUND` (también lo ajeno); 410 `FEED_VERSION_FILE_RETIRED`; 503 `EXPORT_FILE_UNAVAILABLE` o `FEED_FILE_UNAVAILABLE`; 400 con la validación de siempre.
- Permiso: cualquier miembro del proyecto (`organization.read`).

## Ajustes al escribir el código

- **`ExportDownload` lleva ahora `rowCount`** (y `findFileByOwner` lee `row_count`): la descarga existente no lo usa y no cambia.
- **Un tipo con nombre en lugar de `Awaited<ReturnType<…>>`** en el servicio: `OpenedTsv`, que cumplen las dos descargas.
- **Prueba añadida antes de los defectos:** Bob pide una versión de Alice desde su propio feed (404 `FEED_VERSION_NOT_FOUND`); sin ella, quitar `AND v.feed_id = …` no se habría notado.
- **Códigos nuevos al final** de `error-codes.ts` y `messages.ts`.

## Comprobaciones realmente ejecutadas

2026-11-09.

- Unitarias [`tsv-page.spec.ts`](../../../test/features/feed-viewer/tsv-page.spec.ts) (8): columnas y celdas, paginación y `hasMore`, página exacta del final, búsqueda en id/título sin mayúsculas, búsqueda vacía, línea dañada, archivo vacío y que deja de leer y cierra el archivo con un flujo infinito.
- E2E [`feed-viewer.e2e-spec.ts`](../../../test/features/feed-viewer/feed-viewer.e2e-spec.ts) (13), con módulos, guard, DTO, PGlite y almacén reales: la respuesta es igual al `productos.tsv` descargado y leído a mano; paginación; búsqueda con espacios; validación (`limit` 0 y 101, `offset` −1, búsqueda de 151, parámetro desconocido); 404 de exportación inexistente y 400 de id no UUID; 503 sin archivo; versión publicada igual que su exportación; 410 al retirarse con `retainedFiles: 1`; 404 de versión y de feed inexistentes; 503 y registro `FEED_FILE_MISSING` sin archivo de versión; Bob no ve nada de Alice (ni desde su proyecto ni desde su propio feed); 401 sin sesión.
- `tsc`, `pnpm lint` y Prettier: limpios.
- **Suite completa** (PGlite, en serie): 94 suites y **1.543 pruebas**, 5 saltadas, 138 s.
- **Defectos a propósito** (copia limpia, uno cada vez, pruebas del visor, exportaciones y feeds):

  | Defecto | Resultado |
  | --- | --- |
  | `hasMore` siempre falso | Detectado (3) |
  | `offset` ignorado | Detectado (4) |
  | La búsqueda distingue mayúsculas | Detectado (2) |
  | La búsqueda mira todas las columnas | Detectado (1) |
  | Números de línea desplazados | Detectado (8) |
  | No cierra el archivo | Detectado (1) |
  | Para de leer una línea antes | Detectado (3) |
  | La versión no comprueba el feed del proyecto | Detectado (2) |
  | La versión se busca en cualquier feed | Detectado (1) |
  | Sin 410: no compila (la clave puede ser nula); variante que compila (`?? ''`) | Detectado por `tsc` y por la E2E (1) |
  | `rowCount` de la página en lugar del archivo | Detectado (2) |
  | Sin guard de sesión | Detectado (13) |
  | Sin recortar la búsqueda | Detectado (1) |
  | La exportación sin filtro de membresía | Detectado (2) |

  14 de 14.
- No se ejecutaron: arranque real de `AppModule` (necesita el proxy de Cloud SQL), `pnpm db:verify` ni el esquema frente a migraciones (no hay migración).

## Consecuencias

- La web puede montar el visor con estas dos rutas más las que ya existían: `GET …/feeds` (versión publicada), `GET …/feeds/:id/versions` (historial con `fileRetained`) y `GET …/evaluations/:id/rows` (diagnóstico).
- El agente de E6.3 usará la misma lectura en su herramienta `list_feed_products`.
