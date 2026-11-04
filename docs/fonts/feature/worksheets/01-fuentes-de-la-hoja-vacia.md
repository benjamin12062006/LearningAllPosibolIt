# 01 — Fuentes para crear una hoja vacía y leer sus metadatos (E3.1)

Fecha de creación: 2026-11-03  
Estado: Investigación que respalda el [plan 01](../../../plans/feature/worksheets/01-plan-e3.1-hoja-vacia.md).  
Relacionada con: [hojas tipadas](../../../../../docs-diagrams/12-hojas-modelo-editor-importacion-y-exportacion.md), [revisiones](../../../../../docs-diagrams/13-revisiones-aprobaciones-y-conflictos.md), [contratos](../../../../../docs-diagrams/16-nuxt-tabla-central-chat-y-contratos.md), [secuencia](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md), [fuentes de organizaciones](../organizations&access/03-fuentes-de-archivado-y-cuotas.md).

## Requisitos de la ampliación

| ID | Documento y pasaje | Qué exige |
| --- | --- | --- |
| H1 | [18](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md), «Microentregas», punto 2 | «E3.1 hoja vacía: crear esquema y revisión inicial; GET de metadatos.» Las modificaciones oficiales esperan a E4. |
| H2 | [16](../../../../../docs-diagrams/16-nuxt-tabla-central-chat-y-contratos.md), «Convenciones de API» | Prefijo `P = /api/v1/organizations/:orgId/projects/:projectId`; «Todos los recursos anidados se resuelven dentro del ámbito, no solo por su ID». `GET/POST P/workbooks`, `POST P/workbooks/:id/worksheets` («Nombre, esquema inicial; revisión vacía, 201») y `GET P/worksheets/:id` («Esquema, head, capabilities»). |
| H3 | [12](../../../../../docs-diagrams/12-hojas-modelo-editor-importacion-y-exportacion.md), «Modelo lógico» | `workbooks`, `worksheets` (`head_revision_id`, `generation`, `schema_version`) y `worksheet_column_versions` con `column_id` estable, único por hoja, versión y nombre normalizado. |
| H4 | [12](../../../../../docs-diagrams/12-hojas-modelo-editor-importacion-y-exportacion.md), «Identidad y tipos de celda» | Toda operación usa `rowId`/`columnId`; las posiciones no son identidad. Tipos texto, entero, decimal, fecha, booleano, selección y calculada. Hasta 200 columnas. |
| H5 | [13](../../../../../docs-diagrams/13-revisiones-aprobaciones-y-conflictos.md), modelo y «Historial» | Revisiones inmutables con secuencia única por ámbito; «Auditoría y revisiones comerciales no usan cascadas de borrado desde proyectos». |
| H6 | [11](../../../../../docs-diagrams/11-backend-nest-organizaciones-y-transicion.md), «Aislamiento y persistencia» | Las tablas nuevas llevan `organization_id`; FK compuestas con organización y proyecto. Una hoja libre no llama a `requireConfigured`. |

## Curso

Curso: **Learn how to build Microservices applications starting with business analysis and domain driven design** (carpeta `Arquitectura/DDD y Microservicios`), sección 7 «Domain Driven Design - Tactical Patterns». Instructor no consta en los archivos. Ruta relativa a la biblioteca `/Users/benji/Documents/chrome-extencions/trancripciones/`: `Arquitectura/DDD y Microservicios/Sección 7 Domain Driven Design - Tactical Patterns/`. Consulta: 2026-11-03. Es la misma lección C1 de [19](../../../../../docs-diagrams/19-fuentes-trazabilidad-y-decisiones-pendientes.md); aquí se leen otros pasajes.

| ID | Lección y localizador | Evidencia | Uso |
| --- | --- | --- | --- |
| C13 | `37. Aggregate & Factory - Pattern.md`, línea 17; búsqueda «Aggregates must provide interfaces» | El código de fuera no toca los objetos internos: el agregado expone las operaciones. | La hoja es la raíz: sus columnas y revisiones solo se crean y leen a través de ella; no hay rutas propias de columna. |
| C14 | `37. Aggregate & Factory - Pattern.md`, línea 19; búsqueda «all of the changes must be made atomically» | El agregado ocupa varias tablas y se guarda de forma atómica. | Hoja, columnas, revisión inicial y puntero al head se insertan en una sola transacción. |
| C15 | `37. Aggregate & Factory - Pattern.md`, línea 21; búsqueda «Factory design pattern is a common pattern» | Una fábrica concentra la lógica de crear un agregado complejo. | Una función pura (`buildNewWorksheet`) arma IDs, posiciones y nombres normalizados antes de tocar la base, y se prueba sola. |

El curso usa Java y no trata versiones de esquema; la secuencia de revisiones y el puntero al head salen de [13](../../../../../docs-diagrams/13-revisiones-aprobaciones-y-conflictos.md).

## Documentación oficial y evidencia del proyecto

| ID | Fuente | Evidencia | Uso |
| --- | --- | --- | --- |
| F29 | Registrada en [feeds, ficha 05](../feeds&publications/05-puntero-publicado-y-enlace-del-archivo.md): PostgreSQL, «Foreign Keys» | Una FK puede referenciar un grupo de columnas con restricción única; si alguna referenciante es nula no se comprueba; `RESTRICT` impide borrar la fila referenciada. | FK compuestas `(organization_id, project_id) → projects`, `(organization_id, project_id, workbook_id) → workbooks` y el puntero `(id, head_revision_id) → worksheet_revisions (worksheet_id, id)`, igual que el puntero publicado de feeds. `RESTRICT` desde proyectos (H5). |
| F39 | Registrada en la [ficha 03 de organizaciones](../organizations&access/03-fuentes-de-archivado-y-cuotas.md) | `FOR UPDATE` bloquea la fila hasta el final de la transacción. | Crear libro u hoja bloquea antes la organización, igual que las escrituras de membresías: archivar y crear se ordenan. |
| P1 | [catalog-import.repository.ts](../../../../src/catalog-import/catalog-import.repository.ts), `deleteProject` | Borra snapshots y el proyecto; no comprueba otras dependencias. | Con `RESTRICT`, borrar un proyecto con libros fallaría con un error de clave foránea (500). Hace falta una comprobación explícita con un `409`. |

## Límites

Ninguna fuente fija el contrato JSON de columnas ni la respuesta de `capabilities`: son propuesta propia sobre H2–H4.
