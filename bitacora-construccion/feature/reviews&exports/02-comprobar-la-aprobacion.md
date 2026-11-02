# 02 — Comprobación pura de la aprobación (E2)

Fecha de creación: 2026-11-01  
Estado: Implementado y verificado. Pruebas unitarias; la lectura de la evaluación en la base y el POST corresponden a E5.  
Ámbito: etapa E2 del [plan 01](../../../docs/plans/feature/reviews&exports/01-plan-reviews-y-exports.md): función pura que decide si una evaluación se puede exportar con la aprobación recibida (D1–D3). Sin Nest, Prisma ni HTTP.  
Relacionada con: [plan 01](../../../docs/plans/feature/reviews&exports/01-plan-reviews-y-exports.md) (D1, D2, D3, D10), [bitácora 01](01-serializador-tsv.md), [estado real](../../../docs/fonts/feature/reviews&exports/01-estado-real-y-antecedentes.md), [cursos y reconstrucciones](../../../docs/fonts/feature/reviews&exports/03-cursos-y-reconstrucciones.md).  
Revisión de partida: `d5e8f54` con los cambios sin commit de E1 ([bitácora 01](01-serializador-tsv.md)).

## Necesidad y punto de partida

El usuario pidió empezar E2. Tras E1: 26 suites y 456 pruebas en verde.

No hizo falta investigación nueva: las reglas salen del plan (D1–D3) y del código de evaluaciones.

## Evidencia y decisiones

| Decisión | Evidencia | Aplicación |
| --- | --- | --- |
| Solo evaluaciones terminadas y con productos válidos (D1) | F1 (RF05, «bloquear un feed vacío»), F7 (`CHECK` de `succeeded`) | `hasResults` exige `succeeded`, conteos y suma; `counts.valid === 0` → `EXPORT_NO_VALID_PRODUCTS`. |
| La aprobación se compara con lo guardado (D2) | F4 (la aprobación identifica evaluación, suma y exclusiones), RC4 (no confiar en lo que manda el cliente), F9 (qué resume `result_checksum`) | `matchesApproval` compara suma exacta e inválidas y excluidas aceptadas con los conteos guardados. |
| Vigencia (D3) | F1 (rama «¿sigue vigente?»), F2 inv. 4 | `usesCurrentChecks` compara `ENGINE_VERSION` y `PROFILE_VERSION`; `hasNewerEvaluation` → `EXPORT_EVALUATION_SUPERSEDED`. |
| Códigos públicos con texto es/en (D10) | F16 | Cuatro códigos nuevos, todos `409`. |

### Ajustes al escribir el código

- **Orden fijo de los motivos.** El plan no lo fijaba. Se eligió: sin resultados → desactualizada → reemplazada → sin válidos → aprobación distinta. Va de lo que impide exportar esa evaluación pase lo que pase a lo que el cliente arregla volviendo a leerla; así el primer motivo es el que más le sirve al operador. Está explicado en el comentario de `findExportBlocker`.
- **«Hay una evaluación posterior» es un dato de la evaluación.** El plan hablaba de un tercer argumento. Se pasó a una propiedad de `EvaluationToExport` (`hasNewerEvaluation`), que en E5 calculará la misma consulta que lee la evaluación (`EXISTS`). Se evita un parámetro booleano suelto.
- **Códigos añadidos ya en E2.** `EXPORT_NO_VALID_PRODUCTS`, `EXPORT_APPROVAL_MISMATCH`, `EXPORT_EVALUATION_OUTDATED` y `EXPORT_EVALUATION_SUPERSEDED` se crearon ahora porque esta función los devuelve. `EXPORT_NOT_FOUND` y `EXPORT_FILE_UNAVAILABLE` quedan para E5 y E6, cuando haya quien los use.
- **Hueco en las pruebas encontrado con un defecto.** Al quitar la comprobación del estado, las 23 pruebas iniciales seguían en verde: todos los casos no terminados tenían también los conteos vacíos. Se añadieron tres casos (`queued`, `running`, `failed` con conteos y suma) que la base no permite, pero que demuestran que la función no se apoya solo en los conteos. Un comentario en la prueba lo explica.

