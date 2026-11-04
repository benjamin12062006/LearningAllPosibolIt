# 02 — Fuentes para leer filas de una revisión con filtros, orden y cursor (E3.2)

Fecha de creación: 2026-11-04  
Estado: Investigación que respalda el [plan 02](../../../plans/feature/worksheets/02-plan-e3.2-filas-por-revision.md).  
Relacionada con: [ficha 01](01-fuentes-de-la-hoja-vacia.md), [hojas tipadas](../../../../../docs-diagrams/12-hojas-modelo-editor-importacion-y-exportacion.md), [revisiones](../../../../../docs-diagrams/13-revisiones-aprobaciones-y-conflictos.md), [contratos](../../../../../docs-diagrams/16-nuxt-tabla-central-chat-y-contratos.md), [secuencia](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md).

## Requisitos de la ampliación

| ID | Documento y pasaje | Qué exige |
| --- | --- | --- |
| H7 | [18](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md), microentrega E3.2 y T05 | «Lectura de filas fijada a revisión con filtros.» T05: «Ordenar/filtrar/insertar no cambia identidad; cursor fija revisión». |
| H8 | [12](../../../../../docs-diagrams/12-hojas-modelo-editor-importacion-y-exportacion.md), «Modelo lógico» | `worksheet_row_versions`: «Valores y marca de borrado por fila/revisión. Intervalo `[from_seq, to_seq)` sin solapamientos; permite leer exactamente una revisión histórica.» |
| H9 | [13](../../../../../docs-diagrams/13-revisiones-aprobaciones-y-conflictos.md), «Historial» | Los intervalos de filas reconstruyen el estado de la hoja; los tombstones distinguen fila inexistente de fila vacía; «La proyección actual es una optimización, no el único historial». |
| H10 | [12](../../../../../docs-diagrams/12-hojas-modelo-editor-importacion-y-exportacion.md), «Lectura, búsqueda y cálculos» | AST acotado: grupos AND/OR de profundidad 3 y 20 predicados; `equals/not_equals/contains/lt/lte/gt/gte/in/is_null` según tipo; `in` hasta 100 valores; 3 columnas de orden; página de 100. «`null` solo coincide mediante operación explícita; no convertir cadenas vacías a null.» Búsqueda literal, sin comodines ni regex del usuario. SQL parametrizado; columnas por catálogo interno. La respuesta incluye revisión, `schemaVersion` y cursor; el cursor se vincula a la revisión y al hash del filtro. |
| H11 | [12](../../../../../docs-diagrams/12-hojas-modelo-editor-importacion-y-exportacion.md), «Identidad y tipos de celda» | Valor canónico por tipo: texto que distingue vacío de null; entero y decimal como cadena decimal; fecha `YYYY-MM-DD`; booleano true/false/null. |
| H12 | [16](../../../../../docs-diagrams/16-nuxt-tabla-central-chat-y-contratos.md), «Convenciones de API» | `GET P/worksheets/:id/rows` con «Revisión, filtro, columnas, cursor»; listas nuevas responden `{items, nextCursor, revisionId}`. |

## Curso

Curso: **Go from zero to a deployed & tested NestJS API with TypeScript, TypeORM, PostgreSQL & Docker** (carpeta `NestJS/NestJS API Profesional`), sección 6 «Advanced Queries Search, Pagination & Filtering». Instructor no consta en los archivos. Ruta relativa a la biblioteca: `NestJS/NestJS API Profesional/Sección 6 Advanced Queries Search, Pagination & Filtering/`. Consulta: 2026-11-04. Sin reconstrucción: el curso usa el query builder de TypeORM; se toman los criterios.

