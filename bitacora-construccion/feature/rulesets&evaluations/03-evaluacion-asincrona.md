# 03 — Evaluación asíncrona de un snapshot (E3)

Fecha de creación: 2026-11-01  
Estado: Implementado y verificado en local (PGlite). Migraciones aplicadas en Neon el 2026-11-01.  
Ámbito: etapa E3 del [plan 01](../../../docs/plans/feature/rulesets&evaluations/01-plan-rulesets-y-evaluations.md). Comprende:
- las tablas `evaluations` y `evaluation_rows`;
- `POST /projects/:projectId/evaluations` (202) y `GET …/evaluations/:evaluationId`;
- `EvaluationWorker`;
- el bloqueo de los borrados mientras hay una evaluación activa.

Relacionada con: [bitácora 01 (motor)](01-motor-de-evaluacion-puro.md), [bitácora 02 (rulesets)](02-guardar-versiones-de-reglas.md), [plan 01](../../../docs/plans/feature/rulesets&evaluations/01-plan-rulesets-y-evaluations.md) (D7–D9, D14), [ficha 07](../../../docs/fonts/feature/rulesets&evaluations/07-unicidad-prisma-pglite-e-indice-parcial.md), [fuentes técnicas](../../../docs/fonts/feature/rulesets&evaluations/02-fuentes-tecnicas.md).  
Revisión de partida: `1f0be2d`, con los cambios sin commit de las bitácoras 01 y 02.

## Necesidad y punto de partida

El usuario pidió seguir con E3. Ya existían el motor (E1) y las versiones de reglas (E2), pero no había forma de aplicar una versión a un snapshot.

Antes de implementar se registró la [ficha 07](../../../docs/fonts/feature/rulesets&evaluations/07-unicidad-prisma-pglite-e-indice-parcial.md), por recordatorio del usuario de dejar cada fuente en `docs/fonts`. Contiene tres fuentes:
- **F33:** el experimento de E2 sobre P2002 y P2010, que solo estaba en la bitácora 02.
- **F34:** el límite de PGlite con los bloqueos.
- **F35:** el índice único parcial de PostgreSQL, consultado para esta etapa.

E3 sigue dentro de la feature `rulesets&evaluations`, así que no crea directorios nuevos.

## Decisiones y adaptación

| Decisión | Fuente | Implementación |
| --- | --- | --- |
| Una tabla que es evaluación y trabajo a la vez, con estados y `CHECK` por estado (D8) | Plan; patrón de `catalog_import_jobs` | [Migración 20261101000200_create_evaluations](../../../prisma/migrations/20261101000200_create_evaluations/migration.sql). Los conteos y la suma solo existen en `succeeded`, y ahí la base exige `válidos + inválidos + excluidos = total` (D7, tercera capa). |
| Una fila por resultado, coherente con su tipo (D7, D9) | Plan | `evaluation_rows` con `CHECK`: excluida sin valores ni problemas; válida sin problemas; inválida con al menos uno. Índice `(evaluation_id, outcome, source_row)` para E4. |
| Las FK compuestas impiden mezclar proyectos (D8) | F2 | `(project_id, snapshot_id)` → snapshots con `CASCADE` y `(project_id, ruleset_version_id)` → versiones con `RESTRICT` (D14). |
| Una sola evaluación activa por proyecto, garantizada por la base | F35, F33 | Índice único parcial `evaluations_one_active_per_project`. Prisma no lo expresa, pero `prisma migrate diff` no lo marca como desviación. El alta usa `tx.evaluation.create`, y un P2002 se traduce a `409 EVALUATION_ALREADY_ACTIVE` (`asAlreadyActive`). |
| Aceptación en una transacción con el proyecto bloqueado (D8) | F9, F22 | `insertQueued` en [evaluations.repository.ts](../../../src/evaluations/evaluations.repository.ts). Responde 404 con un proyecto ajeno, un snapshot de otro proyecto o una revisión inexistente; 409 si el snapshot no está listo, si faltan columnas o si ya hay una activa. |
| El snapshot se lee con `FOR SHARE` | F22 (propia) | `deleteImport` lo bloquea con `FOR UPDATE`, así que una de las dos operaciones espera a la otra. No demostrable con PGlite (F34). |
| Columnas del mapeo comprobadas contra las cabeceras de este snapshot (D2) | Plan | `assertColumnsExist`: `409 EVALUATION_COLUMN_MISSING` con un issue por atributo. El filtro global conserva esos issues (`CODES_WITH_ISSUES` en [api-exception.filter.ts](../../../src/common/http/api-exception.filter.ts)). |
| Worker propio que copia el ciclo de vida del de importación (D8) | F10 | [evaluations.worker.ts](../../../src/evaluations/evaluations.worker.ts): sondeo, `runUntilIdle`, apagado ordenado e `interruptRunning` al arrancar. Lotes de 250 filas por `source_row` (`readCatalogRows`), con `evaluateRow` y `EvaluationSummary` de E1. |
| Versiones fijadas al aceptar y moneda congelada (RNF02) | F1, F8 | `engine_version` y `profile_version` se guardan en el alta. El worker lee la versión por su ID y la moneda de `project_configuration` del snapshot, y comprueba ambas (`isRuleset`, `CURRENCY_PATTERN`) antes de evaluar. |
| Finalización comprobada (D7) | Plan | `complete`: cuenta lo guardado por resultado y lo compara con los conteos del motor y con `row_count` del snapshot. Si no coinciden, `EVALUATION_INTEGRITY_FAILED`. |
| Un fallo no deja filas parciales (D8) | Plan | `fail` e `interruptRunning` borran `evaluation_rows` de esas evaluaciones en la misma transacción que las marca `failed`. `appendRows` y `complete` fallan si la evaluación ya no está `running` (`lockRunning`). |
| NULL de SQL para las filas excluidas | F25 | `toStoredRow` usa `Prisma.DbNull`; con el `null` de JSON fallaría el `CHECK`. |
| Los borrados respetan las evaluaciones activas (R2, D8) | Plan | `hasActiveEvaluation` en [catalog-import.repository.ts](../../../src/catalog-import/catalog-import.repository.ts), llamada desde `deleteSnapshot` y `deleteProject`: `409 EVALUATION_IN_PROGRESS`. Es el único cambio en `catalog-import`. |

