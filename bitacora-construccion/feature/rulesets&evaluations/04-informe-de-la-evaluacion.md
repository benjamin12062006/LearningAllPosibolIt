# 04 — Informe de la evaluación (E4)

Fecha de creación: 2026-11-01  
Estado: Implementado y verificado en local (PGlite). Pendiente la apertura manual de `errores.csv` en una hoja de cálculo; migraciones de E2/E3 sin aplicar en Neon.  
Ámbito: etapa E4 del [plan 01](../../../docs/plans/feature/rulesets&evaluations/01-plan-rulesets-y-evaluations.md):
- la muestra en el GET de la evaluación;
- `GET …/rows` paginado por resultado;
- `GET …/errors.csv`;
- los textos es/en de cada problema con su corrección sugerida;
- la medición con 5.000 filas y 20 reglas;
- la actualización pendiente de `docs-diagrams/06`.

Relacionada con: [bitácora 03 (evaluación asíncrona)](03-evaluacion-asincrona.md), [plan 01](../../../docs/plans/feature/rulesets&evaluations/01-plan-rulesets-y-evaluations.md) (D6, D9, D10), [ficha 06](../../../docs/fonts/feature/rulesets&evaluations/06-csv-de-errores-owasp-y-rfc4180.md), [ficha 08](../../../docs/fonts/feature/rulesets&evaluations/08-informe-bom-streamablefile-y-medicion.md), [docs-diagrams/06](../../../../docs-diagrams/06-dominio-y-datos-postgresql.md).  
Revisión de partida: `1f0be2d`, con los cambios sin commit de las bitácoras 01–03.

## Necesidad y punto de partida

El usuario pidió seguir con E4, recordando investigar primero lo que hiciera falta. E3 ya guardaba una fila por producto con su resultado y sus problemas, pero el cliente solo veía estado y conteos.

Quedaban tres preguntas sin fuente. Se investigaron y registraron en la [ficha 08](../../../docs/fonts/feature/rulesets&evaluations/08-informe-bom-streamablefile-y-medicion.md):

| Pregunta | Fuente | Respuesta |
| --- | --- | --- |
| ¿BOM en `errores.csv`? | F36, artículo oficial de Microsoft | Excel abre un CSV en UTF-8 «normally if it was saved with BOM». Sin BOM, hay que importarlo. |
| ¿Cómo devolver un archivo en Nest? | F37, tipos instalados de `@nestjs/common` 12.0.3 | `StreamableFile` con las opciones `type` y `disposition`. |
| ¿Cómo medir sin inventar un objetivo? | F38, prueba de 5.000 filas de la importación | Registrar una línea JSON sin umbral. |

## Decisiones y adaptación

| Decisión | Fuente | Implementación |
| --- | --- | --- |
| El motor devuelve códigos y el informe pone el texto (ajuste de E1) | D6 | [problem-messages.ts](../../../src/evaluations/problem-messages.ts): `PROBLEM_TEXTS` con problema y corrección sugerida en es/en para los nueve códigos. `TEXT_TOO_LONG` sugiere el máximo de cada atributo (`MAX_LENGTHS`, ahora exportado del perfil, sin cambiar su comportamiento). Las sugerencias no repiten el valor del catálogo. |
| Formato de `errores.csv` (D10) | F31, F32, F36 | [errors-csv.ts](../../../src/evaluations/errors-csv.ts): `buildErrorsCsv` y `csvCell`. Lleva BOM, CRLF y cabecera en es/en; todas las celdas van entre comillas, con las comillas internas duplicadas; un tabulador delante de `=`, `+`, `-`, `@`, tabulador, CR, LF y sus variantes de ancho completo. |
| Descarga sin el objeto `response` de Express | F37 | `downloadErrorsCsv` en [evaluations.controller.ts](../../../src/evaluations/evaluations.controller.ts) devuelve `StreamableFile` con `text/csv; charset=utf-8; header=present` y `attachment; filename="errores-<id>.csv"`. |
| Resultados solo de evaluaciones terminadas bien (D10) | Plan | `assertHasResults` en [evaluations.service.ts](../../../src/evaluations/evaluations.service.ts): filas y CSV responden `409 EVALUATION_RESULTS_UNAVAILABLE` (código nuevo, es/en). El GET devuelve `{ evaluation, sample }`, con la muestra vacía hasta `succeeded`. |
| Paginación compartida e índice de E3 (D9, D10) | F12 | `EvaluationRowsQueryDto` extiende `PaginationQueryDto` con `outcome` opcional. `findRows` filtra con `Prisma.sql`/`Prisma.empty` y ordena por `source_row`, sobre el índice `(evaluation_id, outcome, source_row)`. |
| Comprobar la forma de lo leído de `jsonb` | F25 | `isRowProblem` y `isProductValues`. Una forma desconocida lanza un error interno, en lugar de mostrar datos corruptos. |
| `docs-diagrams/06` refleja la decisión D9 | D9 | Diagrama de clases (`EvaluationRows rows`), párrafo, tabla (`evaluation_rows`) y almacenamiento. El plan lo situaba en E3 y se hizo aquí. |

## Hallazgo durante la implementación

Al escribir los archivos, las secuencias de escape no ASCII (`﻿`, `＝`…, `́`, ` `) quedaron guardadas como caracteres literales, invisibles en el editor. Afectaba a dos sitios:
- `errors-csv.ts` (BOM y regex) y su prueba;
- dos pruebas de E1 (`evaluate-row.spec.ts`, `evaluation-summary.spec.ts`).

