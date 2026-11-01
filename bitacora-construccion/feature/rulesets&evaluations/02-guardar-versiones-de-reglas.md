# 02 — Guardar y consultar versiones de reglas (E2)

Fecha de creación: 2026-11-01  
Estado: Implementado y verificado en local (PGlite). Migración sin aplicar en Neon.  
Ámbito: etapa E2 del [plan 01](../../../docs/plans/feature/rulesets&evaluations/01-plan-rulesets-y-evaluations.md). Comprende:
- la tabla `ruleset_versions`;
- el DTO con despacho por `@Transform`;
- el repositorio con revisión bloqueada;
- servicio, controlador y códigos de error;
- las rutas `POST /projects/:projectId/rulesets`, `GET …/rulesets` y `GET …/rulesets/:revision`.

Relacionada con: [bitácora 01 (motor)](01-motor-de-evaluacion-puro.md), [plan 01](../../../docs/plans/feature/rulesets&evaluations/01-plan-rulesets-y-evaluations.md) (D1–D3, D11, D14), [ficha 05 (discriminador)](../../../docs/fonts/feature/rulesets&evaluations/05-experimento-discriminador-y-validationpipe.md), [fuentes técnicas](../../../docs/fonts/feature/rulesets&evaluations/02-fuentes-tecnicas.md), [cursos y reconstrucciones](../../../docs/fonts/feature/rulesets&evaluations/03-cursos-y-reconstrucciones.md).  
Revisión de partida: `1f0be2d`, con los cambios sin commit de la bitácora 01.

## Necesidad y punto de partida

El usuario pidió seguir con E2. El motor de E1 ya tenía los tipos de dominio (`Rule`, `Ruleset`) y `findRulesetIssues`, pero nada se guardaba ni se exponía por HTTP. La investigación de la etapa estaba hecha (ficha 05). Al revisar el código aparecieron dos dudas que exigían comprobación antes de implementar.

## Evidencia nueva de esta etapa

| ID | Comprobación | Resultado | Consecuencia |
| --- | --- | --- | --- |
| X1 | [Experimento 04](../../../docs/fonts/feature/rulesets&evaluations/experimentos/04-error-unicidad-prisma.mjs) ([salida](../../../docs/fonts/feature/rulesets&evaluations/experimentos/04-error-unicidad-prisma.salida.txt)): violar un `UNIQUE` real con Prisma 7.10.0 + `@prisma/adapter-pg` en PGlite | Con la API del modelo, `PrismaClientKnownRequestError` **P2002**. Con `$executeRaw`, **P2010** («Raw query failed. Code: `23505`»). | D1 decía «P2002 → 409»; solo se cumple si el `INSERT` usa `tx.rulesetVersion.create`. El resto del repositorio sigue con SQL parametrizado. [F24] |
| X2 | [api-exception.filter.ts](../../../src/common/http/api-exception.filter.ts), `readValidationIssues` (l. 112–132) | Solo conserva `issues` si el código es `VALIDATION_FAILED` o `INVALID_UUID`, y de cada uno solo `field` y `code`. | Los problemas de coherencia van como issues de un `400 VALIDATION_FAILED`, y el atributo se indica en `field`. |
| X3 | Mutación: quitar `FOR UPDATE` de `lockConfiguredProject` y repetir la integración | Las 8 pruebas siguen en verde, incluida la de cinco guardados simultáneos. | Ver la lista que sigue a esta tabla. |

**Sobre X3:**
- El [README de pglite-socket](../../../node_modules/@electric-sql/pglite-socket/README.md) (l. 12 y 288) explica el motivo: PGlite es una base de una sola conexión y el servidor multiplexa las conexiones, así que en la práctica las transacciones se ejecutan una tras otra.
- La prueba de concurrencia no demuestra el bloqueo, y así lo dice su comentario. El bloqueo queda respaldado por F22 y por la restricción única como última defensa.
- Pendiente: probar contra un PostgreSQL real. Afecta igual a la prueba de concurrencia que ya existía en catalog-import.

## Decisiones y adaptación