**Ajustes al plan** (marcados «en E3»):
1. `GET …/evaluations/:evaluationId` se adelanta a E3, para que `statusUrl` funcione. E4 solo añade la muestra, las filas paginadas y `errores.csv`.
2. Índice único parcial.
3. Lectura del snapshot con `FOR SHARE`.
4. Issues en `EVALUATION_COLUMN_MISSING`.
5. `RESTRICT` responde con el código 23001.

## Implementación

```text
POST /projects/:projectId/evaluations { snapshotId, rulesetRevision }
  → EvaluationsService.accept → repository.accept (transacción: proyecto FOR UPDATE,
    snapshot FOR SHARE ready, versión, columnas, activa) → model.create queued → wake()
  ← 202 { evaluationId, status: 'queued', statusUrl }
EvaluationWorker: claim (FOR UPDATE OF e SKIP LOCKED → running)
  → lotes de 250: readCatalogRows → evaluateRow → summary.add → appendRows
  → complete (conteos guardados = motor = row_count) → succeeded
  → si falla: fail (borra filas, failed + error); si se interrumpe: EVALUATION_INTERRUPTED
GET /projects/:projectId/evaluations/:evaluationId → { evaluation }
```

| Archivo | Cambio |
| --- | --- |
| [schema.prisma](../../../prisma/schema.prisma) | Modelos `Evaluation` y `EvaluationRow` y sus relaciones inversas. |
| [src/evaluations/](../../../src/evaluations/) | `evaluations.types.ts`, `evaluations.dto.ts`, `evaluations.repository.ts`, `evaluations.worker.ts`, `evaluations.service.ts`, `evaluations.controller.ts`, `evaluations.module.ts`. |
| [app.module.ts](../../../src/app.module.ts) | Registra `EvaluationsModule`. |
| [error-codes.ts](../../../src/common/http/error-codes.ts), [messages.ts](../../../src/common/http/messages.ts) | Ocho códigos `EVALUATION_*` con texto es/en. |
| [api-exception.filter.ts](../../../src/common/http/api-exception.filter.ts) | `CODES_WITH_ISSUES`: añade `EVALUATION_COLUMN_MISSING` a los códigos que conservan issues. |
| [catalog-import.repository.ts](../../../src/catalog-import/catalog-import.repository.ts) | `hasActiveEvaluation` en los dos borrados. |
| [requests/evaluations.http](../../../requests/evaluations.http) | Aceptar y consultar. |
| [prisma-migrations.test.mjs](../../../test/prisma-migrations.test.mjs), [projects.repository.int-spec.ts](../../../test/features/projects/projects.repository.int-spec.ts) | Cuentan las migraciones: 8 → 9. |

## Comprobación

