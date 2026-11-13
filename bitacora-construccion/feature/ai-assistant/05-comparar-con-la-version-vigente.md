# 05 — V4: comparar una exportación con la versión vigente del feed

Fecha de creación: 2026-11-12  
Estado: Implementado y verificado (2026-11-12). Sin commit.  
Relacionada con: [plan 02 de cierre](../../../docs/plans/feature/cierre-backend/02-plan-terminar-hojas-visor-y-agente.md) (P5), [fuentes 04](../../../docs/fonts/feature/cierre-backend/04-fuentes-de-terminar-hojas-visor-y-agente.md) (E4, H5), [bitácora 04, V3](04-requiere-atencion.md), [22, visor y diagnóstico](../../../../docs-diagrams/22-visor-y-diagnostico-del-feed.md).  
Revisión de partida: `feature/cierre-backend` `b219b30` más los cambios sin commit.

## Necesidad

Antes de publicar, la persona necesita saber qué va a cambiar en el canal: «30 productos cambiaron de precio», qué entra, qué sale y qué sigue igual. Hasta ahora solo podía publicar y mirar después. La comparación tiene que ser de solo lectura: mientras se revisa, la URL pública sigue sirviendo la versión vigente.

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| H5: comparar las filas por ID | Función pura que recibe las dos tablas y devuelve recuentos, campos cambiados y la lista de cambios | `compareProducts` en [`tsv-comparison.ts`](../../../src/feed-viewer/tsv-comparison.ts) |
| Un catálogo tiene como mucho 5.000 filas (`IMPORT_LIMITS.rows`) | Leer los dos TSV enteros en memoria; no hace falta un algoritmo por lotes | `readAllProducts` en [`tsv-page.ts`](../../../src/feed-viewer/tsv-page.ts) |
| Cambiar las reglas puede añadir o quitar una columna | Se comparan las columnas de los dos archivos; `null` es «ese archivo no tiene la columna» y no es lo mismo que vacío | `comparedFields`, `changedFieldsOf` |
| E4: los dueños de los archivos ya resuelven el acceso | El visor no comprueba permisos: usa `FeedsService.findOne`, `openVersionFile` y `ExportsService.findOne`, `openDownload` | `FeedViewerService.compareWithPublished` en [`feed-viewer.service.ts`](../../../src/feed-viewer/feed-viewer.service.ts) |
| 22: «12 quedarían fuera por falta de imagen» sale de la evaluación del catálogo nuevo | La comparación no repite ese diagnóstico: devuelve el `evaluationId` del candidato para abrir «Requiere atención» (V3) | `FeedComparison.candidate` |

## Contrato

```http
GET /api/v1/projects/:projectId/feeds/:feedId/comparison?exportId=…&change=modified&limit=20&offset=0
```

```json
{
  "comparison": {
    "candidate": { "id": "…", "evaluationId": "…", "rowCount": 4, "createdAt": "…" },
    "published": { "id": "…", "exportId": "…", "rowCount": 4, "publishedAt": "…" },
    "counts": { "added": 1, "removed": 1, "modified": 2, "unchanged": 1 },
    "changedFields": [{ "field": "availability", "productCount": 1 }, { "field": "price", "productCount": 1 }],
    "changes": [
      { "id": "SKU-2", "change": "modified", "fields": [{ "field": "price", "before": "20.00 USD", "after": "25.00 USD" }] },
      { "id": "SKU-5", "change": "added", "fields": [] },
      { "id": "SKU-3", "change": "removed", "fields": [] }
    ],
    "page": { "limit": 20, "offset": 0, "hasMore": false }
  }
}
```

- `counts` y `changedFields` son del archivo entero; `changes` es la página pedida, opcionalmente de un solo tipo (`change=added|removed|modified`).
- Los cambios van en el orden del candidato y, al final, los retirados.
- De un añadido o un retirado no se listan campos: se ven enteros en su ficha (V2).

| Caso | Respuesta |
| --- | --- |
| Feed o exportación que no existe o es de otra organización | 404 (`FEED_NOT_FOUND`, `EXPORT_NOT_FOUND`) |
| El feed no tiene versión publicada | 409 `FEED_NOT_PUBLISHED` |
| Sin `exportId`, mal formado, o `change` desconocido | 400 |
| Falta el archivo de alguno de los dos | 503, como en el visor |
| Cualquier miembro (Viewer) | 200 |

## Ajustes al escribir el código

- **Primero lo ajeno, después el estado.** Se comprueba el feed y la exportación (404) antes de mirar si hay versión publicada (409): así alguien de otra organización nunca aprende, por el 409, que un feed existe o que no ha publicado.
- El `id` distingue mayúsculas, como en la ficha y en el canal.
- El orden de las filas no es un cambio.

## Comprobaciones realmente ejecutadas (2026-11-12)

- **Pruebas del visor:** 56 de 56 (antes 40). Nuevas: 8 unitarias en [`tsv-comparison.spec.ts`](../../../test/features/feed-viewer/tsv-comparison.spec.ts) (iguales, los cuatro tipos por id, recuento por campo, el orden no cuenta, columna solo en un archivo, vacío frente a ausente, mayúsculas, archivo sin productos) y 8 E2E (qué se añade, se retira y cambia, con un producto inválido que no cuenta como añadido; filtro y paginación con recuentos del archivo entero; comparar no publica y la URL pública sigue sirviendo la versión vigente; la exportación ya publicada no tiene cambios; sin publicar 409; validación; 404; Viewer sí, otra organización no, ni siquiera con su propio feed).
- **Defectos a propósito:** **13 de 13 detectados.**

  | Id | Defecto | Detectado |
  | --- | --- | --- |
  | V4-1 | Comparar solo las columnas del candidato | Sí |
  | V4-2 | Columna ausente tratada como vacía | Sí |
  | V4-3 | No detectar los retirados | Sí |
  | V4-4 | No contar los iguales | Sí |
  | V4-5 | Campos cambiados sin orden estable | Sí |
  | V4-6 | `id` sin distinguir mayúsculas | Sí |
  | V4-7 | Filtro de tipo de cambio ignorado | Sí |
  | V4-8 | Página sin la fila de más (`hasMore`) | Sí |
  | V4-9 | Sin publicar responde como feed ajeno | Sí |
  | V4-10 | Candidato y publicado intercambiados | Sí |
  | V4-11 | Leer solo el principio del archivo | Sí |
  | V4-12 | `exportId` sin validar | Sí |
  | V4-13 | Recuentos de la página y no del archivo | Sí |

- **`tsc`, `pnpm lint` y Prettier:** limpios.
- **Batería completa:** 100 suites pasan (1 saltada) y 1.632 pruebas (5 saltadas).
- **Arranque real:** la ruta responde 401 sin sesión y 404 `EXPORT_NOT_FOUND` con sesión; sin errores registrados.
- Sin migraciones: el esquema no cambia.

## Consecuencias

- La pantalla «Comparación antes de publicar» de 22 tiene su mitad de archivos. La otra mitad, comparar reglas sobre el mismo catálogo, es V5.
- No se midió con un catálogo de 5.000 filas; el límite de filas lo garantiza la importación y la comparación es lineal. Queda anotado para medirlo junto con la importación máxima contra Cloud SQL.
