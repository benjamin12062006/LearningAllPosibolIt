# 01 — Motor de evaluación puro (E1)

Fecha de creación: 2026-10-31  
Estado: Implementado y verificado. Pruebas unitarias del motor; la integración con base de datos y HTTP corresponde a E2–E4.  
Ámbito: etapa E1 del [plan 01](../../../docs/plans/feature/rulesets&evaluations/01-plan-rulesets-y-evaluations.md):
- tipos de reglas y comprobación de referencias;
- perfil `google_merchant` v1 y precios;
- evaluación por fila;
- conteos y suma de comprobación.

Sin Nest, Prisma, HTTP ni disco.  
Relacionada con: [plan 01](../../../docs/plans/feature/rulesets&evaluations/01-plan-rulesets-y-evaluations.md) (D2, D4–D7), [estado real](../../../docs/fonts/feature/rulesets&evaluations/01-estado-real-y-antecedentes.md), [fuentes técnicas](../../../docs/fonts/feature/rulesets&evaluations/02-fuentes-tecnicas.md), [cursos y reconstrucciones](../../../docs/fonts/feature/rulesets&evaluations/03-cursos-y-reconstrucciones.md).  
Revisión de partida: `1f0be2d`, con 53 archivos modificados sin commit.

## Necesidad y punto de partida

El usuario pidió empezar E1. No existía ningún módulo `evaluations` ni tipo de regla.

Línea base antes de tocar código: `pnpm test:features:unit` → 9 suites y 113 pruebas en verde. Se usó Node 26.9.0, el del `pnpm` local; el proyecto fija 24.19.0 y esa versión no está instalada en este equipo.

## Evidencia y decisiones

Las decisiones vienen del plan; aquí solo se anota cómo se aplicaron y qué cambió al escribir el código.

| Decisión | Evidencia | Aplicación |
| --- | --- | --- |
| Motor como función pura que devuelve objetos nuevos (D5) | RC7 (función pura, lo variable por parámetro), RC8 (recorrido fijo con la operación recibida) | `evaluateRow` no lee hora, base ni disco, y no modifica `row`. Cada regla devuelve un objeto de valores nuevo. Hay una prueba que compara la fila antes y después. |
| Unión discriminada de reglas (D3, D5) | RC6 | `Rule = CleanTextRule \| BuildTitleRule \| ExcludeWhenRule`. `applyRules` usa `switch (rule.type)` con una rama `never` (`unknownRule`), y TypeScript falla si se añade un tipo sin tratarlo. Registro de manejadores (C10, C11) descartado, como dice D5. |
| Exclusión como predicado que detiene la fila (D4, D7) | RC9 | `exclude_when` devuelve `excluded` con la posición de la regla. Una fila excluida no se valida. |
| NFC al limpiar texto (D4) | F26 | `cleanText` = `normalize('NFC')` y después colapsar espacios. NFKC descartado. |
| Precio como texto (D6) | F1 RNF04, F2 inv. 2, C12 como contraste | `normalizePrice` usa una expresión regular y operaciones de texto; nunca `Number`. Acepta los espacios alrededor; lo demás se rechaza sin adivinarlo. |
| Límites y valores del perfil (D6) | F19 | `MAX_LENGTHS`, disponibilidad, estado y protocolos web en constantes con nombre. |
| Serialización canónica para la suma (D9) | F21 (un objeto JSON no tiene orden) | Cada fila se serializa como arreglo, con los atributos en el orden de `PRODUCT_ATTRIBUTES`. |

**Ajustes al plan descubiertos al implementar** (marcados «en E1» en el plan):

1. **El mapeo admite 8 pares, no 9:** el perfil v1 tiene 8 atributos mapeables.
2. **`id` ≤ 50 caracteres:** F19 lo exige y el plan no lo validaba. Se añade el problema `TEXT_TOO_LONG` en `id`.
3. **La sugerencia no va en el problema:** el motor devuelve `{ attribute, code }`, y el texto es/en se genera en E4. Así el motor no depende del idioma.
4. **`value` de `exclude_when`:** pasa a 1–200 caracteres, y vacío con `is_empty`. Con `contains`, un valor vacío excluiría todas las filas.
5. Además, el perfil no se pasa como parámetro a `evaluateRow`. Hay uno solo, y pasarlo sería una abstracción sin uso (regla 10 de la skill de código legible).

**Decisión propia sobre cómo contar caracteres:**
- Se cuentan puntos de código (`[...value].length`). El linter (`no-misused-spread`) propone `Intl.Segmenter`, pero sus reglas dependen de la versión de ICU de Node y el conteo podría cambiar al actualizar Node, lo que rompe RNF02.
- Coste aceptado: un emoji compuesto (👨‍👩‍👧) cuenta como varios caracteres.
- La regla se desactiva solo en esa línea, con el motivo en el comentario. F19 no precisa la unidad.

## Implementación y funcionamiento

```text
fila importada ─▶ readMappedAttributes ─▶ applyRules (en orden) ─┬─▶ excluded
                                                                 └─▶ findProductProblems ─▶ valid / invalid
                                                                     withNormalizedPrice
resultados en orden de sourceRow ─▶ EvaluationSummary.add ─▶ finish(): conteos + SHA-256
```

