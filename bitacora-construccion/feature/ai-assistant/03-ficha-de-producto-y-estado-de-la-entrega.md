# 03 — V2: ficha de producto y estado de la entrega

Fecha de creación: 2026-11-12  
Estado: Implementado y verificado (2026-11-12). Sin commit.  
Relacionada con: [plan 02 de cierre](../../../docs/plans/feature/cierre-backend/02-plan-terminar-hojas-visor-y-agente.md) (P2, P3), [fuentes 04](../../../docs/fonts/feature/cierre-backend/04-fuentes-de-terminar-hojas-visor-y-agente.md) (E4, H3, H7), [bitácora 01, V1](01-visor-del-feed.md), [22, visor y diagnóstico](../../../../docs-diagrams/22-visor-y-diagnostico-del-feed.md).  
Revisión de partida: `feature/cierre-backend` `b219b30` más los cambios sin commit.

## Necesidad

V1 enseña la tabla de productos de un TSV. El documento 22 pide dos cosas más para trabajar «después del TSV» dentro de la app:

1. Abrir la **ficha** de un producto con todos sus atributos y saber de qué exportación o versión del feed sale.
2. Que la pantalla pueda **explicar** por qué el feed no entrega: la URL pública responde el mismo 404 a todos los «no» para no dar pistas a quien no tiene sesión.

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| E4: el visor solo lee páginas; buscar por texto no garantiza un producto | Buscar por `id` **exacto** en el mismo archivo y dejar de leer al encontrarlo | `findTsvProduct` en [`tsv-page.ts`](../../../src/feed-viewer/tsv-page.ts) |
| La página y la ficha recorren el archivo igual | Un solo recorrido (`scanProducts`) que usan las dos; el cierre del archivo queda en un sitio | `scanProducts`, `readTsvPage` |
| `ExportView` y `FeedVersionView` ya llevan la evaluación de origen | La ficha devuelve la procedencia con esas mismas vistas, sin tipos nuevos | `ProductSource` en [`feed-viewer.service.ts`](../../../src/feed-viewer/feed-viewer.service.ts); `FeedsService.findVersion` |
| Un SKU puede llevar barras, espacios o signos | El `id` va en la consulta (`?id=`), no en la ruta | `ProductQueryDto` en [`feed-viewer.dto.ts`](../../../src/feed-viewer/feed-viewer.dto.ts) |
| H7; `FeedDeliveryService` responde 404 a todo «no» (D7 de feeds) | Ruta con sesión que da el primer motivo, con la misma comprobación que la entrega | `FeedsService.deliveryStatus`, `deliveryBlockOf` en [`feeds.service.ts`](../../../src/feeds/feeds.service.ts) |

## Contrato

```http
GET /api/v1/projects/:projectId/exports/:exportId/product?id=SKU-42
GET /api/v1/projects/:projectId/feeds/:feedId/versions/:versionId/product?id=SKU-42
GET /api/v1/projects/:projectId/feeds/:feedId/delivery
```

Ficha (de una versión del feed):

```json
{
  "columns": ["id", "title", "description", "link", "image_link", "price", "availability", "brand"],
  "product": { "line": 5, "values": { "id": "SKU-42", "title": "…", "price": "25.00 USD" } },
  "source": {
    "kind": "feed_version",
    "feedId": "…",
    "version": {
      "id": "…", "exportId": "…", "evaluationId": "…", "rowCount": 10,
      "publishedBy": "operator", "publishedAt": "…", "current": true, "fileRetained": true
    }
  }
}
```

Desde una exportación, `source` es `{ "kind": "export", "export": { "id", "evaluationId", "rowCount", "createdAt", … } }`. `evaluationId` es la entrada a «Requiere atención» (V3); en una versión puede ser nulo si se borró su importación.

Estado de la entrega:

```json
{ "delivery": { "delivering": false, "reason": "delivery_disabled", "deliveryEnabled": false, "publishedVersion": { "id": "…" } } }
```

