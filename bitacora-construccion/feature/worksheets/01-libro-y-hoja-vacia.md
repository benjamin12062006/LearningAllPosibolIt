# 01 — Libro y hoja vacía con esquema y revisión inicial (E3.1 de la ampliación)

Fecha de creación: 2026-11-03  
Estado: Implementado y verificado en local; confirmado en la rama `feature/worksheets`. Migración sin aplicar en Neon.  
Ámbito: [plan 01 de hojas](../../../docs/plans/feature/worksheets/01-plan-e3.1-hoja-vacia.md).  
Relacionada con: [fuentes 01](../../../docs/fonts/feature/worksheets/01-fuentes-de-la-hoja-vacia.md), [organizaciones, bitácora 03](../organizations&access/03-archivar-organizaciones-y-cuotas.md), [hojas tipadas](../../../../docs-diagrams/12-hojas-modelo-editor-importacion-y-exportacion.md).  
Revisión de partida: `8a32dfb` en `feature/organizations-access`.

## Necesidad y punto de partida

El usuario eligió seguir con E3.1, que según la [secuencia](../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md) depende solo de E1. Orden seguido: [fuentes](../../../docs/fonts/feature/worksheets/01-fuentes-de-la-hoja-vacia.md) → [plan](../../../docs/plans/feature/worksheets/01-plan-e3.1-hoja-vacia.md) → código.

No había nada de hojas. La ruta `DELETE /projects/:id` (catalog-import) borraba el proyecto sin mirar otras dependencias.

## Evidencia y decisiones

| Decisión | Evidencia | Aplicación |
| --- | --- | --- |
| W1 tablas con `organization_id` y FK compuestas | H3, H6, F29 | [migración](../../../prisma/migrations/20261103100000_create_worksheets/migration.sql): `workbooks`, `worksheets`, `worksheet_column_versions`, `worksheet_revisions`; `projects` gana `UNIQUE (organization_id, id)`. Modelos en `schema.prisma`. |
| W2 head en la hoja, con FK a una revisión propia | F29, H5 | `worksheets (id, head_revision_id) → worksheet_revisions (worksheet_id, id)`, como el puntero publicado de feeds. |
| W3–W4 cinco tipos, nombres únicos normalizados, hasta 200 columnas, ID estable | H4 | [worksheet-columns.ts](../../../src/worksheets/worksheet-columns.ts) (`COLUMN_TYPES`, `WORKSHEET_LIMITS`, `normalizeName`) y `CHECK` en la migración. |
| W7 bloquear la organización y comprobar dentro | F39, C6 | `lockWritableProject` en [worksheets.repository.ts](../../../src/worksheets/worksheets.repository.ts): 404, 409 archivada y 403, por ese orden. Las lecturas llevan `isMember` en el `WHERE`. |
| W8 fábrica pura | C15 | [new-worksheet.ts](../../../src/worksheets/new-worksheet.ts): `buildNewWorksheet` y `duplicateColumnPositions`. |
| C14 creación atómica | C14 | `createWorksheet`: hoja → columnas → revisión inicial → puntero, en una transacción. |
| W9 `capabilities` | H2 | `capabilitiesOf` en [worksheets.service.ts](../../../src/worksheets/worksheets.service.ts): `write` y `approve` según rol, y ninguno con la organización archivada. |
| W11 borrar proyecto con libros: 409 | H5, P1 | `hasWorkbooks` en `deleteProject` de [catalog-import.repository.ts](../../../src/catalog-import/catalog-import.repository.ts) y código `PROJECT_HAS_WORKBOOKS`. |

### Ajustes al escribir el código

- **Columnas repetidas: `VALIDATION_FAILED` con un `issue` por columna.** El filtro de errores solo deja pasar `issues` con algunos códigos; reglas ya usa este patrón. Cada `issue` lleva `WORKSHEET_COLUMN_DUPLICATE` y el campo (`columns.2.name`). No se tocó el filtro.
- **Nombres de índices de 63 caracteres.** PostgreSQL recorta los nombres largos; la migración usa los nombres que genera Prisma, comprobado con `prisma migrate diff`.
- **El módulo no depende de servicios de organizaciones ni de proyectos**: usa las funciones `lockOrganization`, `assertNotArchived` y `can`, y comprueba proyecto y membresía en su propio SQL.

## Implementación y funcionamiento

`P = /api/v1/organizations/:organizationId/projects/:projectId`

| Ruta | Permiso | Respuesta |
| --- | --- | --- |
| `POST P/workbooks` | `worksheet.write` | `201 { workbook }` |
| `GET P/workbooks` | miembro | `{ workbooks, page }` |
| `POST P/workbooks/:workbookId/worksheets` | `worksheet.write` | `201 { worksheet, capabilities }` |
| `GET P/workbooks/:workbookId/worksheets` | miembro | `{ worksheets, page }` |
| `GET P/worksheets/:worksheetId` | miembro | `{ worksheet, capabilities }` |

Códigos nuevos (es/en): `WORKBOOK_NOT_FOUND`, `WORKSHEET_NOT_FOUND` (404), `WORKBOOK_NAME_TAKEN`, `WORKSHEET_NAME_TAKEN`, `PROJECT_HAS_WORKBOOKS` (409) y `WORKSHEET_COLUMN_DUPLICATE` (en `issues`).

## Comprobación

En una copia aislada del backend.

| Comprobación | Resultado |
| --- | --- |
| `pnpm build`, `pnpm lint`, `pnpm format:check` | Correctos. |
| `pnpm test:features` completo | 57 suites y 987 pruebas en verde (incluye el trabajo de feeds presente en la copia). |
| `pnpm db:verify` y `pnpm users:verify` | Correctos. |
| `prisma migrate diff` | Migración vacía tras usar los nombres de índice de Prisma. |
| Suites de hojas | 15 pruebas en verde. |
| Defecto forzado M9: leer la hoja sin membresía | 1 prueba falla. |
| Defecto forzado M10: crear sin permiso de escritura | 2 pruebas fallan. |
| Defecto forzado M11: borrar proyecto sin comprobar libros | 1 prueba falla. Restaurado: 15/15. |

La atomicidad se prueba directamente: una hoja con dos columnas en la misma posición falla en mitad de la transacción y no deja hoja, columnas ni revisión.

Pruebas existentes que cambiaron: la lista de migraciones y el recuento de `projects.repository.int-spec.ts` (de 18 a 19).

## Consecuencias y continuidad

- Hay libros y hojas con esquema tipado y revisión 1 vacía. No hay filas ni cambios de datos.
- Borrar un proyecto con libros responde 409; su historial no se pierde. Archivar proyectos queda para E1.2/E4.
- Siguiente: E3.2 (filas leídas por revisión con filtros, orden y cursor) y E3.3 (validadores de tipos y cálculos).
