# 03 — Perfil de Google v2026-11-01: valores que no caben en un TSV (E3)

Fecha de creación: 2026-11-01  
Estado: Implementado y verificado. Pruebas unitarias, de integración y E2E existentes; la exportación que se apoya en estas versiones corresponde a E5.  
Ámbito: etapa E3 del [plan 01](../../../docs/plans/feature/reviews&exports/01-plan-reviews-y-exports.md): dos problemas nuevos del perfil `google_merchant` (D5), nueva `PROFILE_VERSION` y, como ajuste, nueva `ENGINE_VERSION`. Modifica el motor del incremento 2.  
Relacionada con: [plan 01](../../../docs/plans/feature/reviews&exports/01-plan-reviews-y-exports.md) (D3, D4, D5), [bitácora 01](01-serializador-tsv.md), [bitácora 02](02-comprobar-la-aprobacion.md), [fuentes técnicas](../../../docs/fonts/feature/reviews&exports/02-fuentes-tecnicas.md), [plan de evaluaciones](../../../docs/plans/feature/rulesets&evaluations/01-plan-rulesets-y-evaluations.md) (D5, D6).  
Revisión de partida: `d5e8f54` con los cambios sin commit de E1 y E2.

## Necesidad y punto de partida

El usuario pidió empezar E3. Tras E2: 27 suites y 486 pruebas en verde.

No hizo falta investigación externa. Al revisar el código aparecieron dos casos que el plan no preveía:

1. Un opcional con solo un tabulador (`brand: '\t'`) es vacío para el perfil (`isBlank`), así que no genera problema, pero el serializador de E1 lo escribía tal cual y lanzaba un error al exportar.
2. `\s` de JavaScript no incluye U+0085 (NEL). Comprobado con `node -e` sobre los ocho caracteres: todos responden `true` salvo U+0085. Por tanto `clean_text` no quitaba un carácter que el perfil iba a marcar, y la sugerencia «aplica `clean_text`» habría sido falsa para él.

## Evidencia y decisiones

| Decisión | Evidencia | Aplicación |
| --- | --- | --- |
| Valores con tabulador o salto de línea → fila inválida (D5) | F18, F21; descarte de F19 (entrecomillar) explicado en el plan | `TEXT_HAS_LINE_BREAK` en `id`, `title`, `description` y `brand`. |
| Comilla inicial → fila inválida (D5) | F19 (comillas activadas por defecto) y el vacío documentado en la ficha 02 | `TEXT_STARTS_WITH_QUOTE` en los mismos cuatro atributos. |
| Nueva `PROFILE_VERSION` (D5) | Comentario del propio perfil; RNF02 | `google_merchant@2026-11-01`, con la fecha de consulta de F18. |
| La sugerencia debe ser cierta | Comprobación de `\s` en Node | `clean_text` y `build_title` colapsan también U+0085; `ENGINE_VERSION` pasa a `'2'`. |

### Ajustes al escribir el código

- **`ENGINE_VERSION` también cambia.** El plan (D5) decía que no. Al ampliar `WHITESPACE_RUN` de `\s+` a `[\s\u0085]+` cambia el resultado de `clean_text` y `build_title` para valores con U+0085, y el comentario del motor obliga a subir la versión. La otra opción, sacar U+0085 de la lista del perfil, se descartó: Unicode lo trata como salto de línea y un lector del TSV podría partir la línea.
- **Orden de los problemas de texto.** El plan lo dejaba para E3. `findFreeTextProblem` informa primero el salto de línea, después la comilla inicial y por último la longitud. Motivo: `clean_text` corrige el salto de línea y además puede acortar el texto, así que medir la longitud antes daría un consejo que luego cambia.
- **Sugerencia según el atributo.** Para `id`, `TEXT_HAS_LINE_BREAK` sugiere corregir el identificador en el catálogo y reimportar, porque ninguna regla cambia el id (invariante 2 de `docs-diagrams/06`). Para el resto, aplicar `clean_text` o corregir el catálogo.
- **Serializador (ajuste a E1 y D4).** Un opcional vacío o de solo espacios se escribe como celda vacía, que para Google significa lo mismo. Antes se escribía tal cual. Se añadió un predicado `hasValue(value): value is string` en el serializador, que estrecha el tipo y se usa también al elegir columnas.
- **Dos pruebas existentes cambian su valor esperado.** [evaluations.repository.int-spec.ts](../../../test/features/evaluations/evaluations.repository.int-spec.ts) (l. 133–134) y [evaluations.e2e-spec.ts](../../../test/features/evaluations/evaluations.e2e-spec.ts) (l. 135–136) comprobaban `engineVersion: '1'` y `profileVersion: 'google_merchant@2026-10-31'`. Ahora esperan `'2'` y `'google_merchant@2026-11-01'`. Es el cambio de comportamiento buscado, no una refactorización. Fueron las dos únicas pruebas que fallaron antes de actualizarlas.

## Implementación y funcionamiento

