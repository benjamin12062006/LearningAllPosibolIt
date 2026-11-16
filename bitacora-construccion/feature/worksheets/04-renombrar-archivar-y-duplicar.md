# 04 — H1: renombrar, archivar, restaurar y duplicar libros y hojas

Fecha de creación: 2026-11-14  
Estado: Implementado y verificado (2026-11-14). El código entró en `fb32457` (guardado del usuario del 2026-11-13); esta bitácora cierra la etapa. La migración 32 está pendiente de aplicar en Cloud SQL (la aplica el usuario).  
Relacionada con: [plan 02 de cierre](../../../docs/plans/feature/cierre-backend/02-plan-terminar-hojas-visor-y-agente.md) (P7, P8), [fuentes 04](../../../docs/fonts/feature/cierre-backend/04-fuentes-de-terminar-hojas-visor-y-agente.md) (E2, H8), [12, hojas](../../../../docs-diagrams/12-hojas-modelo-editor-importacion-y-exportacion.md), [bitácora 01, libro y hoja vacía](01-libro-y-hoja-vacia.md).  
Revisión de partida: `feature/cierre-backend` `3733be4`.

## Necesidad

Las hojas se podían crear y leer, pero no administrar. La visión (4.2) pide «crear, abrir, renombrar, duplicar y archivar hojas» y el documento 12 fija cómo: archivar impide escrituras y permite lectura; duplicar fija una revisión de origen y crea IDs nuevos con procedencia, sin copiar conversaciones ni borradores.

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| 12: «Archivar impide escrituras y permite lectura según retención» | `archived_at` nulo es activo; las lecturas no cambian y toda escritura sobre la hoja responde 409 `WORKSHEET_ARCHIVED` | Migración 32; `assertWorksheetActive` en [`worksheets.repository.ts`](../../../src/worksheets/worksheets.repository.ts) |
| Las escrituras de borradores, importaciones y puente al catálogo viven en otros módulos | Una sola comprobación exportada, llamada dentro de su transacción después de `lockProjectFor` (que bloquea la organización, así que no se puede archivar a la vez) | `insertDraft` y las seis escrituras de [`changesets.repository.ts`](../../../src/changesets/changesets.repository.ts); `assertCanSendToCatalog` en [`worksheet-catalog-snapshots.service.ts`](../../../src/worksheet-catalog-snapshots/worksheet-catalog-snapshots.service.ts) |
| Un libro agrupa hojas (12) | Un libro archivado deja sin escritura a todas sus hojas y no admite hojas nuevas; la hoja no copia la marca, se calcula al leer | `isArchivedWorksheet` (hoja **o** libro); `workbookArchivedAt` en la vista |
| C6: el rol decide; aprobar y administrar son de Manager | Renombrar pide Editor (`worksheet.write`); archivar y restaurar, Manager (`changeset.approve`) | `setWorkbookArchived`, `setWorksheetArchived` |
| 12: «duplicar fija una revisión origen y crea IDs nuevos con procedencia» | Copia de hoja, columnas, revisión 1 y filas vivas en una transacción, con `source_worksheet_id` y `source_revision_id` | `duplicateWorksheet`, `copyRows` |
| Las fórmulas guardan sus columnas por ID (V3 de worksheets) | Reescribir los IDs de columna de cada fórmula a los de la copia; las opciones de selección conservan su ID porque las celdas lo guardan | [`worksheet-copy.ts`](../../../src/worksheets/worksheet-copy.ts) |
| Auditoría de E4: cada operación deja su evento | `workbook.renamed`, `workbook.archived`, `workbook.restored`, `worksheet.renamed`, `worksheet.archived`, `worksheet.restored` y `worksheet.duplicated` | `auditWorkbook`, `auditWorksheet` |

No se consultaron cursos para esta etapa: son operaciones de administración sobre el modelo propio, con las reglas del documento 12 y los patrones ya usados en el módulo (bloqueo de organización, auditoría y 404/403/409 de C6).

## Contrato

Bajo `P = /api/v1/organizations/:organizationId/projects/:projectId`:

| Ruta | Permiso | Respuesta |
| --- | --- | --- |
| `PATCH P/workbooks/:workbookId` `{ name }` | Editor | `{ workbook }` |
| `POST P/workbooks/:workbookId/archive` · `…/restore` | Manager | `200 { workbook }` |
| `PATCH P/worksheets/:worksheetId` `{ name }` | Editor | `{ worksheet, capabilities }` |
| `POST P/worksheets/:worksheetId/archive` · `…/restore` | Manager | `200 { worksheet, capabilities }` |
| `POST P/worksheets/:worksheetId/duplicate` `{ name, workbookId?, revisionId? }` | Editor | `201 { worksheet, capabilities }` |
| `GET P/workbooks?archived=` · `GET P/workbooks/:id/worksheets?archived=` | Viewer | Sin `archived`, todo; `true` o `false`, solo uno |

