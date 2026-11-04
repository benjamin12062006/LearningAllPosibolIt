# 02 — E3.2: leer las filas de una revisión con filtros, orden y cursor

Fecha de creación: 2026-11-04  
Última actualización: 2026-11-04 (implementado)  
Estado: Implementado y verificado en local ([bitácora 02](../../../../bitacora-construccion/feature/worksheets/02-filas-por-revision.md)); confirmado en `feature/worksheets`; migración sin aplicar en Neon.  
Ámbito: `claudeLearningAllPosibolIt`, solo backend y REST. Segunda microentrega de E3 ([18](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md)).  
Relacionada con: [fuentes 02](../../../fonts/feature/worksheets/02-fuentes-de-filas-por-revision.md), [plan 01](01-plan-e3.1-hoja-vacia.md), [bitácora 01](../../../../bitacora-construccion/feature/worksheets/01-libro-y-hoja-vacia.md).  
Revisión de referencia: `8a32dfb` en `feature/organizations-access`, con E3.1 sin commit.

## Objetivo

Un miembro lee las filas de una hoja tal como estaban en una revisión concreta (por defecto, la actual), con filtros tipados, orden y páginas. E3.2 está completa cuando:

1. Leer una revisión antigua devuelve exactamente sus filas, aunque haya revisiones posteriores (H8, H9).
2. Ordenar o filtrar no cambia el `rowId` de ninguna fila (T05).
3. Un cursor sigue leyendo la revisión con la que empezó, y no se puede usar con otro filtro u orden (H10, T05).
4. El filtro solo admite columnas de esa revisión y operadores de su tipo; un valor mal formado es `400`, nunca `500` (H10, H11).
5. Una celda vacía (`""`) no es `null`; `null` solo coincide con `is_null` (H10).

**Fuera de E3.2:** escribir filas. No hay ruta que las cree: llegarán con los borradores de E4 y la importación de E5. Las pruebas preparan filas con SQL directo.

## Decisiones

| ID | Decisión | Respaldo |
| --- | --- | --- |
| R1 | Tabla `worksheet_row_versions`: `row_id`, intervalo `[from_sequence, to_sequence)`, `sort_key`, `cell_values` (objeto JSONB por `columnId`) y `is_deleted`. Sin tabla de proyección actual todavía: con 5.000 filas leer por intervalos basta. | H8, H9 |
| R2 | Integridad en la base: PK `(worksheet_id, row_id, from_sequence)`, `to_sequence > from_sequence`, FK de las dos secuencias a revisiones de la misma hoja y una sola versión abierta por fila (índice único parcial). No hay restricción de exclusión entre intervalos: necesitaría `btree_gist`; el escritor de E4 cierra la versión anterior al abrir la nueva y lo prueba. | F43, F29 |
| R3 | `worksheet_revisions.source` admite también `changeset`, el origen de las revisiones de E4. Hace falta ya para probar que el cursor fija una revisión cuando hay otra posterior. | H7 |
| R4 | Valores canónicos (H11): texto como cadena, entero y decimal como cadena decimal, fecha `YYYY-MM-DD`, booleano JSON. Clave ausente o `null` JSON = `null`. | H11, F40 |
| R5 | Filtro como árbol `{ and: [...] }` / `{ or: [...] }` / predicado `{ column, op, value }`: profundidad 3, 20 predicados, `in` hasta 100 valores. Operadores por tipo: texto `equals`, `not_equals`, `contains`, `in`, `is_null`; entero, decimal y fecha añaden `lt`, `lte`, `gt`, `gte`; booleano `equals`, `not_equals`, `is_null`. `not_equals` excluye los nulos (en SQL ya ocurre: `null <> x` no es verdadero; ajuste «en E3.2»). | H10, C17 |
| R6 | Un analizador puro valida el filtro contra las columnas de la revisión y devuelve un árbol tipado o `issues` (`VALIDATION_FAILED`, como reglas y hojas). Un traductor puro lo convierte en `Prisma.sql` con valores y claves de columna como parámetros. | C18, H10 |
| R7 | Comparaciones seguras: números con `::numeric` solo si el texto cumple el patrón decimal; fechas como texto si cumplen `YYYY-MM-DD`; booleanos con `jsonb_typeof`. Un dato mal guardado se trata como `null`, no rompe la consulta. `contains` con `strpos` sobre minúsculas. | F40, F41 |
| R8 | Orden: hasta 3 columnas con dirección, `NULLS LAST` siempre y desempate por `sort_key` y `row_id`. Sin orden, el de la hoja. | F42, H10 |
| R9 | Cursor opaco `base64url` con `{ revisionId, queryHash, offset }`. `queryHash` = SHA-256 del filtro, orden y columnas ya analizados. Cursor con otra consulta o mal formado → `400 WORKSHEET_CURSOR_INVALID`. | H10, C16, «Decisión del cursor» |
| R10 | Ruta `POST P/worksheets/:worksheetId/rows/query` (solo lectura, `200`) con `{ revisionId?, filter?, sort?, columns?, cursor?, limit? }`. Se aparta del `GET` de H12: un árbol de filtro en la URL es largo y no lo valida el `ValidationPipe`. | H12, decisión propia |
| R11 | Respuesta `{ items: [{ rowId, values }], nextCursor, revisionId, schemaVersion }`, como H12. `values` trae todas las columnas pedidas, con `null` explícito. Página por defecto 50, máximo 100. | H10, H12 |
| R12 | Revisión de otra hoja o inexistente → `404 WORKSHEET_REVISION_NOT_FOUND`. Acceso como en E3.1: membresía en el `WHERE`. | C6 |

## Incrementos

1. Migración y modelo Prisma; ensayo con PGlite.
2. Analizador y traductor del filtro, orden y cursor (funciones puras) con sus pruebas.
3. Repositorio y servicio de lectura.
4. Ruta y pruebas e2e.
5. Defectos forzados y regresión completa.

## Comprobación prevista

- Unitarias: cada operador por tipo, límites del árbol, valores mal formados, cursor y hash.
- Integración con filas preparadas: revisión antigua frente a actual, tombstone, vacío frente a null, orden con nulos y empates, `contains` con `%` y `_`, dato mal guardado sin `500`, aislamiento.
- E2E: paginación completa sin repetir ni perder filas; cursor con otro filtro → `400`; `404` de revisión ajena.

## Límites y continuidad

- La proyección actual, los índices de expresión sobre JSONB y el keyset quedan para cuando una medición los pida (H10).
- La restricción de exclusión entre intervalos queda a cargo del escritor de E4.
- Siguiente: E3.3 (validadores de tipos, selección y columnas calculadas).