| Decisión | Archivo y símbolo | Detalle |
| --- | --- | --- |
| D5 | [google-merchant.profile.ts](../../../src/evaluations/engine/google-merchant.profile.ts), `ProblemCode`, `PROFILE_VERSION` | Dos códigos nuevos; versión con su motivo en el comentario. |
| D5 | mismo archivo, `findFreeTextProblem` | Salto de línea → comilla inicial → longitud. La usan `findProductProblems` para el id y `findAttributeProblem` para `title`, `description` y `brand`. Usa `hasTabOrLineBreak` y `startsWithQuote`, creados en E1. |
| Ajuste | [evaluate-row.ts](../../../src/evaluations/engine/evaluate-row.ts), `WHITESPACE_RUN`, `ENGINE_VERSION` | `[\s\u0085]+` y versión `'2'`, con el motivo en ambos comentarios. |
| D5 | [problem-messages.ts](../../../src/evaluations/problem-messages.ts), `PROBLEM_TEXTS` | Problema y sugerencia es/en para los dos códigos; la sugerencia de `TEXT_HAS_LINE_BREAK` depende del atributo. |
| Ajuste a D4 | [products-tsv.ts](../../../src/exports/products-tsv.ts), `cellOf`, `hasValue` | Opcional vacío → celda vacía; obligatorio vacío → error, como antes. |

## Comprobación

| Comando o prueba ejecutada | Resultado observado |
| --- | --- |
| [evaluate-row.spec.ts](../../../test/features/evaluations/evaluate-row.spec.ts), bloque «perfil google_merchant 2026-11-01» | 29 pruebas nuevas en verde: cada uno de los 8 caracteres en `title`, `description` y `brand` y en el id; comilla inicial en los cuatro; comillas interiores y tras un espacio aceptadas; orden salto de línea → comilla → longitud; `brand: '\t'` sigue siendo vacío; un enlace con salto de línea sigue siendo `URL_INVALID`; `clean_text` antes de validar elimina cada uno de los 8 caracteres. |
| [errors-csv.spec.ts](../../../test/features/evaluations/errors-csv.spec.ts) | 3 pruebas nuevas: los dos códigos tienen textos es/en, y la sugerencia menciona `clean_text` salvo para el id. |
| [products-tsv.spec.ts](../../../test/features/exports/products-tsv.spec.ts) | 1 prueba nueva: un `brand` de solo tabulador se escribe vacío cuando la columna existe por otra fila. |
| Defectos introducidos a propósito, uno por uno, y restaurados con copia + `diff` sin diferencias | Sin comprobar saltos de línea → 17 fallos. Longitud antes que salto de línea → 1. `clean_text` sin U+0085 → 1. El id solo comprueba longitud → 9. Serializador escribe el opcional vacío tal cual → 1. Sugerencia `clean_text` también para el id → 1. `PROFILE_VERSION` antigua → 2 (integración y E2E de evaluaciones). |
| `./node_modules/.bin/tsc -p tsconfig.json --noEmit` | Sin errores. Antes de añadir los textos, el compilador exigió `TEXT_HAS_LINE_BREAK` y `TEXT_STARTS_WITH_QUOTE` en `PROBLEM_TEXTS` (`Record<ProblemCode, …>`). |
| `pnpm lint` (`oxlint --type-aware src/`) | Sin avisos, salida 0. |
| `./node_modules/.bin/prettier --check src test/features` | Todo con el estilo de Prettier. |
| `pnpm test:features` | 27 suites y 519 pruebas en verde (486 previas + 33 nuevas). Medición del TSV de 5.000 productos en esa ejecución: 9 ms. |
| `pnpm db:verify` | 3 de 3 (pruebas locales, sin conectar a Neon). |
| Recorrido con Python de los archivos tocados | Solo queda el U+200D anterior del emoji de un comentario del perfil. |

**No verificado:**

- Evaluaciones reales en Neon: todas las existentes tienen `engine_version = '1'` y `profile_version = 'google_merchant@2026-10-31'`. La exportación (E5) las rechazará con `EXPORT_EVALUATION_OUTDATED` hasta repetirlas. Esta etapa no cambia el esquema ni necesita migración.
- Que Google lea como salto de línea cada uno de los ocho caracteres: la lista es conservadora y propia (D5).

## Consecuencias y continuidad

- Una fila con tabuladores, saltos de línea o comilla inicial en un texto libre ahora es inválida, aparece en el informe y en `errores.csv` con su corrección, y nunca llegará al TSV.
- Repetir una evaluación anterior puede dar otro resultado y otra suma, porque cambian el motor y el perfil (RNF02 sigue valiendo para evaluaciones con las mismas versiones).
- E4 extraerá `ArtifactStore` a un módulo común.
- Cambios de esta etapa, sin commit: `google-merchant.profile.ts`, `evaluate-row.ts`, `problem-messages.ts`, `products-tsv.ts` y las pruebas `evaluate-row.spec.ts`, `errors-csv.spec.ts`, `products-tsv.spec.ts`, `evaluations.repository.int-spec.ts` y `evaluations.e2e-spec.ts`.
