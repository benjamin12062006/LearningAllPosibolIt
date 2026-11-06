# 04 — Librerías conocidas para el cálculo y la validación de celdas (E3.3)

Fecha de creación: 2026-11-05  
Tipo de fuente: registro de npm, documentación oficial, avisos de seguridad y comparación ejecutada en local.  
Fecha de consulta: 2026-11-05  
Estado: Investigación. No cambia código: la decisión sobre el motor de E3.3 es de su plan.  
Relacionada con: [fuentes 03](03-fuentes-de-validadores-y-calculos.md), [plan 03 de hojas](../../../plans/feature/worksheets/03-plan-e3.3-validadores-y-calculos.md) (V2, V5 y V7), [bitácora 03](../../../../bitacora-construccion/feature/worksheets/03-validadores-y-calculos.md), código [`exact-decimal.ts`](../../../../src/worksheets/exact-decimal.ts) y [`formula.ts`](../../../../src/worksheets/formula.ts).  
Revisión del proyecto: `612b745` (`feature/feeds-publications`), con E3.3 sin commit en el árbol.

## Pregunta

El usuario pidió buscar si existe una librería conocida, eficiente y recomendada, de Nest o general, para los validadores y cálculos de E3.3, en lugar del motor escrito a mano (`calc-v1`: fracciones `BigInt` y un único redondeo final).

## Candidatas (registro de npm, 2026-11-05)

| Paquete | Versión | Licencia | Publicada | Dependencias | Descargas/semana | Uso posible |
| --- | --- | --- | --- | --- | --- | --- |
| `decimal.js` | 10.6.0 | MIT | 2025-07-06 | 0 | 134,7 M | Decimal de precisión arbitraria |
| `bignumber.js` | 11.1.5 | MIT | 2026-07-05 | 0 | 87,3 M | Ídem, del mismo autor |
| `big.js` | 7.0.1 | MIT | 2025-04-21 | 0 | 43,4 M | Versión mínima, sin tipos propios |
| `fraction.js` | 5.3.4 | MIT | 2025-08-22 | 0 | 68,4 M | Fracciones `BigInt` |
| `mathjs` | 15.2.0 | Apache-2.0 | 2026-04-07 | 9 | 5,6 M | Analizador de expresiones + `BigNumber` |
| `hyperformula` | 3.5.0 | **GPL-3.0-only** | 2026-10-09 | 2 | 0,57 M | Motor de fórmulas tipo Excel |
| `@formulajs/formulajs` | 4.6.1 | MIT | 2026-07-28 | 2 | 0,72 M | Funciones de Excel |
| `expr-eval` | 2.0.2 | MIT | **2019-09-28** | 0 | 0,56 M | Analizador de expresiones |
| `jsep` | 1.6.0 | MIT | 2026-10-11 | 0 | 18,5 M | Solo analiza expresiones a un árbol |
| `ajv` | 8.20.0 | MIT | 2026-04-24 | 4 | 516 M | Validación con JSON Schema compilado |
| `zod` | 4.6.7 | MIT | 2026-10-12 | 0 | 452 M | Validación con tipos de TypeScript |
| `valibot` | 1.5.0 | MIT | 2026-09-09 | 0 | 31,8 M | Validación modular |
| `class-validator` | 0.15.1 | MIT | 2026-02-26 | 3 | 16,9 M | La que ya usa Nest en los DTO del proyecto |
| `dinero.js` | 2.0.2 | MIT | 2026-03-13 | 0 | 0,9 M | Dinero con moneda |

## Evidencia

