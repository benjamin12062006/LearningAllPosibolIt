# 07 — Unicidad en Prisma, límites de PGlite e índice único parcial

Fecha de creación: 2026-11-01  
Tipo de fuente: experimento local, documentación de un paquete instalado y documentación oficial de PostgreSQL.  
Origen:
- Prisma 7.10.0 con `@prisma/adapter-pg` sobre PGlite;
- README de `@electric-sql/pglite-socket` 0.2.14;
- PostgreSQL 18, §11.8.

Fecha de consulta: 2026-11-01  
Revisión de referencia: `1f0be2d`, con cambios sin commit.  
Relacionada con: [fuentes técnicas, F22–F24](02-fuentes-tecnicas.md), [experimentos](experimentos/), [plan 01](../../../plans/feature/rulesets&evaluations/01-plan-rulesets-y-evaluations.md) (D1, D8), [bitácora 02](../../../../bitacora-construccion/feature/rulesets&evaluations/02-guardar-versiones-de-reglas.md), [bitácora 03](../../../../bitacora-construccion/feature/rulesets&evaluations/03-evaluacion-asincrona.md).

## Necesidad

Hay tres puntos del plan que dependen de comportamiento real y no solo de la documentación:
- **D1:** que una revisión repetida responda `409` y no `500`.
- **D1/D8:** si las pruebas pueden demostrar los bloqueos.
- **D8:** cómo garantizar en la base que un proyecto no tenga dos evaluaciones activas.

Las evidencias F33 y F34 se obtuvieron en E2 y al principio solo quedaron en la bitácora 02. Esta ficha las registra como fuentes.

## Evidencia

| ID | Fuente y localizador | Evidencia | Aplicación |
| --- | --- | --- | --- |
| F33 | [Experimento 04](experimentos/04-error-unicidad-prisma.mjs) ([salida](experimentos/04-error-unicidad-prisma.salida.txt)): violar `UNIQUE (identity_issuer, identity_subject)` de `app_users` en PGlite | Con la API del modelo (`appUser.create`): `PrismaClientKnownRequestError` **P2002**, «Unique constraint failed on the constraint». Con `$executeRaw` dentro de una transacción: **P2010**, «Raw query failed. Code: `23505`». En los dos casos `meta.driverAdapterError.cause.kind` es `UniqueConstraintViolation`. | Las inserciones que deben traducir una violación de unicidad a `409` usan la API del modelo. F24 documenta P2002, pero no aclara que `$queryRaw` lo cambia a P2010. |
| F34 | [README de pglite-socket](../../../../node_modules/@electric-sql/pglite-socket/README.md), l. 12 y l. 288 | «PGlite is a single-connection database»; las conexiones simultáneas pasan por «a multiplexer implemented in the server […] not all use cases are guaranteed to work». | Confirmado por mutación en E2: sin `FOR UPDATE`, las pruebas de concurrencia siguen pasando. Con PGlite no se pueden demostrar bloqueos de fila ni `SKIP LOCKED`. |
| F35 | [PostgreSQL 18: Partial Indexes](https://www.postgresql.org/docs/current/indexes-partial.html), §11.8 y ejemplo 11.3 | Un índice parcial contiene solo las filas que cumplen su predicado. `CREATE UNIQUE INDEX … WHERE success` «enforces uniqueness among the rows that satisfy the index predicate, without constraining those that do not». Advertencia: el planificador solo lo usa en consultas cuyo `WHERE` implica el predicado. | Índice único parcial `evaluations (project_id) WHERE status IN ('queued','running')`: como mucho una evaluación activa por proyecto, garantizado por la base y no solo por el bloqueo. |

## Interpretación y límites

- F33 se obtuvo con PGlite. El código de error lo genera el motor de PostgreSQL (`23505`) y Prisma lo traduce. Con Neon debería pasar lo mismo, pero no se comprobó.
- F34 no dice que el bloqueo esté mal. Dice que **no se puede demostrar** en esta base de pruebas. F22 sigue siendo su respaldo hasta probarlo contra un PostgreSQL real.
- F35 es una restricción, no una consulta, así que la advertencia del planificador no afecta a la garantía. Una evaluación activa duplicada falla al insertar con `23505`, que llega como P2002 si se inserta con la API del modelo (F33). PGlite ejecuta el PostgreSQL real compilado a WASM, así que la restricción sí se puede probar ahí.

## Aplicación en el proyecto

- E2: `RulesetsRepository.create` usa `tx.rulesetVersion.create` (F33). La prueba de concurrencia lleva un comentario con el límite de F34.
- E3: migración con el índice parcial de F35 y alta de la evaluación con `tx.evaluation.create`, para que la colisión llegue como P2002 y se traduzca a `409 EVALUATION_ALREADY_ACTIVE`.
