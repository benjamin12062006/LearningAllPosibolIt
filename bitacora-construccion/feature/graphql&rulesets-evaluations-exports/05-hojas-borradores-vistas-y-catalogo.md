# 05 — C7.4: hojas, borradores, vistas y catálogo por GraphQL

Fecha de creación: 2026-11-14  
Estado: Implementado y verificado (2026-11-14). Sin commit.  
Relacionada con: [plan 02 de C7](../../../docs/plans/feature/graphql&rulesets-evaluations-exports/02-plan-c7-implementar-graphql.md), [ficha 05, matriz](../../../docs/fonts/feature/graphql&rulesets-evaluations-exports/05-inventario-y-alcance-de-c7.md), [bitácora 04, C7.3](04-feeds-y-conocimiento.md), [bitácoras de hojas H1–H5](../worksheets/08-abrir-un-catalogo-como-hoja.md).  
Revisión de partida: `feature/cierre-backend` `fb32457` más C7.1–C7.3 sin commit.

## Necesidad

La hoja propia (lo de antes del CSV) es donde más trabaja el agente: leer filas, proponer cambios, sugerir vistas. Faltaban por GraphQL ≈40 operaciones: libros, hojas, borradores con todo su ciclo, importaciones, exportaciones, plantillas, vistas y el puente con el catálogo.

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| Todas estas rutas llevan `organizationId` y `projectId` | Un solo ayudante para los ids: `@IdArg('worksheetId')`, con el mismo `INVALID_UUID` que REST | [`id-args.ts`](../../../src/graphql/common/id-args.ts) |
| REST devuelve `{ worksheet, capabilities }` | `capabilities` es un campo de `Worksheet`; las mutaciones devuelven la hoja (G8) | [`worksheets.resolver.ts`](../../../src/graphql/worksheets/worksheets.resolver.ts) |
| Lo que cuelga de una hoja vive en cinco módulos | Un resolver de campos de `Worksheet` con sus servicios: `changesets`, `imports`, `exports`, `importMappings`, `savedViews` (más `revisions` en el de hojas) | [`worksheet-history.resolver.ts`](../../../src/graphql/worksheets/worksheet-history.resolver.ts) |
| El filtro de filas, las operaciones, la plantilla y la consulta de una vista ya tienen analizador | Entran como `JSONObject`; el orden es `[SortTermInput]` y lo convierte el mismo DTO (`@Type`) | `WorksheetRowsArgs`, `SaveOperationsInput`, `CreateImportMappingInput`, `SaveViewInput` |
| REST pide la versión del borrador en `If-Match` y la idempotencia en `Idempotency-Key` | Son campos de la entrada (`draftVersion`, `idempotencyKey`); el resolver los pasa al servicio con la forma de la cabecera, así los errores son los de REST | [`changesets.resolver.ts`](../../../src/graphql/changesets/changesets.resolver.ts) |
| Mandar una hoja al catálogo usa el `requestId` de la petición | El resolver lo toma del contexto (`req.requestId`) | [`worksheet-catalog-snapshots.resolver.ts`](../../../src/graphql/worksheet-catalog-snapshots/worksheet-catalog-snapshots.resolver.ts) |
| Las columnas de una hoja nueva tienen DTO anidado | `CreateWorksheetInput` hereda de `CreateWorksheetDto` y sus columnas de `ColumnDefinitionDto`: el `ValidationPipe` global valida igual que REST (`columns.0.type`) | [`worksheets.graphql.ts`](../../../src/graphql/worksheets/worksheets.graphql.ts) |

## Ajustes al escribir el código

- **Profundidad de 6 a 8.** Desde C7.2 cada lista es una página (`items`), que suma un nivel. Con 6 no cabían lecturas previstas en la matriz: «libros con sus hojas» (`project → workbooks → items → worksheets → items → headRevision → sequence`, 7 niveles) ni la procedencia de una versión del feed. Con el límite de coste acotando el tamaño, se subió a 8 (`GRAPHQL_MAX_DEPTH`) y se añadió una prueba E2E: 7 niveles pasan y 9 se rechazan con 400. Anotado en el plan (G3).
- **El coste frena lo que debe.** Los libros con sus hojas y los límites por defecto (20 × 20) cuestan 2.161; la prueba y las operaciones de Nuxt piden límites (`workbooks(limit: 5)`), como hará un cliente.
- **Exportaciones de servicios.** `ChangesetsModule`, `WorksheetImportsModule`, `WorksheetExportsModule` y `WorksheetCatalogSnapshotsModule` exportan sus servicios, y `WorksheetsModule` también `SavedViewsService`.
- La propuesta de revertir queda en `draft`, no en `open`: la prueba se corrigió al estado real.

## Comprobaciones realmente ejecutadas (2026-11-14)

- **Pruebas:** 8 E2E en [`worksheets-flow.e2e-spec.ts`](../../../test/features/graphql/worksheets-flow.e2e-spec.ts): **crear libro y hoja → borrador → enviar → aceptar → aplicar por GraphQL**, igual que REST (hoja, diff, borrador aplicado, filas con orden, columnas y filtro, libros con sus hojas y sin las archivadas), y aplicar dos veces con la misma clave; vista guardada usada en las filas, exportación con filtro y descarga, plantilla, historial (revisiones, borradores con filtro de estado, exportaciones, plantillas y vistas) y borrados; llevar la hoja al catálogo y abrir el catálogo como hoja nueva; renombrar, duplicar, archivar (con el 409 de REST), restaurar, libros y proponer revertir; rebase de un borrador atrasado; profundidad 7 y 9; errores con los mismos campos que REST (columnas, versión del borrador, operaciones, clave de idempotencia, filtro, vista, borrador inexistente); permisos (otra organización, Viewer, Editor que no archiva, sin sesión).
- **Defectos a propósito:** **13 de 13 detectados.**

  | Id | Defecto | Detectado |
  | --- | --- | --- |
  | C74-1 | Capacidades de otro rol | Sí |
  | C74-2 | Filas sin la consulta | Sí |
  | C74-3 | Guardar con otra versión | Sí |
  | C74-4 | Aplicar sin la clave de idempotencia | Sí |
  | C74-5 | Hojas del libro sin filtro | Sí |
  | C74-6 | Borradores de la hoja sin filtro | Sí |
  | C74-7 | Las vistas de la hoja son las plantillas | Sí |
  | C74-8 | Borrar la vista no borra | Sí |
  | C74-9 | Borrar la plantilla no borra | Sí |
  | C74-10 | Exportar sin filtro | Sí |
  | C74-11 | Profundidad 6 | Sí |
  | C74-12 | Profundidad 9 | Sí |
  | C74-13 | Libros del proyecto sin ámbito | Sí |

  Antes de lanzarlos se añadieron dos comprobaciones (filtro por estado de los borradores y hojas archivadas del libro), porque sin ellas C74-5 y C74-6 no se habrían notado.

## Consecuencias

- El agente puede leer una hoja, proponer un cambio (crear, guardar, enviar) y sugerir una vista solo por GraphQL. Aceptar y aplicar siguen siendo de la persona.
- La subida de archivos de importación sigue en REST (multipart, ficha 05).