| Comando o prueba ejecutada | Resultado observado |
| --- | --- |
| `tsc --noEmit`, `pnpm lint`, `prettier --check` | Sin errores ni avisos. |
| `prisma migrate diff` (PGlite migrada → `schema.prisma`) | «This is an empty migration», también con el índice parcial. |
| `evaluations.repository.int-spec.ts` (17, PGlite) | Ver la primera lista que sigue a esta tabla. |
| `evaluations.e2e-spec.ts` (5, HTTP real) | Ver la segunda lista que sigue a esta tabla. |
| Mutaciones a mano, de una en una y restauradas con `diff` | Quitar la comprobación de integridad, no borrar las filas al fallar o permitir borrar con una evaluación activa: cada una hace fallar 1 prueba. |
| Arranque del `AppModule` completo sobre PGlite (script temporal) | Arranca con los dos workers. Las cinco rutas nuevas responden `401 AUTH_SESSION_REQUIRED` sin sesión; una ruta inexistente de control, `404 ROUTE_NOT_FOUND`. |
| `pnpm test:features` | 24 suites y 385 pruebas en verde (+30: 22 nuevas y 8 del catálogo de mensajes). |
| `pnpm db:verify` | 3 de 3, con las 9 migraciones. |

**Pruebas de integración** (`evaluations.repository.int-spec.ts`):
- **Aceptación:**
  - queda en cola con sus versiones;
  - responde 404 con un proyecto ajeno, un snapshot de otro proyecto o una revisión inexistente;
  - responde 409 si el snapshot no está listo y 409 con los issues `mapping.price` y `mapping.brand` si faltan columnas;
  - el índice parcial rechaza una segunda evaluación activa insertada por SQL (`23505`).
- **Worker:**
  - 9 filas dan 3 válidas, 3 inválidas y 3 excluidas, y la suma coincide con la del motor sobre las mismas filas;
  - guarda los valores normalizados, los problemas y `excluded_by_rule`;
  - dos evaluaciones iguales dan la misma suma (RNF02);
  - procesa 600 filas en tres lotes;
  - un `row_count` distinto da `EVALUATION_INTEGRITY_FAILED` sin filas guardadas;
  - una versión con forma inválida da `EVALUATION_PROCESSING_FAILED`;
  - la interrupción borra las filas y bloquea `appendRows`.
- **Restricciones:**
  - `CHECK` de conteos y de filas (`23514`);
  - FK de otro proyecto (`23503`);
  - borrados con una evaluación activa → 409;
  - borrar la importación terminada borra en cascada las evaluaciones y sus filas;
  - borrar una versión usada → `23001`.

**Pruebas E2E** (`evaluations.e2e-spec.ts`):
- 202 con `statusUrl`; la consulta da `queued` y, tras `runUntilIdle`, `succeeded` con conteos 6 = 2 + 2 + 2 y suma;
- 400 con un UUID inválido o una revisión que no es un entero positivo;
- 409 con issues por columna y 409 con otra evaluación activa;
- 404 para Bob al aceptar y al consultar, y 404 `EVALUATION_NOT_FOUND`;
- 401 sin sesión.

**No verificado:**
- Migraciones de E2 y E3 **aplicadas en Neon el 2026-11-01** con `pnpm db:migrate`. Se aplicaron antes de arrancar la API, como hacía falta: `EvaluationWorker.onApplicationBootstrap` llama a `interruptRunning`, que consulta `evaluations`, y sin la tabla el arranque falla. La importación funciona igual.
- `FOR UPDATE`, `FOR SHARE` y `SKIP LOCKED` no se pueden demostrar con PGlite (F34). Lo que no depende de los bloqueos lo cubre la base: índice parcial, FK y `CHECK`.
- La traducción de un P2002 del índice parcial a 409 no tiene prueba propia: la comprobación previa en la misma transacción impide provocarlo desde la aplicación sin más. La forma del error está respaldada por F33.
- No se midió el rendimiento con 5.000 filas (E4) ni se ejecutó `requests/evaluations.http`.
- Todo se ejecutó con Node 26.9.0.

## Consecuencias y continuidad

- E4 añadirá la muestra al GET, `GET …/rows` paginado por `outcome` (el índice ya existe), `errores.csv` con el escape de D10 y la medición con 5.000 filas.
- La traducción de los códigos de problema a sugerencias es/en también es de E4.
- Si aparece un tercer consumidor de cola (la exportación del incremento 3), conviene revisar si extraer el ciclo de vida común de los dos workers.
- No hay commit.