Todo funcionaba, pero el código no se podía leer ni revisar. Un script recorrió `src/evaluations`, `src/rulesets` y sus pruebas en busca de caracteres invisibles o combinantes, y se sustituyeron por sus escapes. Solo queda, a propósito, el emoji compuesto 👨‍👩‍👧 del comentario de `isTooLong`.

## Implementación

```text
GET …/evaluations/:id            → { evaluation, sample }   (sample: 20 filas si succeeded, [] si no)
GET …/evaluations/:id/rows       → { rows, page }           (?outcome=valid|invalid|excluded&limit&offset)
GET …/evaluations/:id/errors.csv → archivo                  (?lang=es|en; 409 si no succeeded)
fila: { sourceRow, externalId, outcome, values|null, problems: [{ attribute, code, problem{es,en}, suggestion{es,en} }], excludedByRule|null }
```

| Archivo | Cambio |
| --- | --- |
| [problem-messages.ts](../../../src/evaluations/problem-messages.ts) | Textos es/en, `describeProblem`, `isRowProblem`, `LANGUAGES`. |
| [errors-csv.ts](../../../src/evaluations/errors-csv.ts) | Serializador puro. |
| [evaluations.repository.ts](../../../src/evaluations/evaluations.repository.ts) | `findRows`, `findInvalidRows` y las comprobaciones de forma. |
| [evaluations.service.ts](../../../src/evaluations/evaluations.service.ts), [evaluations.controller.ts](../../../src/evaluations/evaluations.controller.ts), [evaluations.dto.ts](../../../src/evaluations/evaluations.dto.ts), [evaluations.types.ts](../../../src/evaluations/evaluations.types.ts) | Muestra, rutas `rows` y `errors.csv`, DTO de consulta y `ROW_OUTCOMES`/`SAMPLE_ROWS`. |
| [google-merchant.profile.ts](../../../src/evaluations/engine/google-merchant.profile.ts) | Exporta `MAX_LENGTHS`, sin cambio de comportamiento ni de `PROFILE_VERSION`. |
| [error-codes.ts](../../../src/common/http/error-codes.ts), [messages.ts](../../../src/common/http/messages.ts) | `EVALUATION_RESULTS_UNAVAILABLE`. |
| [snapshot-fixtures.ts](../../../test/features/evaluations/support/snapshot-fixtures.ts) | Inserta las filas con una sola sentencia (`jsonb_array_elements WITH ORDINALITY`), para que la preparación no pese en la medición. |
| [requests/evaluations.http](../../../requests/evaluations.http) | Filas inválidas y descarga del CSV. |

## Comprobación

| Comando o prueba ejecutada | Resultado observado |
| --- | --- |
| `errors-csv.spec.ts` (30) | Escape de cada carácter de riesgo, incluidos el ejemplo de OWASP y el ancho completo; BOM, CRLF y una línea por problema; cabeceras es/en; CSV sin filas; textos es/en de los nueve códigos y máximos 50/150/5000/70. |
| `evaluations.repository.int-spec.ts` (+4) | Filas por página y por resultado; problemas descritos; filas inválidas para el CSV; problema guardado con un código desconocido → error. |
| `evaluations.e2e-spec.ts` (+5) | Muestra 1–6 en orden, con valores normalizados, problemas en es/en y `excludedByRule` 4. Sin resultados: muestra vacía y 409 en filas y CSV. Paginación, filtro y `400` con `outcome`, `limit` u `offset` inválidos. Descarga con BOM (bytes `EF BB BF`), las dos cabeceras de descarga, `"\t=SKU-7"` protegido, `lang=en` y `lang=fr` → 400. 404 para Bob. |
| Mutaciones (restauradas con `diff`) | Sin el tabulador de protección fallan 14 pruebas; sin BOM, 3. |
| Arranque del `AppModule` sobre PGlite | Las siete rutas nuevas de la feature responden `401` sin sesión; una ruta inexistente, `404`. |
| Medición `evaluation-5000-rows-20-rules` (tres ejecuciones) | Evaluación de 5.000 filas con 20 reglas: 744, 730 y 731 ms. `errores.csv` con 1.667 filas inválidas: 13 ms y 276.048 bytes. |
| `tsc --noEmit`, `pnpm lint`, `prettier --check` | Sin errores ni avisos. |
| `pnpm test:features` | 25 suites y 425 pruebas en verde (+40: 39 nuevas y 1 del catálogo de mensajes). |
| `pnpm db:verify` | 3 de 3. |

**Sobre la medición:** el RSS (de 1,1 a 1,26 GB) incluye Jest y PGlite en el mismo proceso, y llegó a bajar por la recolección de basura. No aísla la memoria de la evaluación, así que no se afirma ninguna cifra de memoria. Los tiempos son de PGlite dentro de Jest y no predicen Neon.

**No verificado:**
- **Abrir `errores.csv` en Excel o Numbers** (acentos, tabulador de protección): comprobación manual pendiente para el usuario.
- Migraciones de E2 y E3 en Neon: deben aplicarse antes de arrancar la API (bitácora 03).
- Bloqueos contra un PostgreSQL real (F34).
- `requests/evaluations.http` contra la API en marcha.
- Todo con Node 26.9.0.

## Consecuencias y continuidad

- Con E4, el incremento 2 de `docs-diagrams` queda implementado en la API en local: reglas versionadas, evaluación reproducible, conteos coherentes e informe.
- Siguientes pasos fuera de este plan:
  - GraphQL (plan `02`);
  - la exportación TSV (incremento 3), que necesitará su propio escape: el tabulador de `errores.csv` no sirve para un TSV;
  - una posible cola común para los workers.
- No hay commit.
