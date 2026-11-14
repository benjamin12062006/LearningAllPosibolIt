# 02 — Plan: listar las evaluaciones de un proyecto

Fecha de creación: 2026-11-04
Estado: Plan
Ámbito: módulo `evaluations` de la API
Relacionada con: [plan 01](01-plan-rulesets-y-evaluations.md) (D10, consultas), [bitácora 04](../../../../bitacora-construccion/feature/rulesets&evaluations/04-informe-de-la-evaluacion.md), [plan de la web](../../../../../LearningAllPosibolIt-web/docs/plans/feature/rulesets&evaluations/01-plan-paginas-reglas-y-evaluaciones.md) (incremento 5, bloqueado por esta ruta)
Revisión de referencia: `f6b4bf9`, con cambios sin commit de otras features (feeds, organizaciones) que no se tocan; en `evaluations.service.ts` ya hay un `acceptPlanned` pendiente de feeds.

## Objetivo

`GET /api/v1/projects/:projectId/evaluations` devuelve las evaluaciones del proyecto, de la más reciente a la más antigua y paginadas, con la misma vista que `GET …/evaluations/:evaluationId` (sin muestra). La web lo necesita para mostrar el historial: hoy solo puede abrir una evaluación por su id.

Estará completo cuando las pruebas nuevas y las existentes de evaluaciones pasen y la respuesta siga las mismas reglas de paginación y propiedad que el resto de listados.

## Punto de partida

D10 definió tres lecturas de una evaluación concreta, pero ningún listado. `rulesets` ya lista revisiones con `PaginationQueryDto`, `resolvePage`, `fetchWindow` y `toPage` (sin `COUNT`). `findByOwner` del repositorio ya lee la vista de una evaluación comprobando el propietario.

## Decisiones

| Necesidad             | Fuente                                                     | Decisión                                                                                                                            |
| --------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Forma de la respuesta | `RulesetsController.findAll`, `ProjectsController.findAll` | `{ evaluations, page }` con `page.hasMore`, como los demás listados                                                                 |
| Límites y parámetros  | `src/common/http/pagination.ts`                            | `PaginationQueryDto` sin parámetros nuevos: `limit` 1–100 (20 por defecto), `offset` ≥ 0, desconocidos rechazados                   |
| Orden                 | Plan de la web (historial)                                 | `created_at DESC, id DESC`: el `id` desempata dos evaluaciones del mismo instante y deja el orden estable entre páginas             |
| Propiedad             | Plan 01, «Un propietario no ve… evaluaciones de otro»      | `ProjectsService.findOwned` primero (404 `PROJECT_NOT_FOUND` como en rulesets) y la consulta filtra además por `p.owner_id`         |
| Columnas              | `findByOwner`                                              | Extraer sus columnas y su `FROM … JOIN` a constantes con nombre y usarlas en las dos consultas, para que la vista no pueda divergir |
| Muestra               | D10                                                        | No se incluye: un listado no lee filas evaluadas                                                                                    |
| Índice                | Migración `create_evaluations` (solo cola y filas)         | Sin migración: las evaluaciones por proyecto son pocas. Revisar si un proyecto supera miles                                         |
| GraphQL               | Plan aplazado de sincronización                            | Fuera: se sumará con el resto en ese plan                                                                                           |

## Incrementos

1. Repositorio `findAllByOwner` con las columnas compartidas; servicio `findAll`; ruta `GET` en el controlador.
2. Pruebas e2e en `evaluations.e2e-spec.ts`: orden, paginación con `hasMore`, sin muestra, 404 para otro propietario, 400 con un parámetro desconocido, lista vacía. Repetir las suites de evaluaciones.
3. Petición de ejemplo en `requests/evaluations.http` y bitácora 05.

## Comprobación prevista

`tsc --noEmit`, `pnpm lint`, `prettier --check` de lo tocado, y las suites de `test/features/evaluations` (línea base medida el 2026-11-04: 7 suites, 179 pruebas en verde con Node 26.9.0).

## Límites y continuidad

No cambia ninguna ruta existente ni la base de datos. Fuera: filtros por estado o revisión, GraphQL y el índice. El commit incluirá solo los cambios de este plan, no los de otras features pendientes en el árbol.