| Decisión | Fuente | Implementación |
| --- | --- | --- |
| Versión inmutable con revisión creciente y `UNIQUE (project_id, revision)` (D1) | F2, F22, F23 | Migración [20261101000100_create_ruleset_versions](../../../prisma/migrations/20261101000100_create_ruleset_versions/migration.sql). Los nombres de restricciones se tomaron de `prisma migrate diff` y se añadieron los `CHECK` `revision > 0` y `jsonb_typeof = 'array'`. No hay rutas de modificación ni de borrado. |
| Bloquear el proyecto y calcular `MAX + 1` en la misma transacción (D1) | F9, F22 | `lockConfiguredProject` + `nextRevision` en [rulesets.repository.ts](../../../src/rulesets/rulesets.repository.ts). Mismo bloqueo que `accept` y `deleteProject`, con 404 si el proyecto es ajeno y 409 si no tiene configuración. |
| P2002 → 409 (D1) | F24, X1 | `asRevisionConflict`, en una función con un solo `try/catch` (`create`). La prueba fuerza la colisión sustituyendo `nextRevision`. |
| Reglas y mapeo como arreglos JSON (D3) | F20, F21 | Columnas `jsonb` con `CHECK` de arreglo; el orden del arreglo es el orden de aplicación. |
| Comprobar la forma al leer (D3) | F25 | `isRuleset` en [ruleset.ts](../../../src/evaluations/engine/ruleset.ts), del motor, porque E3 también lo necesitará. Una forma inválida lanza un error interno (500): solo la API escribe esa tabla. |
| Despacho de reglas por `@Transform` en vez del discriminador (D3) | F27–F29, RC2 | `toRuleDtos` y `RULE_DTO_CLASSES` (un `Map`) en [rulesets.dto.ts](../../../src/rulesets/rulesets.dto.ts). `mapping` conserva el `@Type` simple de RC2. |
| `value` de `exclude_when`: de 1 a 200 caracteres, vacío o ausente con `is_empty` (ajuste de E1) | Propia | Validador con nombre `IsConditionValue` (`ValidateBy`): es una regla entre dos campos y un `@ValidateIf` no permite dos condiciones distintas sobre la misma propiedad. |
| Coherencia mapeo/reglas antes de tocar la base (D2, D4) | E1 | `assertRulesetIsConsistent` en [rulesets.service.ts](../../../src/rulesets/rulesets.service.ts), con `field` como `mapping.price`, `rules.2.color` o `rules.0.{}` (X2). |
| La base guarda objetos simples, no instancias de DTO | Propia | `toRuleset` y `toRule` copian el body al tipo de dominio con `instanceof`, sin `as`. |
| Una revisión no numérica o fuera del rango de INTEGER → 404 | Propia | `ParseIntPipe` con `exceptionFactory` en el controlador, más `isStorableRevision` en el servicio. Sin esto, `99999999999` llegaría a PostgreSQL como un entero fuera de rango y respondería 500. |
| Borrado en cascada desde el proyecto (D14) | Plan | La FK `ON DELETE CASCADE` hacia `projects`: `deleteProject` de catalog-import no necesitó cambios. |

**Ajustes al plan** (marcados «en E2» en el plan):
1. `rules` admite un arreglo vacío.
2. Los errores de coherencia se devuelven como issues de `VALIDATION_FAILED`.
3. El `INSERT` se hace con la API del modelo.
4. Una revisión inválida responde 404.
5. Se deja constancia de lo que PGlite no puede demostrar.

## Implementación

```text
POST /projects/:projectId/rulesets
  DescopeSessionGuard → ValidationPipe (CreateRulesetDto, @Transform de reglas)
  → RulesetsService.create: toRuleset → assertRulesetIsConsistent (400) → findCurrent
  → RulesetsRepository.create: transacción { FOR UPDATE del proyecto (404/409) → MAX+1 → model.create }
                               P2002 → 409 RULESET_REVISION_CONFLICT
  ← 201 { ruleset: { id, revision, mapping, rules, createdAt } }
GET …/rulesets?limit&offset → findOwned (404) → { rulesets, page }, de la revisión más alta a la más baja
GET …/rulesets/:revision    → findOwned (404) → { ruleset } | 404 RULESET_NOT_FOUND
```

