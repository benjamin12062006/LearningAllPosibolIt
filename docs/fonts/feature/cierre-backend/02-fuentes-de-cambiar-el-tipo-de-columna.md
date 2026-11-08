# 02 — Fuentes para cambiar el tipo de una columna (C5, E4.8)

Fecha de creación: 2026-11-08  
Última actualización: 2026-11-08  
Estado: Investigación. Concreta P5 del [plan 01 de cierre](../../../plans/feature/cierre-backend/01-plan-cierre-de-pendientes.md).  
Relacionada con: [fuentes 01, estado de los pendientes](01-estado-de-los-pendientes.md) (E4), [fuentes de cambios de esquema de E4.7](../changesets/02-fuentes-de-cambios-de-esquema.md), [plan de E4](../../../plans/feature/changesets/01-plan-e4-borradores-y-revisiones.md) (D12), [fuentes 01 de imports&exports](../imports&exports/01-fuentes-de-importar-y-exportar-hojas.md) (D4).  
Revisión de partida: `main` `c280506` más C1–C4 sin commit.

## Pregunta

¿Cómo se cambia el tipo de una columna desde un borrador sin truncar, redondear ni borrar valores sin avisar, cuando la hoja puede tener 5.000 filas y un borrador manual admite como mucho 1.000 operaciones?

## Estado real del código

| ID | Archivo y símbolo | Hallazgo | Consecuencia |
| --- | --- | --- | --- |
| E8 | [`changeset-schema.ts`](../../../../src/changesets/changeset-schema.ts) (`planSchema`, `resultingColumns`, `SchemaPlanner`) | E4.7 añade, renombra y borra columnas por su ID, y **nunca reescribe valores de filas**. Valida nombres únicos, límite de columnas y que ninguna fórmula pierda su entrada (`COLUMN_IN_USE`). El comentario de la cabecera deja fuera cambiar el tipo. | La operación nueva se suma aquí: forma, reglas y esquema resultante. |
| E9 | [`cell-values.ts`](../../../../src/worksheets/cell-values.ts) | Forma canónica por tipo: entero y decimal como cadena (`-?\d+`, `-?\d+(\.\d+)?`), fecha civil `YYYY-MM-DD` que exista, booleano, selección por el ID de la opción, texto de hasta 8 KiB. | Convertir es pasar de una forma canónica a otra, y el resultado se comprueba con `isCanonicalValue`. |
| E10 | [`import-plan.ts`](../../../../src/worksheet-imports/import-plan.ts) (`convert`) | E5.1 convierte texto a cada tipo sin redondear ni recortar: decimal con el separador elegido, booleano por etiquetas, selección por la etiqueta exacta. | Las mismas reglas de texto → tipo. `worksheet-imports` depende de `changesets`, así que la conversión vive en `worksheets/`, que es la base de los dos, y no se importa desde las importaciones. |
| E11 | `ChangesetsService.buildReview` y `blockingProblems` | Los problemas que bloquean enviar (`CELL_REQUIRED`, `CELL_VALUE_INVALID`) se calculan solo sobre las filas que el borrador menciona. | Cambiar el tipo afecta a **todas** las filas con valor en esa columna: la revisión tiene que leerlas todas. |
| E12 | `normalizeOperations` (límite de E4) y [12], línea 60 | Un guardado manual admite 1.000 operaciones y 1 MiB; una hoja, 5.000 filas. | La conversión no se guarda como un `set_cell` por fila: se calcula a partir de la revisión base al revisar y al aplicar. Así el borrador sigue siendo pequeño, y el mismo cálculo da la misma vista previa y el mismo resultado. |
| E13 | `writeRevision` y `rowWrites` ([`changesets.repository.ts`](../../../../src/changesets/changesets.repository.ts)) | `apply` escribe cada fila mencionada aplicando sus operaciones en orden sobre su valor en la cabecera, que está bloqueada y es la base (`lockHeadOrThrow`). `rowWrites` ya encadena varios `set_cell` sobre la misma fila. | En `apply`, la conversión entra como `set_cell` calculados después de los del usuario, sobre las filas que se leen con la cabecera bloqueada. |
| E14 | `ChangesetsService.rebase` | Rebasar vuelve a normalizar las operaciones contra la cabecera nueva. | Si la cabecera cambió esa columna, la operación se revalida contra el tipo nuevo, y la vista previa se recalcula sobre la base nueva: no se pierde ninguna edición posterior. |
| E15 | [`column-plan.ts`](../../../../src/worksheets/column-plan.ts) | Una calculada solo puede leer columnas numéricas (`NUMERIC_COLUMN_TYPES`; si no, `COLUMN_FORMULA_REFERENCE_INVALID`). | Si una calculada lee la columna, el tipo nuevo tiene que seguir siendo entero o decimal. |

