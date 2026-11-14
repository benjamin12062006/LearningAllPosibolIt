# 01 — Piloto de C7: dos lecturas compuestas por GraphQL, medidas contra REST

Fecha de creación: 2026-11-13  
Estado: Implementado y verificado (2026-11-13). Sin commit. Es la evaluación de C7, no su cierre: la cobertura amplia sigue pendiente.  
Relacionada con: [ficha 05, inventario y alcance](../../../docs/fonts/feature/graphql&rulesets-evaluations-exports/05-inventario-y-alcance-de-c7.md), [23, plan C7](../../../../docs-diagrams/23-graphql-nest-para-fastapi-y-nuxt.md), [plan 02 de cierre](../../../docs/plans/feature/cierre-backend/02-plan-terminar-hojas-visor-y-agente.md).  
Revisión de partida: `feature/cierre-backend` `3733be4` más V5 sin commit.

## Necesidad

El plan 23 pide medir antes de ampliar GraphQL: elegir dos lecturas compuestas y una de control, y comparar con REST llamadas, bytes, latencia y consultas SQL con los mismos datos, permisos y página.

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| Ficha 05: la hoja son 2 llamadas REST y el diagnóstico, 4 | Exponer lo que cuelga de un recurso como campo suyo | `Worksheet.rows`, `Feed.delivery`, `Feed.comparison`, `Evaluation.attention` |
| El GraphQL existente reutiliza los servicios de REST (proyectos, importaciones) | Los resolvers nuevos llaman a los mismos servicios; ninguno toca un repositorio | [`worksheets.resolver.ts`](../../../src/graphql/worksheets/worksheets.resolver.ts), [`feeds.resolver.ts`](../../../src/graphql/feeds/feeds.resolver.ts), [`evaluations.resolver.ts`](../../../src/graphql/evaluations/evaluations.resolver.ts) |
| Un campo necesita saber de qué proyecto es su padre | La consulta raíz devuelve el recurso con su proyecto (o su organización y proyecto) | `ScopedWorksheet`, `ProjectFeed`, `ProjectEvaluation` |
| `GET …/evaluations/:id` trae además una muestra de 20 filas | GraphQL pide la evaluación sin muestra: las filas serán un campo aparte | `EvaluationsService.findSummary` |
| Los módulos solo exportaban repositorios o nada | Exportar los servicios que usa la capa GraphQL | `WorksheetsModule` (`WorksheetsService`, `WorksheetRowsService`) y `FeedViewerModule` (`FeedViewerService`) |

## Lo que se añadió al esquema

```graphql
type Query {
  worksheet(organizationId: ID!, projectId: ID!, id: ID!): Worksheet!
  feed(projectId: ID!, id: ID!): Feed!
  evaluation(projectId: ID!, id: ID!): Evaluation!
}
```

- `Worksheet { …, columns, headRevision, rows(limit, cursor, revisionId) }`
- `Feed { …, publishedVersion, delivery, comparison(exportId, change, limit, offset) }`
- `Evaluation { …, counts, attention { problemGroups, exclusionGroups } }`

El esquema esperado (`test/features/graphql/schema.expected.graphql`) crece 164 líneas.

## Ajustes al escribir el código

- **Los errores de un campo no pasaban por el filtro.** Nest no aplica filtros, guards ni interceptores a `@ResolveField` si no se pide. Un 409 lanzado desde `comparison` salía como `INTERNAL_ERROR`. Se añadió `fieldResolverEnhancers: ['filters']` en [`graphql-config.ts`](../../../src/graphql/graphql-config.ts). Los guards **no** se activan por campo: la consulta raíz ya validó la sesión y repetirlo sería una llamada al proveedor de identidad por cada campo.
- **Las filas por GraphQL admiten página, cursor y revisión**, no filtro ni orden: en REST son árboles y aquí necesitan un tipo de entrada. Queda para C7.
- La prueba de GraphQL que ya existía necesitó desactivar los procesos de fondo de los módulos nuevos (evaluaciones, exportaciones y feeds). Sus aserciones no cambian.

## Mediciones

Están en la [ficha 05](../../../docs/fonts/feature/graphql&rulesets-evaluations-exports/05-inventario-y-alcance-de-c7.md#piloto-y-mediciones-2026-11-13), con el método, los datos y los límites.

| Recorrido | Llamadas (REST → GraphQL) | Bytes | SQL | p50 (ms) |
| --- | --- | --- | --- | --- |
| Hoja con columnas y 100 filas | 2 → 1 | 33.646 → 33.457 | 9 → 9 | 5,6 → 5,1 |
| Diagnóstico del feed | 4 → 1 | 4.595 → 3.474 | 33 → 38 | 16,6 → 16,2 |
| Control: un proyecto | 1 → 1 | 209 → 219 | 3 → 3 | 1,1 → 1,3 |

GraphQL ahorra viajes HTTP, no trabajo del servidor, y en el diagnóstico hace 5 sentencias SQL más porque cada campo repite la comprobación de acceso.

## Comprobaciones realmente ejecutadas (2026-11-13)

- **Pruebas de GraphQL:** 26 de 26 (antes 19). Nuevas, 7 en [`pilot.e2e-spec.ts`](../../../test/features/graphql/pilot.e2e-spec.ts): la hoja por GraphQL da lo mismo que las dos rutas REST; el cursor lleva a la página siguiente; validación y 404 de lo ajeno; el diagnóstico da lo mismo que las cuatro rutas REST; la comparación admite tipo de cambio y página; sin versión publicada, el mismo `FEED_NOT_PUBLISHED`; otra organización 404 y sin sesión error de sesión.
- **Defectos a propósito:** **6 de 6 detectados.**

  | Id | Defecto | Detectado |
  | --- | --- | --- |
  | G-1 | Los errores de los campos no pasan por el filtro | Sí |
  | G-2 | Las filas ignoran la página pedida | Sí |
  | G-3 | Página de filas sin tope | Sí |
  | G-4 | La comparación ignora el tipo y la página | Sí, tras añadir la prueba de la comparación con argumentos |
  | G-5 | La hoja se devuelve con otro alcance | Sí |
  | G-6 | La atención es de otra evaluación | Sí |

- **`tsc`, `pnpm lint` y Prettier:** limpios.
- **Batería completa:** 103 suites pasan (1 saltada) y 1.669 pruebas (5 saltadas).
- **Arranque real:** por `/api/graphql`, el feed con su entrega en una llamada; sin sesión, `AUTH_SESSION_REQUIRED`; apagado limpio y sin errores registrados.
- Sin migraciones.

## No hecho

- La cobertura amplia de C7: quedan 47 rutas por tener equivalente (el piloto cubrió 7).
- La caché de acceso por petición y la nueva medición del diagnóstico.
- El límite de coste y de cantidad además de la profundidad 6.
- El experimento de `isOneOf` y la llamada autenticada desde Python.

## Consecuencias

- La evaluación de C7 que pide el plan 23 está hecha: matriz, alcance recomendado (64 de 88 rutas, 72,7 %) y mediciones.
- Lo construido en el piloto se queda: es la primera porción de C7.
