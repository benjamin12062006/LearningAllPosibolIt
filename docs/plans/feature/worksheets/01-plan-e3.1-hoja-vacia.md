# 01 — E3.1: crear un libro y una hoja vacía con su esquema y revisión inicial

Fecha de creación: 2026-11-03  
Última actualización: 2026-11-03 (implementado)  
Estado: Implementado y verificado en local ([bitácora 01](../../../../bitacora-construccion/feature/worksheets/01-libro-y-hoja-vacia.md)); confirmado en `feature/worksheets`; migración sin aplicar en Neon.  
Ámbito: `LearningAllPosibolIt`, solo backend y REST. Primera microentrega de E3 de la ampliación ([18](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md)).  
Relacionada con: [fuentes 01](../../../fonts/feature/worksheets/01-fuentes-de-la-hoja-vacia.md), [plan de organizaciones](../organizations&access/01-plan-organizaciones-y-acceso.md), [hojas tipadas](../../../../../docs-diagrams/12-hojas-modelo-editor-importacion-y-exportacion.md), [contratos](../../../../../docs-diagrams/16-nuxt-tabla-central-chat-y-contratos.md).  
Revisión de referencia: `8a32dfb` en `feature/organizations-access` (E1.1, E1.3 y E1.4).

## Objetivo

Un miembro con permiso `worksheet.write` crea un libro en un proyecto y, dentro, una hoja con columnas tipadas. La hoja nace con su primera revisión, vacía. Cualquier miembro lee los metadatos: esquema, revisión actual y lo que puede hacer. E3.1 está completa cuando:

1. Hoja, columnas, revisión inicial y puntero al head se crean juntos o no se crea nada (C14).
2. Cada columna tiene un ID estable que no depende de su posición ni de su nombre (H4).
3. Un libro, una hoja o un proyecto de otra organización responden `404`, aunque se conozca el ID (H2, C6).
4. Sin `worksheet.write`, `403`; con la organización archivada, `409`.
5. Borrar un proyecto con libros responde `409`, no `500`, y no borra revisiones (H5, P1).
6. No hay filas todavía: llegan en E3.2. No hay cambios de datos: llegan con los borradores de E4.

## Punto de partida

- E1 dejó organizaciones, membresías, roles y `lockOrganization`. Los proyectos nuevos tienen `organization_id`.
- No existe nada de hojas. El contrato de [16](../../../../../docs-diagrams/16-nuxt-tabla-central-chat-y-contratos.md) es una propuesta sin código.
- `DELETE /projects/:id` está en catalog-import y borra el proyecto sin mirar otras dependencias (P1). La sesión de feeds edita ese archivo.

## Decisiones

| ID | Decisión | Respaldo |
| --- | --- | --- |
| W1 | Tablas `workbooks`, `worksheets`, `worksheet_column_versions` y `worksheet_revisions`, todas con `organization_id`. FK compuestas: proyecto `(organization_id, id)`, libro `(organization_id, project_id, id)`, hoja `(organization_id, id)`. `projects` gana `UNIQUE (organization_id, id)`. | H3, H6, F29 |
| W2 | El head vive en la hoja (`head_revision_id`, `generation`), con FK compuesta a una revisión de la propia hoja, como el puntero publicado de feeds. Las tablas genéricas `revision_streams` de [13](../../../../../docs-diagrams/13-revisiones-aprobaciones-y-conflictos.md) quedan para cuando exista el segundo ámbito (catálogo de productos, E8). | F29, H5; sin consumidor para lo genérico |
| W3 | Tipos en E3.1: `text`, `integer`, `decimal`, `date` y `boolean`. `selection` necesita opciones y `calculated` un AST: llegan con los validadores de E3.3. | H4, H1 |
| W4 | Columna: nombre de 1 a 120 caracteres, `required` (por defecto `false`). Como mucho 200 columnas, nombres únicos sin distinguir mayúsculas ni espacios de los extremos (repetidas: `400 VALIDATION_FAILED` con un `issue` `WORKSHEET_COLUMN_DUPLICATE` por columna, ajuste «en E3.1»). El ID lo genera el servidor; la posición es el orden enviado. | H3, H4 |
| W5 | Nombres de libro únicos por proyecto y de hoja únicos por libro, con la misma normalización: `409`. | Propuesta propia |
| W6 | Crear libro u hoja: `worksheet.write`. Leer: cualquier miembro. | Tabla de [11](../../../../../docs-diagrams/11-backend-nest-organizaciones-y-transicion.md) |
| W7 | Cada escritura abre una transacción, bloquea la organización (F39) y dentro comprueba miembro, permiso, archivado y que el proyecto sea de esa organización. Las lecturas llevan la membresía en el `WHERE` (C6). | F39, C6 |
| W8 | Una función pura `buildNewWorksheet` arma IDs, posiciones, nombres normalizados y la revisión inicial; el repositorio solo persiste. | C15 |
| W9 | `GET P/worksheets/:id` devuelve `{ worksheet, capabilities }` con `capabilities = { write, approve }` según rol y archivado. Los listados usan la paginación `page` existente; el cursor fijado a una revisión llega con las filas (E3.2). | H2 |
| W10 | Fechas en texto ISO-8601 UTC, como el resto del esquema. [12](../../../../../docs-diagrams/12-hojas-modelo-editor-importacion-y-exportacion.md) propone `timestamptz` para lo nuevo; se descarta por ahora para no mezclar dos formatos en el mismo esquema. Cambiarlo será una migración de todo el esquema. | Esquema vigente |
| W11 | `deleteProject` comprueba si el proyecto tiene libros y responde `409 PROJECT_HAS_WORKBOOKS` antes de borrar. Es un cambio mínimo en catalog-import, que posee esa ruta. | H5, P1 |
| W12 | Las hojas no llaman a `requireConfigured`. | H6 |

## Rutas

`P = /api/v1/organizations/:organizationId/projects/:projectId`

| Ruta | Permiso | Respuesta |
| --- | --- | --- |
| `POST P/workbooks` `{ name }` | `worksheet.write` | `201 { workbook }` |
| `GET P/workbooks` | miembro | `{ workbooks, page }` |
| `POST P/workbooks/:workbookId/worksheets` `{ name, columns }` | `worksheet.write` | `201 { worksheet, capabilities }` |
| `GET P/workbooks/:workbookId/worksheets` | miembro | `{ worksheets, page }` (sin columnas) |
| `GET P/worksheets/:worksheetId` | miembro | `{ worksheet, capabilities }` |

## Incrementos

1. Migración y ensayo con PGlite.
2. Fábrica pura y sus pruebas.
3. Repositorio y servicio de libros y hojas.
4. Controlador y rutas.
5. Comprobación en el borrado de proyectos.
6. Pruebas de integración y e2e; regresión completa.

## Comprobación prevista

- Unitarias: fábrica (IDs únicos, posiciones, nombres duplicados, límite de 200, tipos).
- Integración: creación atómica (un fallo no deja hoja sin revisión), puntero al head válido, aislamiento entre organizaciones, archivado y permisos.
- E2E: rutas con `401`, `403`, `404`, `409` y validación de columnas.
- Regresión: suites completas; la prueba de borrar proyectos sigue igual y se añade la del `409`.

## Límites y continuidad

- Siguiente: E3.2 (filas leídas por revisión, con filtros y cursor) y E3.3 (validadores de tipos y cálculos).
- Concurrencia real: PGlite no demuestra bloqueos.
- Las hojas solo se pueden crear en proyectos con organización; un proyecto heredado sin ella no aparece (igual que en E1.1).