## Requisitos

| ID | Documento y pasaje | Qué exige |
| --- | --- | --- |
| H3 | [12], «Identidad y tipos de celda» | «Una conversión de tipo previsualiza cada valor incompatible; nunca trunca, redondea o borra silenciosamente.» |
| H4 | [13], línea 73 | Un tipo o una columna cambiados frente a una edición es un conflicto estructural, no una celda vacía. |
| H8 | [12], línea 60 | 5.000 filas, 200 columnas; un borrador manual, hasta 1.000 operaciones y 1 MiB. |

## Reglas de conversión decididas

Cada valor guardado pasa primero a su **texto visible** (el mismo que exporta E5.3: decimal canónico, `YYYY-MM-DD`, `true`/`false`, la etiqueta de la opción) y ese texto se lee con las reglas estrictas de E5.1 para el tipo nuevo. Sin recortar espacios y sin redondear.

| De \ a | Texto | Entero | Decimal | Fecha | Booleano | Selección |
| --- | --- | --- | --- | --- | --- | --- |
| Texto | — | `-?\d+` | `-?\d+(\.\d+)?` con punto | fecha civil que exista | `true` / `false` | etiqueta exacta |
| Entero | su texto | — | igual | ✗ | ✗ | etiqueta exacta |
| Decimal | su texto | solo si la parte decimal es toda ceros (`10.00` → `10`) | — | ✗ | ✗ | etiqueta exacta |
| Fecha | su texto | ✗ | ✗ | — | ✗ | etiqueta exacta |
| Booleano | `true` / `false` | ✗ | ✗ | ✗ | — | etiqueta exacta |
| Selección | su etiqueta | si la etiqueta es entera | si la etiqueta es decimal | si la etiqueta es fecha | si la etiqueta es `true`/`false` | — (no se cambia de selección a selección) |

- **✗ y cualquier valor que no encaje son incompatibles.** También un texto vacío (`""`) hacia un tipo que no es texto: vaciar una celda es una decisión de la persona, no de la conversión.
- **`10.00` → `10` no redondea**: el valor es el mismo. `10.50` → entero es incompatible.
- **Una celda vacía sigue vacía.**

## Alternativas

| Alternativa | Por qué no |
| --- | --- |
| Guardar la conversión como un `set_cell` por fila | Pasa del límite de 1.000 operaciones de un borrador manual con una hoja normal (E12), y la vista previa quedaría congelada aunque la base cambie al rebasar. |
| Vaciar los incompatibles al aplicar | Prohibido por H3: es borrar sin avisar. |
| Elegir la conversión con opciones (separador, etiquetas, redondeo) | Ninguna decisión lo pide. Para un caso concreto, la persona corrige esas celdas con `set_cell` en el mismo borrador. |
| Reutilizar `convert` de E5.1 tal cual | Está en `worksheet-imports`, que depende de `changesets`: importarla al revés crearía un ciclo. Además, trata `""` como vacío, y aquí `""` es un valor. |

## Mapa

| Necesidad | Requisito | Hallazgo | Decisión (bitácora C5) |
| --- | --- | --- | --- |
| Operación y reglas de esquema | H3 | E8, E15 | Operación `change_column_type` |
| Qué se convierte y cómo | H3 | E9, E10 | Tabla de arriba, en `worksheets/cell-conversion.ts` |
| Vista previa de cada incompatible | H3, H8 | E11, E12 | Revisión sobre todas las filas con valor en la columna |
| Aplicar sin perder nada | H3 | E13 | Conversión en `apply` con la cabecera bloqueada |
| Cambios en la cabecera | H4 | E14 | Rebase revalida y recalcula |