`reason`: `no_published_version`, `delivery_disabled`, `file_unavailable` o `null` si entrega. Nunca incluye el token.

| Caso | Respuesta |
| --- | --- |
| El producto no está en ese archivo (inválido, excluido u otra caja) | 404 `PRODUCT_NOT_FOUND` |
| Sin `id`, vacío, repetido o de más de 200 caracteres | 400 |
| Exportación, feed o versión que no existe o es de otra organización | 404 (`EXPORT_NOT_FOUND`, `FEED_NOT_FOUND`, `FEED_VERSION_NOT_FOUND`) |
| Versión cuyo archivo retiró la retención | 410 `FEED_VERSION_FILE_RETIRED` |
| Cualquier miembro (Viewer) | 200 |

## Ajustes al escribir el código

- **`id` en la consulta.** El plan decía `…/products/:productId`. Un SKU con `/` rompería la ruta; `…/product?id=` acepta cualquier carácter. Anotado en el plan (P2).
- **`file_unavailable` en lugar de `file_not_retained`.** La retención nunca retira el archivo de la versión vigente, así que el único caso real es que el archivo falte en el almacenamiento. Anotado en el plan (P3).
- **`readTsvPage` se reorganizó** para compartir el recorrido con la ficha. Su comportamiento no cambia: sus 21 pruebas de V1 pasan sin tocar, y el defecto V2-4 comprueba que sigue dejando de leer al llenar la página.
- El `id` distingue mayúsculas y no se recorta: es el identificador que recibe el canal.

## Comprobaciones realmente ejecutadas (2026-11-12)

- **Pruebas del visor:** 40 de 40 (antes 21). Nuevas: 6 unitarias de `findTsvProduct` (exacto, ni otra caja ni un trozo, signos, deja de leer y cierra el archivo, archivo vacío, línea dañada) y 13 E2E (ficha desde exportación y desde versión, producto inválido o excluido 404, `id` con barras y signos, validación, versión retenida que conserva su precio aunque se publique otra, 410 y 404, Viewer sí y otra organización no; entrega sin publicar, publicada con la URL pública sirviendo ese archivo, desactivada y reactivada, archivo ausente, acceso).
- **Defectos a propósito:** **14 de 14 detectados.**

  | Id | Defecto | Detectado |
  | --- | --- | --- |
  | V2-1 | `id` sin distinguir mayúsculas | Sí |
  | V2-2 | `id` por coincidencia parcial | Sí |
  | V2-3 | Seguir leyendo tras encontrar el producto | Sí |
  | V2-4 | La página lee el archivo entero | Sí |
  | V2-5 | Producto ausente con el código de la exportación | Sí |
  | V2-6 | `id` sin longitud máxima | Sí |
  | V2-7 | `id` vacío aceptado | Sí |
  | V2-8 | No mirar si la entrega está desactivada | Sí |
  | V2-9 | Motivo equivocado sin publicar | Sí |
  | V2-10 | No mirar si falta el archivo | Sí |
  | V2-11 | El estado de la entrega pide Manager | Sí |
  | V2-12 | Leer una versión pide Manager | Sí |
  | V2-13 | Decir siempre que entrega | Sí |
  | V2-14 | Procedencia de la versión alterada | Sí |

- **`tsc`, `pnpm lint` y Prettier:** limpios.
- **Batería completa:** 98 suites pasan (1 saltada) y 1.601 pruebas (5 saltadas).
- **Arranque real:** las tres rutas nuevas responden 401 sin sesión; con sesión, el estado de la entrega de un feed recién creado da `no_published_version`; apagado limpio y sin errores registrados.
- Sin migraciones: el esquema no cambia.

## Consecuencias

- La web puede abrir la ficha desde cada fila del visor y volver a la tabla (la búsqueda y la página son parámetros suyos).
- El panel «Entrega del feed» de 22 tiene de dónde sacar la explicación.
- Sigue V3: «Requiere atención», que parte del `evaluationId` de la procedencia.
