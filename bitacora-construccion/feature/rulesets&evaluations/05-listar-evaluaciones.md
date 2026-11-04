# 05 — Listar las evaluaciones de un proyecto

Fecha de creación: 2026-11-04
Estado: Implementado y verificado
Ámbito: [plan 02](../../../docs/plans/feature/rulesets&evaluations/02-plan-listar-evaluaciones.md)
Relacionada con: [04 informe de la evaluación](04-informe-de-la-evaluacion.md), [plan de la web](../../../../claudeLearningAllPosibolIt-web/docs/plans/feature/rulesets&evaluations/01-plan-paginas-reglas-y-evaluaciones.md) (incremento 5)
Revisión de partida: `f6b4bf9`, con cambios sin commit de otras features en el árbol (feeds, organizaciones). En `evaluations.service.ts` ya estaba `acceptPlanned` de feeds; no se tocó ni entra en este commit.

## Necesidad y punto de partida

La web `claudeLearningAllPosibolIt-web` solo podía abrir una evaluación por su id: la API no tenía un listado. El usuario pidió añadirlo en la API para desbloquear el historial.

## Evidencia y decisiones

Las decisiones están en el plan 02; aquí, cómo quedaron en el código.

| Decisión                                          | Archivo y símbolo                                                                                                         | Detalle                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Misma vista en la consulta de una y en el listado | [evaluations.repository.ts](../../../src/evaluations/evaluations.repository.ts) `EVALUATION_COLUMNS`, `EVALUATION_SOURCE` | Las columnas y el `FROM … JOIN` de `findByOwner` pasan a dos constantes; `findByOwner` las usa sin cambiar su SQL |
| Listado paginado y estable                        | mismo archivo, `findAllByOwner`                                                                                           | Filtra por proyecto y propietario; `ORDER BY e.created_at DESC, e.id DESC`; `LIMIT`/`OFFSET` de `fetchWindow`     |
| Propiedad y paginación como el resto              | [evaluations.service.ts](../../../src/evaluations/evaluations.service.ts) `findAll`                                       | `findCurrent` + `ProjectsService.findOwned` (404 `PROJECT_NOT_FOUND`) y `resolvePage`/`fetchWindow`/`toPage`      |
| Ruta                                              | [evaluations.controller.ts](../../../src/evaluations/evaluations.controller.ts) `findAll`                                 | `GET /api/v1/projects/:projectId/evaluations` con `PaginationQueryDto` → `{ evaluations, page }`                  |
| Ejemplo para WebStorm                             | [requests/evaluations.http](../../../requests/evaluations.http) `listEvaluations`                                         | Entre la consulta de una evaluación y el informe                                                                  |

## Comprobación

| Comprobación                                                                                                                   | Resultado                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Línea base antes de tocar (`test/features/evaluations`)                                                                        | 7 suites y 179 pruebas en verde (Node 26.9.0)                                                                                                                                                                                                                                                                              |
| Pruebas nuevas en [evaluations.e2e-spec.ts](../../../test/features/evaluations/evaluations.e2e-spec.ts), «historial (plan 02)» | Lista vacía con `page` por defecto; tres evaluaciones (dos terminadas y una en cola) en dos páginas con `hasMore`, todas presentes, ordenadas de la más reciente a la más antigua, con su vista y sin `sample`; 404 para Bob y para un proyecto inexistente; 400 con `limit=0`, `limit=101`, `offset=-1` y `status=queued` |
| `test/features/evaluations` después                                                                                            | 7 suites y 186 pruebas en verde (179 + 7)                                                                                                                                                                                                                                                                                  |
| Defecto a propósito: `ORDER BY … ASC`, y restauración con copia + `diff` sin diferencias                                       | 1 prueba falla (la de orden); restaurado, 186 en verde                                                                                                                                                                                                                                                                     |
| `pnpm test:features` completo                                                                                                  | 60 suites y 1.055 pruebas en verde (incluye código sin commit de otras features)                                                                                                                                                                                                                                           |
| `./node_modules/.bin/tsc -p tsconfig.json --noEmit`                                                                            | Sin errores                                                                                                                                                                                                                                                                                                                |
| `pnpm lint` (`oxlint --type-aware src/`)                                                                                       | Salida 0                                                                                                                                                                                                                                                                                                                   |
| `prettier --check` de `src/evaluations`, sus pruebas y el plan                                                                 | Correcto                                                                                                                                                                                                                                                                                                                   |

**Incidencia:** en el primer intento del defecto a propósito, la shell no dejó sobrescribir el log de compilación y la prueba corrió con el código anterior (17 en verde). Se repitió sobrescribiendo el log y entonces falló como se esperaba.

**No verificado:** contra Neon con una sesión real; las pruebas usan PGlite y una sesión simulada.

## Consecuencias y continuidad

No cambia ninguna ruta existente ni la base de datos. GraphQL queda para el plan aplazado de sincronización. Sin índice por `(project_id, created_at)`: revisar si un proyecto llega a miles de evaluaciones. La web puede ya implementar su incremento 5.