## Implementación y funcionamiento

| Decisión | Archivo y símbolo | Detalle |
| --- | --- | --- |
| D1–D3 | [export-approval.ts](../../../src/exports/export-approval.ts), `findExportBlocker` | Devuelve el primer motivo (`ExportBlocker`) o `null`. Lee de arriba abajo como la lista de comprobaciones. |
| D1 | mismo archivo, `hasResults` | Predicado de tipo: tras él, `counts` y `resultChecksum` no son nulos, sin `as`. |
| D3 | mismo archivo, `usesCurrentChecks` | Versiones del motor y del perfil iguales a las actuales. |
| D2 | mismo archivo, `matchesApproval` | Suma y conteos; el comentario explica por qué bastan para saber qué exclusiones se aceptaron. |
| D10 | [error-codes.ts](../../../src/common/http/error-codes.ts) y [messages.ts](../../../src/common/http/messages.ts) | Cuatro códigos `409` con texto es/en que dicen qué hacer (volver a evaluar, exportar la más reciente, volver a consultar). |

## Comprobación

| Comando o prueba ejecutada | Resultado observado |
| --- | --- |
| [export-approval.spec.ts](../../../test/features/exports/export-approval.spec.ts) (unitarias) | 26 pruebas en verde: caso exportable; cero inválidas y excluidas; cada estado no terminado, con y sin conteos; terminada sin conteos o sin suma; sin válidos; perfil y motor de otra versión; evaluación posterior; suma distinta, en mayúsculas, inválidas o excluidas distintas e intercambiadas; cuatro casos de orden; los cuatro códigos responden `409`. |
| Cobertura de `export-approval.ts` | 100 % de sentencias, ramas, funciones y líneas. |
| Defectos introducidos a propósito, uno por uno, y restaurados con copia + `diff` sin diferencias | Sin comprobar el estado → 0 fallos con las 23 pruebas iniciales y 3 tras añadir los casos nuevos. Sin comparar el perfil → 2. Ignorar evaluaciones posteriores → 2. Permitir cero válidos → 2. No comparar excluidas → 1. Suma sin distinguir mayúsculas → 1. Invertir el orden «reemplazada» / «sin válidos» → 1. |
| `./node_modules/.bin/tsc -p tsconfig.json --noEmit` | Sin errores. |
| `pnpm lint` (`oxlint --type-aware src/`) | Sin avisos, salida 0. |
| `./node_modules/.bin/prettier --check src test/features` | Todo con el estilo de Prettier. |
| `pnpm test:features` | 27 suites y 486 pruebas en verde: 456 previas, 26 nuevas y 4 que `messages.spec.ts` genera por cada código nuevo. |
| `pnpm db:verify` | 3 de 3 (pruebas locales, sin conectar a Neon). |
| Recorrido con Python de los archivos tocados | Sin caracteres invisibles. |

**No verificado:** nada de esta etapa toca la base ni HTTP. El cálculo real de `hasNewerEvaluation` y el bloqueo `FOR SHARE` se comprobarán en E5.

## Consecuencias y continuidad

- La exportación ya sabe decidir; falta leer la evaluación (E5) con `hasNewerEvaluation` calculado en la misma consulta.
- Mientras E3 no cambie `PROFILE_VERSION`, las evaluaciones existentes pasan la comprobación de versión. Tras E3 quedarán desactualizadas, como prevé D3.1.
- Cambios de esta etapa, sin commit: `src/exports/export-approval.ts` (nuevo), `test/features/exports/export-approval.spec.ts` (nuevo), `src/common/http/error-codes.ts` y `src/common/http/messages.ts` (cuatro códigos).
