# 05 — H2: el historial de una hoja

Fecha de creación: 2026-11-14  
Estado: Implementado y verificado (2026-11-14). Sin commit.  
Relacionada con: [plan 02 de cierre](../../../docs/plans/feature/cierre-backend/02-plan-terminar-hojas-visor-y-agente.md) (P9), [fuentes 04](../../../docs/fonts/feature/cierre-backend/04-fuentes-de-terminar-hojas-visor-y-agente.md) (E2), [bitácora 04, H1](04-renombrar-archivar-y-duplicar.md).  
Revisión de partida: `feature/cierre-backend` `fb32457`.

## Necesidad

Una hoja tenía revisiones, borradores, importaciones y exportaciones, pero solo se podía leer cada uno por su id. La visión pide «comparar con versiones anteriores» y «consultar quién hizo cada modificación» (4.2 y 24); sin listados, la web no puede enseñar el historial ni el agente saber qué se hizo.

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| Cada tabla tiene ya su módulo, su repositorio y su forma pública | Cada módulo lista lo suyo bajo la misma hoja: `GET …/worksheets/:id/{revisions,changesets,imports,exports}`, junto al `POST` que ya existía en esa ruta | [`worksheets`](../../../src/worksheets/worksheets.controller.ts), [`changesets`](../../../src/changesets/changesets.controller.ts), [`worksheet-imports`](../../../src/worksheet-imports/worksheet-imports.controller.ts), [`worksheet-exports`](../../../src/worksheet-exports/worksheet-exports.controller.ts) |
| Las tablas tienen índices por organización, hoja y fecha (y revisiones, por hoja y secuencia) | Orden de lo más nuevo a lo más antiguo, con `id` para desempatar, y la página de siempre (`limit + 1` para `hasMore`) | `findRevisions`, `findByWorksheet` en los cuatro repositorios |
| Un borrador puede tener mil operaciones y una importación miles de filas excluidas | Los listados devuelven un resumen: `operationCount` en lugar de `operations`, `excludedRowCount` en lugar de `excludedRows` | `ChangesetSummary`, `WorksheetImportSummary` |
| En el historial importa en qué quedó una importación | La importación lleva el estado de su borrador (`changesetStatus`) | `IMPORT_SUMMARY_COLUMNS` |
| Archivar permite leer (H1) | El historial de una hoja archivada se sigue leyendo | Sin comprobación de archivado en las lecturas |

Sin migración: solo lecturas sobre tablas e índices existentes. No se consultaron cursos: es el mismo patrón de listado paginado del resto de la API.

## Contrato

Bajo `P = /api/v1/organizations/:organizationId/projects/:projectId`, todas con `?limit=&offset=` y para cualquier miembro:

| Ruta | Respuesta |
| --- | --- |
| `GET P/worksheets/:id/revisions` | `{ revisions: [{ id, sequence, schemaVersion, source, rowCount, changesetId, createdBy, createdAt }], page }` |
| `GET P/worksheets/:id/changesets?status=` | `{ changesets: [borrador sin operations, con operationCount], page }` |
| `GET P/worksheets/:id/imports` | `{ imports: [importación sin excludedRows, con excludedRowCount y changesetStatus], page }` |
| `GET P/worksheets/:id/exports` | `{ exports: [lo mismo que al leer una exportación], page }` |

Una hoja que no existe responde 404 `WORKSHEET_NOT_FOUND`; un proyecto de otra organización, 404 (el código de cada módulo); un `status` desconocido, 400.

## Comprobaciones realmente ejecutadas (2026-11-14)

- **Pruebas:** 10 E2E en [`worksheet-history.e2e-spec.ts`](../../../test/features/worksheets/worksheet-history.e2e-spec.ts) con una hoja que recibe una importación CSV aplicada (revisión 2), un borrador abierto y una exportación: orden y origen de las revisiones; paginación; borradores sin operaciones y filtro por estado; el resumen coincide con el borrador leído entero; importación con su estado y sin filas excluidas; exportación igual que al leerla y sin la clave del archivo; un Viewer lee también el de una hoja archivada; otra organización, sin sesión, hoja inexistente y página inválida; lo de otra hoja no aparece.
- **Defectos a propósito:** **14 de 14 detectados.**

  | Id | Defecto | Detectado |
  | --- | --- | --- |
  | H2-1 | Revisiones de la más antigua a la más nueva | Sí |
  | H2-2 | Revisiones de todas las hojas | Sí |
  | H2-3 | Revisiones de una hoja que no existe | Sí |
  | H2-4 | Filtro de estado ignorado | Sí |
  | H2-5 | Borradores de todas las hojas | Sí |
  | H2-6 | El resumen lleva las operaciones | Sí |
  | H2-7 | Borradores de una hoja ajena o inexistente | Sí |
  | H2-8 | Estado del borrador equivocado | Sí |
  | H2-9 | Importaciones de todas las hojas | Sí |
  | H2-10 | El resumen lleva las filas excluidas | Sí |
  | H2-11 | Importaciones de una hoja ajena o inexistente | Sí |
  | H2-12 | Exportaciones de todas las hojas | Sí |
  | H2-13 | Exportaciones de una hoja ajena o inexistente | Sí |
  | H2-14 | Página de revisiones sin la fila de más | Sí |

- La verificación completa se hizo con H5: ver [bitácora 08](08-abrir-un-catalogo-como-hoja.md#verificación-completa-de-h1h5-2026-11-14).

## Consecuencias

- El editor de la web puede enseñar el historial y el agente tiene de dónde contestar «¿qué cambió esta semana?».
- Comparar dos revisiones cualesquiera sigue sin ruta propia: hoy se hace leyendo filas con `revisionId`. Si la web lo necesita, es una lectura nueva.
