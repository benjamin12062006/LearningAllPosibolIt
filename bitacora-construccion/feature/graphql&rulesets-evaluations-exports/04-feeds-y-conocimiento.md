# 04 — C7.3: feeds y conocimiento por GraphQL

Fecha de creación: 2026-11-14  
Estado: Implementado y verificado (2026-11-14). Sin commit.  
Relacionada con: [plan 02 de C7](../../../docs/plans/feature/graphql&rulesets-evaluations-exports/02-plan-c7-implementar-graphql.md), [ficha 05, matriz](../../../docs/fonts/feature/graphql&rulesets-evaluations-exports/05-inventario-y-alcance-de-c7.md), [bitácora 03, C7.2](03-proyecto-reglas-evaluaciones-y-exportaciones.md).  
Revisión de partida: `feature/cierre-backend` `fb32457` más C7.1–C7.2 sin commit.

## Necesidad

Después del TSV (documento 22) todo pasa por el feed: configurarlo, publicarlo, ver su historial y lo que recibe el canal, y actualizarlo solo. La web lo necesita en una pantalla; el agente, para explicar el estado.

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| `FeedView` ya lleva fuente, política, horario y última actualización | `Feed` gana `source`, `policy`, `schedule` y `lastRefresh`: el feed entero en una lectura | [`feeds.graphql.ts`](../../../src/graphql/feeds/feeds.graphql.ts) |
| REST publica con `201` (nueva) o `200` (ya era la publicada) | `publishFeed` devuelve `{ feed, published }` | [`feeds.resolver.ts`](../../../src/graphql/feeds/feeds.resolver.ts) |
| La URL de entrega lleva el token y solo se enseña al crear | `createFeed` devuelve `{ feed, deliveryUrl }` una vez; rotar o quitar el token sigue en REST (ficha 05) | `create` |
| El visor de una versión necesita su proyecto y su feed | Cada versión de `Feed.versions` lleva los dos; `FeedVersion.{products, product}` usan el mismo servicio que REST | [`feed-versions.resolver.ts`](../../../src/graphql/feeds/feed-versions.resolver.ts) |
| REST responde 202 al disparar una actualización | `requestFeedRefresh` devuelve la actualización en cola; `feedRefresh` la sigue | `requestRefresh`, `findRefresh` |
| El separador de la fuente tiene su error en REST (`DELIMITER_INVALID`) | Entra como texto, no como enumerado | `FeedSourceInput` |
| Reindexar gasta llamadas al servicio de IA | `reindexKnowledge` (Manager), con el mismo servicio | [`knowledge.resolver.ts`](../../../src/graphql/knowledge/knowledge.resolver.ts) |

## Ajustes al escribir el código

- **`FeedRefreshesModule` entra en la API GraphQL** y su trabajador arranca solo: las pruebas GraphQL lo paran (`FEED_REFRESH_OPTIONS`).
- **La profundidad 6 cortaba lecturas previstas.** `feed → versions → items → product → source → version → id` son 7 niveles, y C7.4 encontró otras (libros con sus hojas). Se subió a 8 en C7.4; ver la [bitácora 05](05-hojas-borradores-vistas-y-catalogo.md).

## Comprobaciones realmente ejecutadas (2026-11-14)

- **Pruebas:** 7 E2E en [`feeds-knowledge.e2e-spec.ts`](../../../test/features/graphql/feeds-knowledge.e2e-spec.ts): **crear, configurar y publicar por GraphQL deja el feed igual que REST y la URL pública entrega, sin sesión, los mismos bytes que el TSV aprobado**; publicar lo mismo dos veces; historial y visor de cada versión igual que REST, con la procedencia; actualización en cola, seguida y como `lastRefresh`, con los 409 de REST (sin política, otra activa); fuente, horario y política inválidos con los mismos campos que REST; revisión inexistente y generación vieja; reindexar sin servicio de IA; permisos (Editor no configura ni publica ni reindexa; otra organización 404; sin sesión).
- **Defectos a propósito:** **10 de 10 detectados.**

  | Id | Defecto | Detectado |
  | --- | --- | --- |
  | C73-1 | Publicar siempre dice publicado | Sí |
  | C73-2 | `createFeed` con otra URL de entrega | Sí |
  | C73-3 | `setFeedSource` no guarda | Sí |
  | C73-4 | Versiones sin página | Sí |
  | C73-5 | Versiones con otro feed | Sí |
  | C73-6 | Visor de versión sin página | Sí |
  | C73-7 | Procedencia de la versión equivocada | Sí |
  | C73-8 | Actualización pedida con otro estado | Sí |
  | C73-9 | `feedRefresh` de otro feed | Sí |
  | C73-10 | Reindexar sin el servicio | Sí |

## Consecuencias

- El diagnóstico del feed (bitácora 01) y su configuración caben en las mismas consultas.
- El token de entrega sigue teniendo un solo camino (REST), como decidió la ficha 05.
