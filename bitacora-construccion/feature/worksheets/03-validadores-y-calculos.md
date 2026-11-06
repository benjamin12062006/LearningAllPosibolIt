# 03 — Validadores de celda, columnas de selección y calculadas (E3.3 de la ampliación)

Fecha de creación: 2026-11-04  
Última actualización: 2026-11-05 (verificación de la integración y cierre)  
Estado: Implementado y verificado en local en `feature/integracion-ampliacion`. Las migraciones de hojas figuran aplicadas en Neon en el registro del 2026-11-05.  
Ámbito: [plan 03 de hojas](../../../docs/plans/feature/worksheets/03-plan-e3.3-validadores-y-calculos.md).  
Relacionada con: [fuentes 03](../../../docs/fonts/feature/worksheets/03-fuentes-de-validadores-y-calculos.md), [librerías de cálculo y validación (ficha 04)](../../../docs/fonts/feature/worksheets/04-librerias-de-calculo-y-validacion.md), [bitácora 02](02-filas-por-revision.md).  
Revisión de partida: `23fd7ef` en `feature/worksheets`.

## Necesidad y punto de partida

El usuario pidió seguir con E3.3. Orden seguido: [fuentes](../../../docs/fonts/feature/worksheets/03-fuentes-de-validadores-y-calculos.md) → [plan](../../../docs/plans/feature/worksheets/03-plan-e3.3-validadores-y-calculos.md) → código. El trabajo se interrumpió por el límite de uso con el código escrito y sin pruebas; esta entrada se completó al retomarlo.

Otra sesión dejó la [ficha 04](../../../docs/fonts/feature/worksheets/04-librerias-de-calculo-y-validacion.md), que compara el motor propio con librerías conocidas: 0 diferencias frente a `decimal.js` en casi 50.000 operaciones, y un aviso de que los denominadores crecían sin límite al sumar muchas filas.

## Evidencia y decisiones

| Decisión | Evidencia | Aplicación |
| --- | --- | --- |
| V5 decimal exacto, un solo redondeo | H15, C19, F44, ficha 04 | [exact-decimal.ts](../../../src/worksheets/exact-decimal.ts): fracciones `BigInt`, `round` (`half_up`, `half_even`) y `formatRounded`. |
| Motor `calc-v1` sin `eval` | H15 | [formula.ts](../../../src/worksheets/formula.ts): `calculate` recorre el árbol ya validado. |
| V1–V4, V11 planificar columnas | H14, H15, C20 | [column-plan.ts](../../../src/worksheets/column-plan.ts): `planColumns` con `ColumnPlanner` (nombres repetidos, opciones, fórmula con nombres → IDs, límites, ciclos). |
| V7 validador de celda | H17, H11 | [cell-values.ts](../../../src/worksheets/cell-values.ts): `isCanonicalValue` recibe la columna y `cellProblem`. |
| V6, V8 calculadas y problemas al leer | H14, H17 | [row-evaluation.ts](../../../src/worksheets/row-evaluation.ts): `evaluateRow`; la lectura de filas añade `problems` a cada fila. |
| V8–V9 filtros | H10 | Selección filtrable por ID de opción; calculada no filtrable ni ordenable (`ROW_SORT_UNSUPPORTED`). |
| V10 persistencia | H14 | [migración](../../../prisma/migrations/20261104100000_add_worksheet_column_rules/migration.sql): `options`, `formula` y sus `CHECK`; `findColumnsIn`, compartida por la lectura de hoja y de filas. |

### Ajustes al escribir el código

- **Fracciones simplificadas por MCD** después de cada operación (aviso de la ficha 04). Vale para cualquier denominador, no solo para potencias de 10. Una suma de 5.000 importes deja el denominador en, como mucho, 4 dígitos (probado).
- **Una calculada que lee a otra usa su valor ya redondeado**, el que se ve en la hoja. Así `(1/3 → 0,33) × 3 = 0,99`, no 1,00. Decisión propia; se anota por si E4 la revisa.
- **No se añadió `decimal.js`.** La ficha 04 propone instalarla solo para pruebas, como comparación permanente. Cambia `package.json` y el lockfile, que comparten otras sesiones; se deja como propuesta.
- **La fábrica `buildNewWorksheet` recibe columnas ya planificadas.** La comprobación de nombres repetidos pasó a `planColumns`; `new-worksheet.spec.ts` se sustituyó por `column-plan.spec.ts`, que cubre los mismos casos y más.
- **Ternario anidado** al guardar el resultado de una calculada, sustituido por la función `toOutcome`, según la skill de legibilidad.

