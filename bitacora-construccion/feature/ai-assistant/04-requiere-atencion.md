# 04 — V3: «Requiere atención» (problemas agrupados y exclusiones)

Fecha de creación: 2026-11-12  
Estado: Implementado y verificado (2026-11-12). Sin commit.  
Relacionada con: [plan 02 de cierre](../../../docs/plans/feature/cierre-backend/02-plan-terminar-hojas-visor-y-agente.md) (P4), [fuentes 04](../../../docs/fonts/feature/cierre-backend/04-fuentes-de-terminar-hojas-visor-y-agente.md) (E4, H4), [bitácora 03, V2](03-ficha-de-producto-y-estado-de-la-entrega.md), [22, visor y diagnóstico](../../../../docs-diagrams/22-visor-y-diagnostico-del-feed.md).  
Revisión de partida: `feature/cierre-backend` `b219b30` más los cambios sin commit.

## Necesidad

El informe de una evaluación da las filas una a una. Para decidir qué arreglar antes de publicar hace falta el resumen que pide 22: «12 productos sin precio», «8 enlaces con formato inválido», cuántos productos distintos hay afectados y, aparte, cuántos dejó fuera cada regla. Y poder abrir cada grupo para ver sus productos.

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| E4: `evaluation_rows.problems` es una lista `jsonb` de `{ attribute, code }` | Agrupar en SQL con `jsonb_array_elements`, contando productos distintos | `findProblemGroups` en [`evaluations.repository.ts`](../../../src/evaluations/evaluations.repository.ts) |
| H4: un producto en dos grupos cuenta una vez en el total | El total es el recuento de inválidos que ya guarda la evaluación, no la suma de los grupos | `EvaluationsService.findAttention` |
| H4: las exclusiones son decisiones de las reglas, no errores | Grupo propio por posición de regla, con la regla de la revisión con la que se evaluó | `findExclusionGroups` |
| El motor solo da códigos; los textos están en `describeProblem` | Cada grupo lleva problema y sugerencia en español e inglés, como las filas | `ProblemGroupView` en [`evaluations.types.ts`](../../../src/evaluations/evaluations.types.ts) |
| Ya existe `GET …/rows` paginado | Abrir un grupo es el mismo informe con filtros nuevos, no otra ruta | `EvaluationRowsQueryDto`, `rowFilterSql` |

## Contrato

```http
GET /api/v1/projects/:projectId/evaluations/:evaluationId/attention
GET /api/v1/projects/:projectId/evaluations/:evaluationId/rows?attribute=price&code=PRICE_FORMAT_INVALID
GET /api/v1/projects/:projectId/evaluations/:evaluationId/rows?rule=4
```

```json
{
  "attention": {
    "evaluationId": "…",
    "affectedProducts": 3,
    "problemGroups": [
      { "attribute": "price", "code": "…", "productCount": 2,
        "problem": { "es": "…", "en": "…" }, "suggestion": { "es": "…", "en": "…" } }
    ],
    "excludedProducts": 3,
    "exclusionGroups": [
      { "rulePosition": 4, "rule": { "type": "exclude_when", "attribute": "brand", "operator": "is_empty" }, "productCount": 2 }
    ]
  }
}
```

- Los grupos van del más frecuente al menos.
- `attribute` y `code` llegan juntos o no llegan (400 si viene uno solo); `rule` es la posición de la regla, desde 1. Los filtros se suman entre sí, con `outcome` y con la paginación.
- Una evaluación sin terminar responde 409 `EVALUATION_RESULTS_UNAVAILABLE`, como el informe de filas.
- Cualquier miembro puede leerlo; lo ajeno, 404.

## Ajustes al escribir el código

- `EvaluationsRepository.findRows` recibe ahora un filtro (`{ outcome, problem, excludedByRule }`) en lugar del resultado suelto. Se cambiaron las dos llamadas de `evaluations.repository.int-spec.ts`; sus aserciones no se tocaron.
- La consulta HTTP anterior (`?outcome=`) responde igual: hay una prueba que lo fija.

## Comprobaciones realmente ejecutadas (2026-11-12)

- **Pruebas de evaluaciones:** 207 de 207. Nuevas: 16 E2E en [`attention.e2e-spec.ts`](../../../test/features/evaluations/attention.e2e-spec.ts), con un catálogo de nueve productos (dos válidos, uno con dos problemas, dos códigos distintos en el mismo atributo, uno sin imagen y tres excluidos por dos reglas):
  - un producto con dos problemas está en dos grupos y cuenta una vez; la suma de los grupos (5) no es el total de afectados (4);
  - cada grupo lleva código y textos en los dos idiomas; las exclusiones van aparte, por regla y con la regla que las causó;
  - el resumen coincide con los recuentos de la evaluación y con sus filas; un catálogo sin problemas no tiene grupos;
  - abrir un grupo por problema o por regla; el atributo y el código tienen que coincidir en el mismo problema; los filtros se suman con `outcome` y con la paginación; sin filtros nuevos el informe responde igual que antes; validación (400);
  - evaluación sin terminar 409, inexistente 404, Viewer sí, otra organización 404, sin sesión 401.
- **Defectos a propósito:** 15 probados.

  | Id | Defecto | Resultado |
  | --- | --- | --- |
  | V3-1 | Los grupos cuentan filas de cualquier resultado | **Equivalente:** solo las filas inválidas tienen problemas, así que el filtro no cambia el resultado. Se deja porque aprovecha el índice por resultado. |
  | V3-2 | Agrupar solo por atributo | Detectado, tras añadir un segundo código en el mismo atributo |
  | V3-3 | Orden de los grupos sin el recuento | Detectado |
  | V3-4 | Regla con la posición desplazada | Detectado |
  | V3-5 | Exclusiones sin filtrar por resultado | Detectado |
  | V3-6 | Afectados = suma de los grupos | Detectado |
  | V3-7 | Excluidos contados como afectados | Detectado, tras desigualar inválidos y excluidos en el catálogo de prueba |
  | V3-8 | Informe de una evaluación sin terminar | Detectado |
  | V3-9 | Filtro de problema ignorado | Detectado |
  | V3-10 | Filtro de regla ignorado | Detectado |
  | V3-11 | Problema por atributo sin mirar el código | Detectado |
  | V3-12 | Filtro de resultado perdido | Detectado (por las pruebas antiguas del informe) |
  | V3-13 | Atributo sin código aceptado | Detectado |
  | V3-14 | Regla 0 aceptada | Detectado |
  | V3-15 | Grupo sin textos | Detectado por el compilador (`ProblemGroupView`) |

  Los defectos V3-2 y V3-7 no se detectaban con el primer catálogo de prueba: cada atributo tenía un solo código y había tantos inválidos como excluidos. Se añadió un producto sin precio y se repitieron.
- **`tsc`, `pnpm lint` y Prettier:** limpios.
- **Batería completa:** 100 suites pasan (1 saltada) y 1.632 pruebas (5 saltadas).
- **Arranque real:** la ruta responde 401 sin sesión y 404 `EVALUATION_NOT_FOUND` con sesión; sin errores registrados.
- Sin migraciones: el esquema no cambia.

## Consecuencias

- El panel «Requiere atención» de 22 tiene su resumen y puede abrir cada grupo.
- El agente podrá usar la misma lectura (`get_evaluation_report` de 15) cuando exista el catálogo de operaciones.
