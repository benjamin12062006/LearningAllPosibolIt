# 03 — Fuentes para validar celdas, columnas de selección y columnas calculadas (E3.3)

Fecha de creación: 2026-11-04  
Estado: Investigación que respalda el [plan 03](../../../plans/feature/worksheets/03-plan-e3.3-validadores-y-calculos.md).  
Relacionada con: [ficha 02](02-fuentes-de-filas-por-revision.md), [ficha 01](01-fuentes-de-la-hoja-vacia.md), [hojas tipadas](../../../../../docs-diagrams/12-hojas-modelo-editor-importacion-y-exportacion.md), [secuencia](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md).

## Requisitos de la ampliación

| ID | Documento y pasaje | Qué exige |
| --- | --- | --- |
| H13 | [18](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md), microentrega E3.3 y fila E3 | «E3.3 validadores de tipos/cálculos»; «funciones puras de edición/cálculo». |
| H14 | [12](../../../../../docs-diagrams/12-hojas-modelo-editor-importacion-y-exportacion.md), tabla de tipos | Selección: «ID de opción estable; renombrar etiqueta no altera valores». Calculada: «AST restringido de operadores permitidos, versión y columnas por ID; resultado separado del literal». |
| H15 | [12](../../../../../docs-diagrams/12-hojas-modelo-editor-importacion-y-exportacion.md), «Lectura, búsqueda y cálculos» | Cálculos iniciales: costo×cantidad, precio×cantidad, beneficio bruto y margen `(venta-costo)/venta`; «precio cero produce valor no definido y problema explícito, no infinito». «Decimal exacto y reglas de redondeo explícitas, mismo motor versionado en servidor. Referencias por columnId, grafo acíclico y límites de profundidad/operaciones. No ejecutar `eval`, JavaScript, SQL ni fórmulas externas.» |
| H16 | [18](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md), T04 y T06 | T04: «Importes exactos, null/vacío, fechas locales, SKU con ceros». T06: «Renombrar columna conserva referencias; eliminar/cambiar tipo detecta dependencias». |
| H17 | [12](../../../../../docs-diagrams/12-hojas-modelo-editor-importacion-y-exportacion.md), «Dos modos» | Una hoja libre «Puede contener datos incompletos en un borrador. Publicar una revisión exige validar sus restricciones.» |

## Cursos

Consulta: 2026-11-04. Rutas relativas a la biblioteca `/Users/benji/Documents/chrome-extencions/trancripciones/`. Sin reconstrucción: ninguno usa TypeScript ni este dominio; se toman los principios.

| ID | Curso, lección y localizador | Evidencia | Uso |
| --- | --- | --- | --- |
| C19 | **Foundation course on Embedded C programming using STM32 Microcontroller for firmware engineers**, `C/C Embebido con STM32/Sección 11 Data types to manipulate floating point data/68. Single vs double precision.md`, línea 15; búsqueda «the number will be approximated» | En IEEE-754 el número «will be approximated and it will be saved in the memory». | Los importes no pasan nunca por `number` de JavaScript (también IEEE-754): el motor usa fracciones exactas de enteros `BigInt` y redondea una sola vez, al final, con la regla de la columna. |
| C20 | **The modern Lua course for everyone!**, `Lua/Lua de Cero a Experto/Sección 22 Solved Problems - Depth First Search - Graphs/75. Problem 3 - Forest.md`, líneas 13 y 25; búsqueda «a forest is a graph without cycles» | El recorrido en profundidad decide si un grafo tiene ciclos. | Adaptación: el grafo de columnas calculadas es dirigido; el recorrido marca los nodos «en visita» y un nodo que se reencuentra en visita es un ciclo. |

## Documentación oficial

Consulta: 2026-11-04.

| ID | Fuente | Evidencia | Uso |
| --- | --- | --- | --- |
| F44 | [MDN — BigInt](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt) | Representa enteros fuera del rango seguro de `number`; «Division (`/`) truncates fractional components towards zero»; no se mezcla con `number` en operaciones. | El cociente de `BigInt` trunca hacia cero: el redondeo `half_up` y `half_even` se hace a mano con el resto. Todas las operaciones del motor son `BigInt` con `BigInt`. |

## Evidencia del proyecto

- [cell-values.ts](../../../../src/worksheets/cell-values.ts): formas canónicas de E3.2; los validadores las reutilizan.
- [row-query.ts](../../../../src/worksheets/row-query.ts): patrón de analizador puro que acumula `issues` con su campo; las definiciones de columna siguen el mismo patrón.

## Límites

Las fuentes no fijan la sintaxis JSON de la fórmula, los límites concretos (profundidad 5, 25 nodos, escala 0–6) ni los nombres de los problemas: son propuesta propia sobre H14–H15.
