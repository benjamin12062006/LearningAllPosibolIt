# 07 — H4: vistas guardadas

Fecha de creación: 2026-11-14  
Estado: Implementado y verificado (2026-11-14). Sin commit. La migración 34 está pendiente de aplicar en Cloud SQL (la aplica el usuario).  
Relacionada con: [plan 02 de cierre](../../../docs/plans/feature/cierre-backend/02-plan-terminar-hojas-visor-y-agente.md) (P10), [fuentes 04](../../../docs/fonts/feature/cierre-backend/04-fuentes-de-terminar-hojas-visor-y-agente.md) (H9), [12, `saved_views`](../../../../docs-diagrams/12-hojas-modelo-editor-importacion-y-exportacion.md), [15, `suggest_view`](../../../../docs-diagrams/15-chat-ia-herramientas-y-propuestas.md).  
Revisión de partida: `feature/cierre-backend` `fb32457`.

## Necesidad

El documento 12 pide `saved_views`: filtros, orden y columnas visibles con nombre, personales o del equipo, que no cambian ningún valor. El 15 prevé que el agente sugiera vistas (`suggest_view`). Hoy cada lectura de filas manda su consulta entera.

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| La consulta de `rows/query` ya tiene forma, límites y validador (`parseRowQuery`) | Una vista guarda exactamente `{ filter, sort, columns }` y se valida igual al guardarla y al usarla | `SaveViewDto`, `assertQueryFits` en [`saved-views.service.ts`](../../../src/worksheets/saved-views.service.ts) |
| 12: alcance personal o de equipo | `personal` solo existe para su autor (para los demás, 404 como lo ajeno); `team` la ve cualquier miembro | `isVisibleTo` en [`saved-views.repository.ts`](../../../src/worksheets/saved-views.repository.ts) |
| Una vista del equipo la verán todos | Crearla pide Editor; una personal, ser miembro. Cambiar o borrar: su autor; una del equipo, también un Manager | `permissionFor`, `canEditView` |
| Mezclar en silencio la vista con lo que manda la petición confunde | Con `viewId`, `filter`, `sort` y `columns` no pueden venir | `withSavedView` en [`worksheet-rows.service.ts`](../../../src/worksheets/worksheet-rows.service.ts) |
| 12: «no cambia valores empresariales» | Se pueden guardar y usar vistas en una hoja archivada | Sin `assertWorksheetActive` |

Decisión abierta del plan («¿las vistas del equipo las crea un Editor o solo un Manager?»): se aplicó el valor por defecto, Editor.

## Contrato

Bajo `P = /api/v1/organizations/:organizationId/projects/:projectId`:

| Ruta | Permiso | Respuesta |
| --- | --- | --- |
| `POST P/worksheets/:id/saved-views` `{ name, visibility, query }` | Miembro (personal) o Editor (equipo) | `201 { savedView }` |
| `GET P/worksheets/:id/saved-views` | Miembro | `{ savedViews: [del equipo y propias], page }` |
| `GET P/saved-views/:viewId` | Quien la ve | `{ savedView }` |
| `PUT P/saved-views/:viewId` | Autor; del equipo, también Manager | `{ savedView }` |
| `DELETE P/saved-views/:viewId` | Ídem | `204` |
| `POST P/worksheets/:id/rows/query` `{ viewId, revisionId?, cursor?, limit? }` | Quien la ve | Las filas de la vista |

`savedView` es `{ id, worksheetId, ownerId, name, visibility, query, createdAt, updatedAt, canEdit }`. El nombre es único entre las vistas de cada persona en la hoja.

## Ajustes al escribir el código

- **Migración 34** (`20261114110000_create_worksheet_saved_views`).
- **Un 500 encontrado por las pruebas:** sin `query` en el cuerpo, `@ValidateNested` no fallaba y el servicio rompía. Se añadió `@IsObject()`.
- **La consulta de filas tiene su propio tipo** (`RowsRequest`): con vista, lo que se lee ya no es el DTO de la petición.
- Sin auditoría: una vista no cambia ningún valor de la hoja.

## Comprobaciones realmente ejecutadas (2026-11-14)

- **Pruebas:** 15 E2E en [`saved-views.e2e-spec.ts`](../../../test/features/worksheets/saved-views.e2e-spec.ts) sobre una hoja con cuatro filas vivas: guardar y listar; validación como `rows/query`; nombre por persona; con vista se leen las mismas filas que mandando la consulta; el cursor sigue con la vista; `viewId` con consulta, de otra hoja o inexistente; columna perdida; quién ve qué; un Viewer guarda personales y no del equipo; el autor cambia y borra; un Editor no toca la del equipo de otro y un Manager sí; la personal de otro no existe; cambiarla valida; hoja archivada; otra organización, sin sesión y hoja inexistente. Las pruebas de filas y de hojas siguen pasando.
- **Defectos a propósito:** **12 de 12 detectados.** Dos (H4-2 y H4-7) los escribí mal la primera vez y no compilaban: no contaron y se repitieron bien escritos. Para H4-2 se dio a `permissionFor` un tipo de retorno explícito.

  | Id | Defecto | Detectado |
  | --- | --- | --- |
  | H4-1 | La vista personal la ven todos | Sí |
  | H4-2 | Vista del equipo con permiso de lectura | Sí |
  | H4-3 | Un Editor cambia las del equipo de otros | Sí |
  | H4-4 | El autor no puede cambiar la suya | Sí |
  | H4-5 | `viewId` se mezcla con la consulta | Sí |
  | H4-6 | Vista de otra hoja aceptada | Sí |
  | H4-7 | Guardar sin validar la consulta | Sí |
  | H4-8 | La vista no se aplica | Sí |
  | H4-9 | Nombre único en toda la hoja y no por persona | Sí |
  | H4-10 | Cambiarla sin validar la consulta | Sí |
  | H4-11 | Cambiar o borrar sin mirar quién puede | Sí |
  | H4-12 | `canEdit` siempre verdadero | Sí |

- La verificación completa se hizo con H5: ver [bitácora 08](08-abrir-un-catalogo-como-hoja.md#verificación-completa-de-h1h5-2026-11-14).

## Consecuencias

- La herramienta `suggest_view` del agente (15) tiene dónde guardar lo que propone: una vista personal de quien la pide.