| ID | Lección y localizador | Evidencia | Uso |
| --- | --- | --- | --- |
| C16 | `72. Adding Pagination to Tasks List.md`, línea 15; búsqueda «skip attribute» | Paginación con `skip`/`take`, que en SQL son `OFFSET`/`LIMIT`. | Se combina con H10: sobre una revisión inmutable el desplazamiento es estable (ver «Decisión del cursor»). |
| C17 | `73. Simple Text Search With LIKE Operator.md`, líneas 17–19; búsqueda «the and operator is used by default» | Varias condiciones se combinan con AND por defecto; para OR hace falta agruparlas explícitamente. | El filtro es un árbol de grupos `and`/`or` explícitos (H10), sin un operador implícito. |
| C18 | `74. Using Query Builder for Advanced Filtering.md`, líneas 19–21; búsqueda «bind the parameters to prevent the SQL injection» | La consulta se construye por partes según los filtros recibidos y todos los valores van como parámetros. | Cada predicado produce un fragmento `Prisma.sql` con el valor y la clave de columna como parámetros; nunca se concatena texto del cliente. |

## Documentación oficial

Consulta: 2026-11-04.

| ID | Fuente y sección | Evidencia | Uso |
| --- | --- | --- | --- |
| F40 | [PostgreSQL 17 — 9.16 JSON Functions and Operators](https://www.postgresql.org/docs/17/functions-json.html), tablas 9.45 y 9.49 | `jsonb ->> text`: «Extracts JSON object field with the given key, as text». `jsonb_typeof`: tipo del valor de primer nivel (`string`, `number`, `boolean`, `null`…), «not be confused with an SQL NULL». | Las celdas viven en un objeto JSONB indexado por `columnId`. Se lee con `->>` usando el ID como parámetro; los booleanos se distinguen con `jsonb_typeof`. |
| F41 | [PostgreSQL 17 — 9.4 String Functions](https://www.postgresql.org/docs/17/functions-string.html), tabla 9.10 | `strpos(string, substring)`: «Returns first starting index of the specified substring within string, or zero if it's not present». Busca una subcadena, sin patrones. | `contains` = `strpos(lower(valor), lower(término)) > 0`: `%` y `_` del usuario son caracteres normales, sin escapar comodines (H10). |
| F42 | [PostgreSQL 17 — 7.5 Sorting Rows](https://www.postgresql.org/docs/17/queries-order.html) | «By default, null values sort as if larger than any non-null value»; las expresiones posteriores desempatan; sin `ORDER BY` el orden «must not be relied on». La página no garantiza el orden de los empates. | Orden explícito `NULLS LAST` en las dos direcciones y desempate final por `sort_key` y `row_id`, único: el orden queda totalmente determinado. |
| F43 | [PostgreSQL 17 — 11.8 Partial Indexes](https://www.postgresql.org/docs/17/indexes-partial.html), ejemplo 11.3 | Un índice único parcial «enforces uniqueness among the rows that satisfy the index predicate, without constraining those that do not». | Una sola versión abierta (`to_sequence IS NULL`) por fila. También respalda, a posteriori, el índice de invitación pendiente de E1.3. |

## Decisión del cursor

H10 propone un cursor de keyset («último valor/rowId»). Aquí se elige un **desplazamiento dentro de una revisión fija**, guardado en el cursor junto con el ID de revisión y el hash de la consulta:

- Una revisión es inmutable (H5, H9): leer la página *n* de la misma revisión con el mismo filtro y orden da siempre las mismas filas. El problema que resuelve el keyset (filas que se insertan entre páginas) no existe aquí.
- El tamaño está acotado a 5.000 filas por hoja (H4), así que el coste de `OFFSET` es pequeño.
- El keyset con hasta 3 columnas de orden en direcciones mezcladas y nulos exige condiciones encadenadas difíciles de leer y probar.

Si el límite de filas sube o la medición lo pide, se cambia a keyset sin cambiar el contrato: el cursor es opaco para el cliente.

## Límites

Ninguna fuente fija la forma JSON del filtro ni los nombres de los errores: son propuesta propia sobre H10–H12.