## Implementación y funcionamiento

Crear una hoja acepta ahora:

```json
{ "name": "Estado", "type": "selection", "options": [{ "label": "Nuevo" }, { "label": "Usado" }] }
{ "name": "Margen", "type": "calculated",
  "formula": { "expression": { "op": "div", "args": [
      { "op": "sub", "args": [{ "column": "Precio" }, { "column": "Costo" }] },
      { "column": "Precio" } ] }, "scale": 2, "rounding": "half_up" } }
```

La respuesta devuelve las opciones con su ID y la fórmula con IDs de columna y `engine: "calc-v1"`. Al leer filas, cada elemento es `{ rowId, values, problems }`.

Códigos nuevos (es/en), todos dentro de `issues` o `problems`: `COLUMN_OPTIONS_INVALID`, `COLUMN_FORMULA_INVALID`, `COLUMN_FORMULA_REFERENCE_INVALID`, `COLUMN_FORMULA_CYCLE`, `CELL_REQUIRED`, `CELL_VALUE_INVALID`, `CALC_DIVISION_BY_ZERO`, `CALC_INPUT_INVALID` y `ROW_SORT_UNSUPPORTED`.

## Comprobación

En una copia aislada del backend.

| Comprobación | Resultado |
| --- | --- |
| `pnpm build`, `pnpm lint`, `pnpm format:check` | Correctos y sin avisos. |
| `pnpm test:features` completo | 63 suites y 1106 pruebas en verde (incluye el trabajo de otras sesiones presente en la copia). |
| `pnpm db:verify` y `pnpm users:verify` | Correctos. |
| `prisma migrate diff` | Migración vacía. |
| Suites de hojas | 105 pruebas en verde: motor exacto (incluidos `0.1 + 0.2 = 0.30`, redondeos con negativos y la suma de 5.000 filas), planificador, evaluación con los cuatro cálculos de H15 y e2e de creación y lectura. |
| M18: `half_even` igual que `half_up` | 3 pruebas fallan. |
| M19: sin simplificar fracciones | 1 prueba falla. |
| M20: sin detectar ciclos | 2 pruebas fallan. |
| M21: usar el valor guardado de una calculada | 1 prueba falla. |
| M22: dividir entre cero da 0 | 2 pruebas fallan. |
| M23: cualquier texto vale como opción | 2 pruebas fallan. Restaurado: 105/105. |

Pruebas existentes que cambiaron: la aserción exacta de una fila en `worksheet-rows.e2e-spec.ts` (ahora con `problems: []`), `row-query.spec.ts` (`isCanonicalValue` recibe la columna), las dos de integración que construían hojas (usan el ayudante `newWorksheet`), la lista de migraciones y el recuento de `projects.repository.int-spec.ts` (de 20 a 21).

### Verificación de la integración

La exportación preparada para `feature/integracion-ampliacion` compiló con TypeScript y Nest. Pasaron Oxlint, Prettier, la validación de Prisma, las 69 suites de Jest con 1.159 pruebas y las 11 comprobaciones Node de usuarios, conexión y migraciones. Prisma devolvió una migración vacía al comparar el esquema con las 25 migraciones en PGlite.

En otra copia, quitar la simplificación por MCD hizo fallar una prueba. Devolver cero al dividir entre cero hizo fallar dos. Al restaurar el código, volvieron a pasar las 20 pruebas de aritmética y evaluación de filas.

La rama incluye el esquema y las migraciones de E3.3 y E4 para reflejar lo registrado en Neon. El código de borradores, aprobaciones y revisiones se guarda por separado.

## Consecuencias y continuidad

- Las hojas admiten selección y calculadas; los cálculos son exactos y el servidor los hace siempre.
- Filtrar u ordenar por una calculada espera a que E4 guarde sus resultados. Cambiar el esquema de una hoja (renombrar, borrar o cambiar tipo con dependencias) es también de E4.
- Con E3.3 se cierra el núcleo de hojas en la API. Los borradores y las revisiones se retoman en E4.