La hoja y el libro llevan `archivedAt`; la hoja, además, `workbookArchivedAt` y `duplicatedFrom: { worksheetId, revisionId } | null`. `capabilities.write` y `approve` son `false` si la organización, la hoja o su libro están archivados.

| Caso | Respuesta |
| --- | --- |
| Hoja o libro archivados al escribir | 409 `WORKSHEET_ARCHIVED` / `WORKBOOK_ARCHIVED` |
| Nombre ya usado en el proyecto (libro) o en el libro (hoja), también por uno archivado | 409 `WORKBOOK_NAME_TAKEN` / `WORKSHEET_NAME_TAKEN` |
| Cambiar solo las mayúsculas del propio nombre | 200 |
| Archivar lo ya archivado, restaurar lo activo | 200 sin cambios ni auditoría |
| Revisión de otra hoja al duplicar | 404 `WORKSHEET_REVISION_NOT_FOUND` |

## Ajustes al escribir el código

- **Una migración para archivar y duplicar** (`20261113100000_archive_and_duplicate_worksheets`): `archived_at` en libros y hojas, la procedencia de la copia con un `CHECK` de que van las dos o ninguna, y `'duplicate'` como origen permitido de una revisión. Sin clave foránea a la hoja de origen: es procedencia, no una dependencia.
- **El nombre de lo archivado sigue reservado.** Las restricciones únicas no cambian; así restaurar nunca choca.
- **Un borrador ya abierto no se puede seguir, solo cancelar.** Guardar, enviar, reabrir, decidir, aplicar y rebase comprueban la hoja; cancelar no, porque es recoger.
- **Copiar una hoja archivada sí se puede:** es leerla. El libro de destino tiene que estar activo.
- Dos pruebas que comparaban la hoja con igualdad exacta (`worksheets.e2e-spec.ts` y `worksheets.int-spec.ts`) se ampliaron con los campos nuevos (`archivedAt`, `workbookArchivedAt`, `duplicatedFrom`). Es una ampliación del contrato, no un cambio.

## Comprobaciones realmente ejecutadas (2026-11-14)

- **Pruebas de H1:** 31 de 31. 26 E2E en [`archive-and-rename.e2e-spec.ts`](../../../test/features/worksheets/archive-and-rename.e2e-spec.ts) (renombrar libro y hoja con auditoría y nombres únicos; archivar y restaurar hoja y libro, con idempotencia; qué escrituras se bloquean en cada módulo y cuáles no; un borrador abierto solo se cancela; listados con `archived`; duplicar con filas, revisión elegida, fórmulas reescritas, otro libro, independencia del origen y libro archivado; roles, otra organización, sin sesión y organización archivada) y 5 unitarias de `copyColumns` en [`worksheet-copy.spec.ts`](../../../test/features/worksheets/worksheet-copy.spec.ts).
- **Defectos a propósito:** **20 de 20 detectados.**

  | Id | Defecto | Detectado |
  | --- | --- | --- |
  | H1-1 | Archivar un libro con permiso de Editor | Sí |
  | H1-2 | Archivar una hoja con permiso de Editor | Sí |
  | H1-3 | El libro archivado no cuenta para sus hojas | Sí |
  | H1-4 | Borrador nuevo en una hoja archivada | Sí |
  | H1-5 | Aplicar un borrador de una hoja archivada | Sí |
  | H1-6 | Llevar al catálogo una hoja archivada | Sí |
  | H1-7 | Renombrar una hoja archivada | Sí |
  | H1-8 | El propio libro cuenta como nombre ocupado | Sí |
  | H1-9 | Filtro de archivados al revés | Sí |
  | H1-10 | Repetir archivar cambia la fecha | Sí |
  | H1-11 | Las capacidades ignoran el archivado de la hoja | Sí |
  | H1-12 | Hoja nueva en un libro archivado | Sí |
  | H1-13 | La copia lleva filas borradas | Sí |
  | H1-14 | La copia toma la revisión actual y no la pedida | Sí |
  | H1-15 | Las fórmulas de la copia apuntan al origen | Sí |
  | H1-16 | Copiar a un libro archivado | Sí |
  | H1-17 | Una revisión de otra hoja como origen | Sí |
  | H1-18 | La copia conserva los IDs de fila | Sí |
  | H1-19 | Renombrar una hoja sin auditoría | Sí |
  | H1-20 | Restaurar no limpia la fecha | Sí |

- La verificación completa (tipos, linter, formato, esquema frente a 32 migraciones, batería entera y arranque real) se hizo junto con H2: ver [bitácora 05](05-historial-de-la-hoja.md#comprobaciones-realmente-ejecutadas-2026-11-14).

## Consecuencias

- La web puede administrar libros y hojas; el agente podrá duplicar y renombrar (escrituras que preparan trabajo), pero no archivar: es de Manager y queda fuera de su catálogo.
- Cuando el usuario aplique la migración 32 en Cloud SQL, `pnpm db:verify` volverá a pasar la lista de migraciones.