| Archivo | Símbolos | Responsabilidad |
| --- | --- | --- |
| [price.ts](../../../src/evaluations/engine/price.ts) | `normalizePrice`, `PRICE_PATTERN` | `1234.5` o `1234.5 USD` → `1234.50 USD`. Códigos `PRICE_FORMAT_INVALID`, `PRICE_CURRENCY_MISMATCH` y `PRICE_ZERO`. |
| [google-merchant.profile.ts](../../../src/evaluations/engine/google-merchant.profile.ts) | `PROFILE_VERSION`, `PRODUCT_ATTRIBUTES`, `REQUIRED_ATTRIBUTES`, `CLEANABLE_ATTRIBUTES`, `findProductProblems`, `withNormalizedPrice`, `isProductAttribute`, `isBlank` | Perfil v1. Como mucho un problema por atributo y en orden fijo. Las URL se analizan con `URL.parse` y solo admiten `http:` y `https:`, sin espacios. |
| [ruleset.ts](../../../src/evaluations/engine/ruleset.ts) | `Rule`, `Ruleset`, `RULE_TYPES`, `EXCLUDE_OPERATORS`, `findRulesetIssues`, `templatePlaceholders` | Tipos de dominio que E2 reutilizará en el DTO. Al guardar, comprueba los mapeos duplicados, las referencias por posición (el `title` creado por `build_title` solo cuenta para las reglas siguientes) y los obligatorios. |
| [evaluate-row.ts](../../../src/evaluations/engine/evaluate-row.ts) | `ENGINE_VERSION`, `evaluateRow`, `RowOutcome`, `EvaluationContext` | Los pasos con nombre de la figura anterior. Lee las columnas con `Object.hasOwn`, para que nombres como `__proto__` o `constructor` no lleguen al prototipo. |
| [evaluation-summary.ts](../../../src/evaluations/engine/evaluation-summary.ts) | `EvaluationSummary` | Clase pequeña con estado: conteos y hash incremental para los lotes del trabajador de E3. Rechaza filas desordenadas, repetidas o posteriores al cierre, porque la suma depende del orden. |
| [jest.features.config.mjs](../../../jest.features.config.mjs) | `collectCoverageFrom` | Añade `src/evaluations/**` a la cobertura. |

Pruebas en [test/features/evaluations/](../../../test/features/evaluations/), con datos en [support/engine-fixtures.ts](../../../test/features/evaluations/support/engine-fixtures.ts):

| Suite | Qué comprueba |
| --- | --- |
| `price.spec.ts` | Siete formatos aceptados; dieciocho rechazados (`1,50`, `1.234,50`, `$15`, `1e3`, `１５` de ancho completo…); moneda distinta; cero. |
| `ruleset-issues.spec.ts` | Duplicados; obligatorios en orden; título producido frente a título usado antes de existir; marcadores desconocidos o vacíos; condición sobre un atributo sin mapear. |
| `evaluate-row.spec.ts` | Fila válida; la entrada no se modifica; NFC con espacios no separables; el orden de las reglas cambia el resultado; la exclusión detiene; los cuatro operadores; límites 150/5000/70/50 y su +1; emoji; seis URL inválidas; disponibilidad; `condition` opcional; orden de los problemas; columnas `__proto__` y `constructor`. |
| `evaluation-summary.spec.ts` | Invariante de conteo con 500 filas variadas y tres semillas (PRNG mulberry32); misma entrada, mismo resultado y misma suma; la suma cambia con otras reglas o datos; orden obligatorio. |

## Comprobación

| Comando o prueba ejecutada | Resultado observado |
| --- | --- |
| `tsc -p tsconfig.json --noEmit` | Sin errores. |
| `pnpm test:features:unit` | 13 suites y 188 pruebas en verde (113 previas + 75 nuevas). |
| Mutaciones a mano, de una en una y restauradas con `diff` sin diferencias | Quitar NFC → falla 1 prueba. Una exclusión que no detiene → fallan 10. Contar con `length` → falla 1. |
| `pnpm test:features` (unitarias, integración PGlite y E2E) | 19 suites y 300 pruebas en verde. |
| Cobertura de `src/evaluations` (solo unitarias) | 98,8 % de líneas y 95,9 % de ramas. Sin cubrir: la rama imposible `unknownRule`, `readAttribute` con un nombre desconocido y `withNormalizedPrice` sin precio; son defensivas. |
| `pnpm lint` (oxlint con tipos) | Sin avisos, tras desactivar la regla `no-misused-spread` en una sola línea (decisión explicada arriba). |
| `prettier --check` sobre los archivos nuevos | Formato correcto, tras `prettier --write`. |

No se ejecutó con Node 24.19.0, porque no está instalado. El motor todavía no tiene consumidores: nadie lo llama desde HTTP ni desde el trabajador. Eso llega en E2 y E3.

## Consecuencias y continuidad

- E2 reutiliza `RULE_TYPES`, `EXCLUDE_OPERATORS`, `PRODUCT_ATTRIBUTES`, `CLEANABLE_ATTRIBUTES` y `findRulesetIssues` en el DTO y el servicio. Los `RulesetIssueCode` se traducirán a `RULESET_*` (D11).
- E3 usa `evaluateRow` por lote y `EvaluationSummary` para la finalización. Guardará `ENGINE_VERSION` y `PROFILE_VERSION`.
- Cualquier cambio de comportamiento en `evaluate-row.ts` obliga a subir `ENGINE_VERSION`, y en `google-merchant.profile.ts` o `price.ts`, a cambiar `PROFILE_VERSION`. Las pruebas no lo detectan solas.
- No hay commit. Los archivos nuevos siguen sin seguimiento en Git, junto con los 53 cambios previos.
