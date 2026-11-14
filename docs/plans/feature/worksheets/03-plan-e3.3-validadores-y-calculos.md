# 03 — E3.3: validar celdas, columnas de selección y columnas calculadas

Fecha de creación: 2026-11-04  
Última actualización: 2026-11-05 (fracciones simplificadas por MCD y verificación de la integración)  
Estado: Plan cerrado en `feature/integracion-ampliacion`. Implementado y verificado en local ([bitácora 03](../../../../bitacora-construccion/feature/worksheets/03-validadores-y-calculos.md)).  
Ámbito: `LearningAllPosibolIt`, solo backend y REST. Tercera microentrega de E3 ([18](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md)).  
Relacionada con: [fuentes 03](../../../fonts/feature/worksheets/03-fuentes-de-validadores-y-calculos.md), [plan 02](02-plan-e3.2-filas-por-revision.md), [bitácora 02](../../../../bitacora-construccion/feature/worksheets/02-filas-por-revision.md).  
Revisión de referencia: `23fd7ef` en `feature/worksheets`.

## Objetivo

1. Una hoja admite dos tipos más: **selección** (opciones con ID estable) y **calculada** (fórmula sobre otras columnas).
2. Al crear la hoja se rechaza una fórmula que nombra columnas inexistentes o no numéricas, que forma un ciclo o que pasa los límites (H15, C20).
3. Las calculadas se evalúan en el servidor con decimal exacto y un redondeo declarado en la columna; dividir entre cero da `null` y un problema explícito (H15, C19, F44).
4. Al leer filas, cada fila trae sus problemas: obligatoria vacía, valor sin forma canónica, opción inexistente, división entre cero (H17).
5. Los validadores y el motor son funciones puras que reutilizará el escritor de E4 (H13).

## Decisiones

| ID | Decisión | Respaldo |
| --- | --- | --- |
| V1 | `selection`: de 1 a 100 opciones con etiqueta de 1 a 120 caracteres, únicas sin distinguir mayúsculas. El servidor da a cada opción un UUID; la celda guarda ese ID. | H14 |
| V2 | `calculated`: `{ expression, scale, rounding }`. `expression` es un árbol de `{ op: add | sub | mul | div, args: [a, b] }`, `{ column }` y `{ value: "decimal" }`. Escala de 0 a 6; redondeo `half_up` o `half_even`. Como mucho profundidad 5 y 25 nodos. | H14, H15 |
| V3 | En la petición la fórmula nombra columnas por su **nombre** (todavía no tienen ID); el servidor las resuelve y guarda IDs. Renombrar después no rompe la fórmula (T06). | H14, H16 |
| V4 | Una fórmula solo usa columnas `integer`, `decimal` o `calculated`; el grafo de calculadas no puede tener ciclos (incluida la autorreferencia), comprobado por recorrido en profundidad con nodos «en visita». | H15, C20 |
| V5 | Motor `calc-v1`: fracciones exactas `BigInt` (numerador y denominador), simplificadas por MCD tras cada operación (ajuste «en E3.3», ficha 04); suma, resta, producto y cociente sin perder nada; un solo redondeo al final con la escala y la regla de la columna. Entrada nula → resultado nulo sin problema; entrada sin forma canónica → nulo con `CALC_INPUT_INVALID`; denominador cero → nulo con `CALC_DIVISION_BY_ZERO`. | H15, C19, F44 |
| V6 | Una calculada no es obligatoria ni se guarda en las celdas: su valor sale del motor. Si una celda guardada trae un valor para ella, se ignora. | H14 «resultado separado del literal» |
| V7 | Validador de celda `cellProblem`: obligatoria sin valor → `CELL_REQUIRED`; valor sin forma canónica (incluida una opción que no existe) → `CELL_VALUE_INVALID`. | H17, H11 |
| V8 | La lectura de filas añade `problems: [{ columnId, code, message }]` a cada fila y los valores de las calculadas. Filtrar u ordenar por una calculada → `400` (`ROW_FILTER_OPERATOR_INVALID` / `ROW_SORT_UNSUPPORTED`): en SQL no existen hasta que E4 guarde sus resultados. | H14, H15 |
| V9 | Filtros sobre selección: `equals`, `not_equals`, `in` e `is_null`, con IDs de opción de esa columna. | H10 |
| V10 | Columnas `options` y `formula` (JSONB) en `worksheet_column_versions`, con `CHECK` de que cada una existe solo en su tipo y de que una calculada no es obligatoria. | H14 |
| V11 | Errores de definición en `VALIDATION_FAILED` con un `issue` por problema: `COLUMN_OPTIONS_INVALID`, `COLUMN_FORMULA_INVALID`, `COLUMN_FORMULA_REFERENCE_INVALID`, `COLUMN_FORMULA_CYCLE`. | Patrón de E3.1 |

## Incrementos

1. Motor de cálculo exacto y validador de celdas, con sus pruebas.
2. Planificador de columnas: nombres, opciones, fórmulas, referencias y ciclos.
3. Migración y persistencia de opciones y fórmulas.
4. Lectura: valores calculados, problemas y filtros de selección.
5. Pruebas de integración, e2e, defectos forzados y regresión completa.

## Comprobación prevista

- Unitarias: los cuatro cálculos de H15 con importes exactos (`0.1 + 0.2 = 0.30`), redondeos `half_up` y `half_even` en positivos y negativos, división entre cero, ciclos directos e indirectos, límites del árbol.
- Integración/e2e: crear hojas con selección y calculadas; fórmula guardada con IDs; leer filas con márgenes, división entre cero y problemas; filtro por opción; `400` al filtrar u ordenar por una calculada.

## Límites y continuidad

- Cambiar el esquema (renombrar, borrar o cambiar el tipo de una columna con dependencias) es una operación de borrador de E4; allí se usará la detección de dependencias de este plan.
- Guardar los resultados de las calculadas para filtrar y ordenar por ellas: E4.
- Con E3.3 se cierra E3. Siguiente: E4 (borradores, revisiones y conflictos), que depende también de los recibos de E2.
