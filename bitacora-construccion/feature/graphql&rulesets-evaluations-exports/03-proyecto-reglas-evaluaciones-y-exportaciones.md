# 03 — C7.2: proyecto, reglas, evaluaciones y exportaciones por GraphQL

Fecha de creación: 2026-11-14  
Estado: Implementado y verificado (2026-11-14). Sin commit.  
Relacionada con: [plan 02 de C7](../../../docs/plans/feature/graphql&rulesets-evaluations-exports/02-plan-c7-implementar-graphql.md) (G1, G5–G8), [ficha 05, matriz](../../../docs/fonts/feature/graphql&rulesets-evaluations-exports/05-inventario-y-alcance-de-c7.md), [bitácora 02, C7.1](02-base-de-c7-cache-coste-y-entradas.md).  
Revisión de partida: `feature/cierre-backend` `fb32457` más C7.1 sin commit.

## Necesidad

El recorrido central del producto (importar → reglas → evaluar → exportar) solo existía en REST. El agente y la web necesitan leer el proyecto entero en una llamada y hacer el recorrido sin mezclar dos clientes.

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| Ficha 05: resumen del proyecto, 6 llamadas REST | Lo que cuelga del proyecto es campo suyo: `access`, `imports`, `rulesets`, `evaluations`, `feeds`, `knowledge`, `workbooks` | [`project-fields.resolver.ts`](../../../src/graphql/projects/project-fields.resolver.ts) |
| Las listas REST devuelven `{ x, page }` con `hasMore` | Cada lista nueva es una página `{ items, page }` con el mismo `PageInfo` | [`page-info.type.ts`](../../../src/graphql/common/page-info.type.ts) |
| N2: una regla es una de tres formas | `RuleInput @oneOf { cleanText, buildTitle, excludeWhen }`; el resolver arma el cuerpo REST y lo valida con `validateAs(CreateRulesetDto)` | [`rule-input.ts`](../../../src/graphql/rulesets/rule-input.ts), [`rulesets.resolver.ts`](../../../src/graphql/rulesets/rulesets.resolver.ts) |
| Los atributos y operadores de una regla tienen el error de REST (`FIELD_UNSUPPORTED` en `rules.0.attributes`) | Llegan como texto, no como enumerados GraphQL: el error lo pone el DTO REST | `CleanTextRuleInput`, `ExcludeWhenRuleInput` |
| `rulesPreview` no guarda nada | Es una consulta, con las mismas reglas `@oneOf` | [`evaluations.resolver.ts`](../../../src/graphql/evaluations/evaluations.resolver.ts) |
| REST responde 202 al pedir una evaluación | `requestEvaluation` devuelve la evaluación en cola (G8) | `request` |
| Los campos de una evaluación o de un feed necesitan su proyecto | Cada elemento de `Project.evaluations` y `Project.feeds` lleva su `projectId` | `evaluationList`, `feedList` |
| La ficha de un producto dice de qué exportación sale | `Export.product.source.export` es la misma exportación, con su proyecto, para poder seguir leyendo | [`exports.resolver.ts`](../../../src/graphql/exports/exports.resolver.ts) |

No se consultaron cursos: son las decisiones del plan de C7 sobre los servicios que ya existían.

## Contrato

- Consultas: `organizationProjects`, `ruleset`, `rulesPreview`, `export`; campos `Project.{access, imports, rulesets, evaluations, feeds, knowledge, workbooks}`, `Evaluation.rows` (con los filtros de REST: `outcome`, `attribute`+`code`, `rule`), `Export.{products, product}`.
- Mutaciones: `createRuleset`, `requestEvaluation`, `approveExport` (devuelve `{ export, downloadUrl, created }`: `created` es falso si la evaluación ya tenía exportación, como el 200 de REST).
- `Evaluation` gana `engineVersion`, `profileVersion`, `startedAt` y `error`.

## Ajustes al escribir el código

- **`@Args()` sin nombre recibe todos los argumentos.** `organizationProjects(organizationId, limit, offset)` respondía `FIELD_NOT_ALLOWED` en `organizationId`: el `ValidationPipe` global (lista blanca) validaba los tres contra `PaginationArgs`. Se resolvió con clases de página que dejan pasar, con `@Allow()` y sin `@Field`, los argumentos que llegan con su propio `@Args` y su pipe de UUID (`OrganizationPageArgs`, `RulesPreviewPageArgs`). Así el UUID sigue dando `INVALID_UUID` como en REST.
- La regla `exclude_when` con `is_empty` se guarda con `value: ""` también por REST: la prueba compara con lo que guarda REST y no con el cuerpo enviado.
- Los campos de error del DTO de reglas son `rules.0.attributes` (no `…attributes.0`): lo que manda es que sean iguales a REST.

## Comprobaciones realmente ejecutadas (2026-11-14)

- **Pruebas:** 14 E2E en [`project-rules-exports.e2e-spec.ts`](../../../test/features/graphql/project-rules-exports.e2e-spec.ts), con la ayuda común [`graphql-test-app.ts`](../../../test/features/graphql/support/graphql-test-app.ts): el resumen del proyecto igual que siete rutas REST; evaluaciones y feeds del proyecto con sus propios campos; `organizationProjects` con su página; **reglas → evaluar → exportar por GraphQL igual que por REST** (reglas guardadas, filas con y sin filtro, aprobación, segunda aprobación, visor con búsqueda y ficha con procedencia); `rulesPreview` igual que REST, también con `baseRevision`; errores con los mismos campos que REST (reglas, vista previa, incoherencias, filtros de filas); `@oneOf` con dos tipos o ninguno; 404; permisos (otra organización, sin sesión, Viewer, Editor que no aprueba).
- **Esquema esperado** regenerado y revisado: `RuleInput @oneOf`, los campos del proyecto y las operaciones nuevas.
- **Defectos a propósito:** **14 de 14 detectados.** C72-14 no se detectó en la primera tanda; se añadió la comparación con `baseRevision` y se repitió.

  | Id | Defecto | Detectado |
  | --- | --- | --- |
  | C72-1 | `cleanText` se guarda como otro tipo | Sí |
  | C72-2 | Se pierde el valor de `exclude_when` | Sí |
  | C72-3 | `createRuleset` sin validar con el DTO REST | Sí |
  | C72-4 | `rulesPreview` sin validar con el DTO REST | Sí |
  | C72-5 | Filas sin filtros | Sí |
  | C72-6 | Evaluaciones del proyecto sin su proyecto | Sí |
  | C72-7 | Feeds del proyecto sin su proyecto | Sí |
  | C72-8 | Libros con otra organización | Sí |
  | C72-9 | `approveExport` siempre `created` | Sí |
  | C72-10 | La procedencia pierde el proyecto | Sí |
  | C72-11 | El visor ignora la búsqueda | Sí |
  | C72-12 | `organizationProjects` ignora la página | Sí |
  | C72-13 | Sin `@oneOf` | Sí |
  | C72-14 | `baseRevision` ignorada | Sí, tras la comparación con `baseRevision` |

## Consecuencias

- **El experimento pendiente de N2 está hecho:** `@InputType({ isOneOf: true })` funciona con `@nestjs/graphql` 14.1 y graphql-js 16.14; dos tipos o ninguno se rechazan antes del resolver con `BAD_REQUEST`.
- El agente puede leer el proyecto y preparar reglas con una sola llamada cada vez; aprobar sigue siendo de la persona (Manager).