| Id | Fuente | Qué dice |
| --- | --- | --- |
| L1 | [decimal.js, API](https://mikemcl.github.io/decimal.js/) | Modos `ROUND_HALF_UP` (4, «ties away from zero») y `ROUND_HALF_EVEN` (6); `precision` son dígitos significativos (20 por defecto); `div` redondea a esa precisión; `toDecimalPlaces(dp, rm)`; `clone()` crea un constructor con su propia configuración. |
| L2 | [Fraction.js, README](https://github.com/rawify/Fraction.js) | Numerador y denominador `BigInt`; acepta cadenas sin aproximar; `round(places)` usa `Math.round`; lanza una excepción al dividir entre cero. |
| L3 | [math.js, Security](https://mathjs.org/docs/expressions/security.html) | El analizador intenta estar aislado, pero «there are unknown security vulnerabilities» posibles; recomienda desactivar `import`, `createUnit` y `reviver` y ejecutarlo en un worker o proceso aparte. |
| L4 | [NVD, CVE-2025-13204](https://nvd.nist.gov/vuln/detail/CVE-2025-13204) | `expr-eval` hasta la 2.0.2: contaminación del prototipo que permite ejecutar código; publicado el 2025-11-14. NVD remite al paquete comunitario `expr-eval-fork`. |
| L5 | [HyperFormula, licencia](https://handsontable.com/docs/hyperformula/guide/license-key.html) | Dos licencias: GPLv3 (`licenseKey: 'gpl-v3'`) o comercial de pago. |
| L6 | [Ajv, Why Ajv](https://ajv.js.org/guide/why-ajv.html) y [Security](https://ajv.js.org/security.html) | Compila el esquema a funciones JavaScript; trata los esquemas «as trusted as your application code». |

## Comprobación ejecutada en local

Script en la carpeta temporal de la sesión, fuera del proyecto, con Node 26.9.0, `decimal.js@10.6.0` y `fraction.js@5.3.4`. Ejecuta el `exact-decimal.ts` del árbol sin modificarlo.

| Prueba | Resultado |
| --- | --- |
| **Comparación diferencial** con 50.000 operaciones aleatorias (`add`, `sub`, `mul`, `div`; escala de 0 a 6; `half_up` y `half_even`; con negativos y hasta 6 decimales), contra `decimal.js` con 200 dígitos de precisión | 49.952 operaciones (48 divisiones entre cero descartadas), **0 diferencias**, 547 de ellas empates exactos a .5. |
| Redondeo de `fraction.js` | `-2.5 → -2` y `-0.125 → -0.12`: la regla de `Math.round` lleva los empates hacia +∞. No es `half_up` ni `half_even` (V2). |
| `0.1 + 0.2` | `decimal.js`: `0.30`. `number`: `0.30000000000000004` (C19). |
| Margen `(19.99 − 7.455) / 19.99` a 4 decimales, 100.000 veces | Motor propio: 58 ms. `decimal.js`: 295 ms. |
| Suma de 5.000 valores con 1–3 decimales | Mismo resultado (`2485042.48`). Motor propio: 10 ms. `decimal.js`: 4 ms. **El denominador del motor propio llega a 10.000 dígitos**, porque `add` multiplica los denominadores sin simplificar. |

## Interpretación

- **Cálculo por fila (E3.3).** El motor propio da los mismos resultados que la librería de referencia y es unas 5 veces más rápido en una fórmula por fila. Para fórmulas de como mucho 25 nodos (V2), una librería no aporta exactitud ni velocidad.
- **Agregados (sumas de muchas filas en E5 y E8).** El motor propio crece sin límite, porque los denominadores se multiplican. `decimal.js` no tiene ese problema. Antes de usar el motor para totales, hay dos salidas: simplificar los denominadores (con potencias de 10, quedarse con la mayor) o cambiar a `decimal.js`.
- **Fórmulas.** No conviene un analizador de texto:
  - `expr-eval` tiene una vulnerabilidad grave sin parche oficial (L4);
  - `mathjs` pide aislarlo en un proceso aparte (L3);
  - HyperFormula obliga a GPLv3 o a comprar una licencia (L5);
  - `formulajs` calcula con `number`.

  El árbol JSON de V2, con operadores cerrados, es más seguro y no necesita librería. Si algún día el usuario escribe fórmulas como texto, `jsep` solo produce el árbol, sin evaluar nada, y podría convertirse a ese formato.
- **Validación.** Los DTO siguen con `class-validator`, el estándar de Nest que ya usa todo el proyecto. Las reglas de celda (V7) son pocas y propias de cada tipo; una librería no las simplifica. Ajv o Zod solo tendrían sentido si cada hoja definiera un esquema dinámico completo; entonces Zod 4 encaja mejor con TypeScript, y Ajv con esquemas JSON guardados.

## Recomendación

1. **E3.3: mantener `calc-v1`.** Añadir `decimal.js` solo como **dependencia de desarrollo**, para que las pruebas unitarias comparen el motor con ella. Es la misma comparación de esta ficha, convertida en una prueba permanente.
2. **Antes de los agregados** (sumas en exportaciones o en inventario): decidir en su plan entre simplificar los denominadores o usar `decimal.js` (MIT, sin dependencias, la más usada, con los dos modos de redondeo de V2).
3. **No adoptar** `expr-eval`, `mathjs` (en el servidor), HyperFormula ni `fraction.js` para este motor.

## Límites

- Las cifras de rendimiento son de una sola máquina y una sola ejecución: orientan, no son una medición rigurosa.
- La comparación cubre las cuatro operaciones de una en una, no árboles completos de 25 nodos; las pruebas de la bitácora 03 deberán cubrirlos.
