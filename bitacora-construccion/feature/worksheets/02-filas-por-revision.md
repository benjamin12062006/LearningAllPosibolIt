# 02 — Filas de una revisión con filtros, orden y cursor (E3.2 de la ampliación)

Fecha de creación: 2026-11-04  
Estado: Implementado y verificado en local; confirmado en la rama `feature/worksheets`. Migración sin aplicar en Neon.  
Ámbito: [plan 02 de hojas](../../../docs/plans/feature/worksheets/02-plan-e3.2-filas-por-revision.md).  
Relacionada con: [bitácora 01](01-libro-y-hoja-vacia.md), [fuentes 02](../../../docs/fonts/feature/worksheets/02-fuentes-de-filas-por-revision.md), [hojas tipadas](../../../../docs-diagrams/12-hojas-modelo-editor-importacion-y-exportacion.md).  
Revisión de partida: `8a32dfb` en `feature/organizations-access`, con E3.1 sin commit.

## Necesidad y punto de partida

El usuario pidió seguir con E3.2. Orden seguido: [fuentes](../../../docs/fonts/feature/worksheets/02-fuentes-de-filas-por-revision.md) → [plan](../../../docs/plans/feature/worksheets/02-plan-e3.2-filas-por-revision.md) → código. Las consultas de documentación oficial se cortaron una vez por el límite de uso y se repitieron cuando el usuario lo pidió; ninguna fuente se citó sin leerla.

E3.1 dejó hojas con esquema y revisión 1 vacía. No había filas ni forma de escribirlas, y sigue sin haberla: esta entrega solo lee. Las pruebas preparan filas con SQL directo ([row-fixtures.ts](../../../test/features/worksheets/support/row-fixtures.ts)).

## Evidencia y decisiones

| Decisión | Evidencia | Aplicación |
| --- | --- | --- |
| R1–R2 versiones de fila por intervalo, una sola vigente | H8, H9, F43, F29 | [migración](../../../prisma/migrations/20261104090000_create_worksheet_row_versions/migration.sql): `worksheet_row_versions` con FK de las dos secuencias a revisiones de la misma hoja e índice único parcial `worksheet_row_versions_one_open`. |
| R3 origen `changeset` | H7 | La misma migración amplía el `CHECK` de `worksheet_revisions.source`. |
| R4 valores canónicos | H11 | [cell-values.ts](../../../src/worksheets/cell-values.ts): `isCanonicalValue` (incluye fechas imposibles como `2026-02-30`) y los patrones en SQL. |
| R5–R6 filtro como árbol validado | H10, C17, C18 | [row-query.ts](../../../src/worksheets/row-query.ts): `parseRowQuery` con un objeto `RowQueryParser` que acumula problemas y cuenta predicados. |
| R7 SQL parametrizado y seguro ante datos mal guardados | F40, F41, C18 | [row-query-sql.ts](../../../src/worksheets/row-query-sql.ts): `whereSql`, `cellSql` con `CASE … ~ patrón` y `strpos` para `contains`. |
| R8 orden determinado | F42 | `orderSql`: `NULLS LAST` y desempate por `sort_key` y `row_id`. |
| R9 cursor por revisión, consulta y desplazamiento | H10, C16, «Decisión del cursor» | [row-cursor.ts](../../../src/worksheets/row-cursor.ts): `encodeRowCursor`, `decodeRowCursor` y `hashRowQuery`. |
| R10–R12 ruta y respuesta | H12, C6 | `POST P/worksheets/:worksheetId/rows/query` en [worksheets.controller.ts](../../../src/worksheets/worksheets.controller.ts); [worksheet-rows.service.ts](../../../src/worksheets/worksheet-rows.service.ts) y [worksheet-rows.repository.ts](../../../src/worksheets/worksheet-rows.repository.ts). |

### Ajustes al escribir el código

- **`not_equals` sin `IS NOT NULL` explícito.** En SQL `null <> x` no es verdadero, así que los nulos ya quedan fuera. Se dejó un comentario junto a los operadores en lugar de la condición repetida.
- **Tipos sin `as`.** El cursor y la lista de `in` se estrechan con predicados con nombre (`isRowCursor`, `isValidOffset`, `isLiteralList`), según la skill de legibilidad.
- **Servicio y repositorio propios para filas**, en el mismo módulo, para no mezclar la lectura de filas con la creación de libros y hojas.

## Implementación y funcionamiento

`POST /api/v1/organizations/:organizationId/projects/:projectId/worksheets/:worksheetId/rows/query`

```json
{
  "revisionId": "opcional; sin él, la actual",
  "filter": { "and": [{ "column": "<columnId>", "op": "gt", "value": "10" }] },
  "sort": [{ "columnId": "<columnId>", "direction": "desc" }],
  "columns": ["<columnId>"],
  "cursor": "opcional, de la página anterior",
  "limit": 50
}
```

Responde `200 { items: [{ rowId, values }], nextCursor, revisionId, schemaVersion }`.

Flujo: acceso al proyecto → cursor (si llega) → revisión (la del cursor, la pedida o la actual) → columnas de su esquema → análisis del filtro (`400` con `issues`) → comparación del hash con el cursor → consulta con una fila de más para saber si hay otra página.

Códigos nuevos (es/en): `WORKSHEET_REVISION_NOT_FOUND` (404), `WORKSHEET_CURSOR_INVALID` (400) y, dentro de `issues`, `ROW_FILTER_INVALID`, `ROW_FILTER_COLUMN_UNKNOWN`, `ROW_FILTER_OPERATOR_INVALID` y `ROW_FILTER_VALUE_INVALID`.

## Comprobación

En una copia aislada del backend.

| Comprobación | Resultado |
| --- | --- |
| `pnpm build`, `pnpm lint`, `pnpm format:check` | Correctos y sin avisos. (Un aviso intermedio de lint en `feeds.service.ts`, de la otra sesión, ya no aparece en la copia final.) |
| `pnpm test:features` completo | 60 suites y 1048 pruebas en verde (incluye el trabajo de feeds presente en la copia). |
| `pnpm db:verify` y `pnpm users:verify` | Correctos. |
| `prisma migrate diff` | Migración vacía. |
| Suites de hojas | 63 pruebas en verde (E3.1 y E3.2). |
| M12: `contains` con `LIKE` | 1 prueba falla (`%` y `_` dejan de ser texto). |
| M13: sin límite superior del intervalo | 3 pruebas fallan (la revisión antigua ve filas cerradas). |
| M14: sin tombstones | 3 pruebas fallan (la fila borrada reaparece). |
| M15: convertir a número sin proteger datos mal guardados | 3 pruebas fallan (el precio `abc` rompe la consulta). |
| M16: aceptar un cursor con otra consulta | 1 prueba falla. |
| M17: sin `NULLS LAST` | 1 prueba falla. Restaurado: 63/63. |

Pruebas existentes que cambiaron: la lista de migraciones y el recuento de `projects.repository.int-spec.ts` (de 19 a 20).

No verificado: rendimiento con 5.000 filas y concurrencia real (PGlite).

## Consecuencias y continuidad

- Cualquier revisión se lee tal como era, con filtros tipados y páginas que no cambian de revisión.
- Todavía no hay forma de escribir filas: llega con los borradores de E4 y la importación de E5.
- Siguiente: E3.3 (validadores de tipos, columnas de selección y calculadas).
