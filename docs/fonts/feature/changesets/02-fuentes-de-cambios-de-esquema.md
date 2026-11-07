# 02 — Fuentes para cambios de esquema en un borrador (E4.7)

Fecha de creación: 2026-11-06  
Última actualización: 2026-11-06  
Estado: Investigación que respalda E4.7 del [plan 01](../../../plans/feature/changesets/01-plan-e4-borradores-y-revisiones.md) (D12).  
Relacionada con: [fuentes 01](01-fuentes-de-borradores-y-revisiones.md), [hojas](../../../../../docs-diagrams/12-hojas-modelo-editor-importacion-y-exportacion.md), [revisiones](../../../../../docs-diagrams/13-revisiones-aprobaciones-y-conflictos.md), [fuentes de validadores y cálculos](../worksheets/03-fuentes-de-validadores-y-calculos.md).

## Estado real del código (2026-11-06, `main` `7921f00` más la batería de E4)

| ID | Hallazgo |
| --- | --- |
| E1 | `worksheet_column_versions` guarda el esquema completo por `schema_version`, con clave `(worksheet_id, schema_version, column_id)`. Cada revisión guarda su `schema_version` y la lectura de filas usa la de la revisión pedida. |
| E2 | `worksheets.schema_version` es la versión vigente; `findWorksheetIn` lee las columnas con ella. |
| E3 | Las fórmulas guardan columnas por ID (`referencedColumns` en `column-plan.ts`). |
| E4 | Las filas guardan `cell_values` por ID de columna; la lectura recorre las columnas del esquema, así que una clave de una columna borrada no se muestra. |
| E5 | No hay ninguna ruta que cambie el esquema de una hoja después de crearla. |

## Requisitos del diseño

| ID | Documento y pasaje | Qué exige |
| --- | --- | --- |
| H1 | [12](../../../../../docs-diagrams/12-hojas-modelo-editor-importacion-y-exportacion.md), «Identidad y tipos de celda» | Toda operación usa `rowId`/`columnId`; «insertar, ordenar y renombrar no cambia esos IDs». |
| H2 | [12](../../../../../docs-diagrams/12-hojas-modelo-editor-importacion-y-exportacion.md), mismo apartado | «Una conversión de tipo previsualiza cada valor incompatible; nunca trunca, redondea o borra silenciosamente.» «El borrado de columnas y filas es una operación revisable con diff.» |
| H3 | [13](../../../../../docs-diagrams/13-revisiones-aprobaciones-y-conflictos.md), «Comparación de tres versiones» | «Delete frente a edición, mismo ID insertado, tipo/columna cambiados → conflicto estructural; no tratarlo como celda vacía.» |
| H4 | [18](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md), T06 | «Renombrar columna conserva referencias; eliminar/cambiar tipo detecta dependencias.» |
| H5 | [13](../../../../../docs-diagrams/13-revisiones-aprobaciones-y-conflictos.md), «Historial» | Una revisión se lee sin reejecutar reglas actuales: las versiones de esquema reconstruyen la hoja. |

## Cursos

Sin consulta nueva: las decisiones se apoyan en las ya registradas. C21 (Git solo marca conflicto cuando los dos lados cambian lo mismo, y la persona resuelve) sirve igual para una columna que para una celda.

## Mapa necesidad → requisito → fuentes → decisión

| Necesidad | Requisito | Fuentes | Decisión |
| --- | --- | --- | --- |
| Añadir, renombrar y borrar columnas desde un borrador | H1, H2 | E1, E5 | Operaciones `add_column`, `rename_column` y `delete_column` por ID, en la misma lista que las de filas. |
| Que una revisión antigua se siga leyendo igual | H5 | E1, E4 | Al aplicar, guardar el esquema resultante completo como una versión nueva; no reescribir filas. |
| Detectar dependencias | H4 | E3 | Borrar una columna que usa una fórmula restante → `COLUMN_IN_USE`. Renombrar no toca las fórmulas (van por ID). |
| Conflictos estructurales | H3 | C21 | Un cambio de esquema sobre un esquema ya cambiado es conflicto `schema_changed`; escribir en una columna borrada por otra revisión es `column_deleted`. Se resuelven en el rebase por columna. |
| Cambiar el tipo | H2 | — | **Aplazado**: exige previsualizar cada valor incompatible antes de convertir. Es un incremento propio. |