| Archivo | Cambio |
| --- | --- |
| [schema.prisma](../../../prisma/schema.prisma) | Modelo `RulesetVersion` y relación `Project.rulesets`. |
| [migration.sql](../../../prisma/migrations/20261101000100_create_ruleset_versions/migration.sql) | Tabla, índices únicos (el segundo, `(project_id, id)`, es para las FK compuestas de E3) y FK en cascada. |
| [src/rulesets/](../../../src/rulesets/) | `rulesets.dto.ts`, `rulesets.types.ts`, `rulesets.repository.ts`, `rulesets.service.ts`, `rulesets.controller.ts`, `rulesets.module.ts`. |
| [app.module.ts](../../../src/app.module.ts) | Registra `RulesetsModule`. |
| [error-codes.ts](../../../src/common/http/error-codes.ts), [messages.ts](../../../src/common/http/messages.ts) | Cinco códigos `RULESET_*` con texto es/en. |
| [ruleset.ts](../../../src/evaluations/engine/ruleset.ts) | `isRuleset` (forma de lo guardado). |
| [requests/rulesets.http](../../../requests/rulesets.http) | Peticiones de ejemplo: guardar, incoherente, listar y consultar. |
| [prisma-migrations.test.mjs](../../../test/prisma-migrations.test.mjs), [projects.repository.int-spec.ts](../../../test/features/projects/projects.repository.int-spec.ts) | Cuentan las migraciones: 7 → 8. Es el único cambio en aserciones existentes. |

## Comprobación

| Comando o prueba ejecutada | Resultado observado |
| --- | --- |
| `tsc -p tsconfig.json --noEmit` | Sin errores. |
| `pnpm lint` | Sin avisos. |
| `prettier --check` sobre `src`, `test/features` y los archivos tocados | Formato correcto. |
| `prisma migrate diff` desde PGlite con las migraciones aplicadas hacia `schema.prisma` | «This is an empty migration»: esquema y migraciones coinciden. |
| `rulesets.dto.spec.ts` (16) con el `ValidationPipe` real | `type` desconocido, ausente, numérico, `__proto__` o `constructor` → `rules.0.type:FIELD_UNSUPPORTED`; `null`, cadena o arreglo → 400 sin excepción; límites de mapeo, reglas, plantilla y `value`. |
| `rulesets.repository.int-spec.ts` (8) con PGlite | Revisiones 1 y 2, que empiezan en 1 en cada proyecto; colisión forzada → 409 sin guardar; 404 ajeno y 409 sin configuración; `CHECK` de la base; forma inválida rechazada al leer; cascada desde `deleteProject`. |
| `rulesets.e2e-spec.ts` (15) con HTTP real | 401; 201 con revisiones 1 y 2; `null` y `__proto__` → 400, nunca 500; issues de coherencia con su atributo; 404 para Bob y 400 con un UUID inválido; 409 sin configuración; listado paginado; revisiones `4`, `0`, `-1`, `abc`, `1.5` y `99999999999` → 404. |
| `isRuleset` (11, en `ruleset-issues.spec.ts`) | Acepta la forma de dominio; rechaza diez formas incorrectas. |
| Mutación X3 (sin `FOR UPDATE`) | Las pruebas siguen pasando: el bloqueo no se puede demostrar con PGlite. Código restaurado y comparado con `diff`. |
| `pnpm test:features` | 22 suites y 355 pruebas en verde (+55: 50 nuevas y 5 del catálogo de mensajes). |
| `pnpm db:verify` | 3 de 3; incluye desplegar las 8 migraciones en PGlite sin repetirlas. |

**No verificado:**
- La migración **no se aplicó en Neon**: hace falta `pnpm db:migrate` con la base real, y es una acción del usuario.
- La API no se arrancó contra Neon y `requests/rulesets.http` no se ejecutó.
- El bloqueo no se probó contra PostgreSQL real (X3).
- Todo se ejecutó con Node 26.9.0, no con 24.19.0.

## Consecuencias y continuidad

- E3 usará `ruleset_versions(project_id, id)` como destino de su FK compuesta, `findByRevision` para fijar la versión y `isRuleset` al leerla.
- GraphQL sigue fuera (plan `02`).
- Si se quiere demostrar el bloqueo, se necesita un PostgreSQL real (por ejemplo, una rama de Neon para pruebas). Esa misma prueba cubriría la importación y E3.
- No hay commit.
