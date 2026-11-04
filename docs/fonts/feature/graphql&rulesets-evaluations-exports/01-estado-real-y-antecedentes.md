# 01 — Estado real y antecedentes de GraphQL para reglas, evaluaciones y exportaciones

Fecha de creación: 2026-11-02  
Estado: Investigación; feature sin plan ni código.  
Tipo de fuente: código local, planes y bitácoras del proyecto, y `docs-diagrams`.  
Origen: API `claudeLearningAllPosibolIt` y `docs-diagrams`.  
Fecha de consulta: 2026-11-02  
Revisión inspeccionada: `f6b4bf9` («feat: revisar y exportar el TSV de una evaluación aprobada») en `feature/reviews-exports`, con la revisión de legibilidad de la [bitácora 08 de reviews&exports](../../../../bitacora-construccion/feature/reviews&exports/08-revision-de-legibilidad.md) sin commit.  
Relacionada con: [fuentes técnicas](02-fuentes-tecnicas.md), [cursos y reconstrucciones](03-cursos-y-reconstrucciones.md), [mapa para el plan](04-mapa-de-necesidades-para-el-plan.md), [plan de GraphQL](../../../plans/db/05-plan-implementar-graphql.md), [plan de rulesets y evaluations](../../../plans/feature/rulesets&evaluations/01-plan-rulesets-y-evaluations.md) (D12).

## Necesidad

El usuario eligió como siguiente feature GraphQL para reglas, evaluaciones y exportaciones. Esta ficha delimita qué existe, qué falta y qué condiciona el diseño. No propone implementación.

## Por qué es la siguiente

- El plan de rulesets y evaluations dejó GraphQL para «un plan `02` cuando REST esté verificado» (D12), y el de reviews&exports lo dejó fuera del incremento 3.
- `docs-diagrams/18` («Puerta de entrada obligatoria») pide terminar los planes vigentes de la API, en su orden, antes de la ampliación 10–19.
- El usuario confirmó la elección el 2026-11-02 y avisó de que `docs-diagrams` tiene ahora más features después (10–19).

## Requisitos y antecedentes (especificación, no evidencia de ejecución)

| ID | Fuente y localizador | Qué fija |
| --- | --- | --- |
| F1 | [docs-diagrams/07, contrato HTTP](../../../../../docs-diagrams/07-arquitectura-y-contratos.md) | Operaciones REST de reglas, evaluaciones y exportaciones de la fase A. GraphQL no aparece en el contrato de los diagramas. |
| F2 | [Plan rulesets&evaluations, D12](../../../plans/feature/rulesets&evaluations/01-plan-rulesets-y-evaluations.md) | «Se añadirá en un plan `02` cuando REST esté verificado, siguiendo la capa separada existente.» |
| F3 | [Plan db/05](../../../plans/db/05-plan-implementar-graphql.md), «Fuentes y decisiones» y «Decisiones tomadas al ejecutar» | Reglas de la capa: solo lo que ya ofrece REST; los resolvers llaman a los servicios existentes; los `InputType` repiten los validadores importando las mismas constantes y una prueba comprueba que REST y GraphQL rechazan lo mismo; `/api/graphql`; esquema en memoria con copia esperada en las pruebas; la subida multipart se queda en REST. |

## Código existente

| ID | Código y localizador | Observación |
| --- | --- | --- |
| F4 | [src/graphql/](../../../../src/graphql/) | Capa separada (`GraphqlApiModule`) con resolvers por feature (`users`, `projects`, `catalog-import`) y piezas comunes: `ApiErrorType` y `LocalizedMessageType`, `JsonScalar` (solo salida), `PaginationArgs` (20 por defecto, 100 como máximo), `toGraphQLError` y la regla de profundidad máxima 6 ([graphql-config.ts](../../../../src/graphql/graphql-config.ts)). |
| F5 | Controladores REST: [rulesets](../../../../src/rulesets/rulesets.controller.ts), [evaluations](../../../../src/evaluations/evaluations.controller.ts), [exports](../../../../src/exports/exports.controller.ts) | Reglas: `POST` (crear revisión), `GET` (listar), `GET :revision`. Evaluaciones: `POST` (202, en cola), `GET :id` (`{ evaluation, sample }`), `GET :id/rows?outcome&limit&offset`, `GET :id/errors.csv`. Exportaciones: `POST` (201/200), `GET :exportId`, `GET :exportId/productos.tsv`. |
| F6 | [rulesets.dto.ts](../../../../src/rulesets/rulesets.dto.ts), `CreateRulesetDto`, `toRuleDtos` | La lista `rules` tiene tres tipos de regla con campos distintos. Se valida con un despacho manual en `@Transform`, porque el discriminador de `@Type` de class-transformer 0.5.1 falla con un elemento `null` (ficha 05 de rulesets&evaluations). Límites en `RULESET_LIMITS`. |
| F7 | Vistas: `EvaluationView` y `EvaluationRowView` ([evaluations.types.ts](../../../../src/evaluations/evaluations.types.ts)), `ProblemView` ([problem-messages.ts](../../../../src/evaluations/problem-messages.ts)), `ExportView` ([exports.types.ts](../../../../src/exports/exports.types.ts)) | Conteos que pueden ser nulos, error público, versiones del motor y del perfil, filas con valores (o nulos si la fila está excluida) y problemas con su texto es/en. |
| F8 | [graphql.e2e-spec.ts](../../../../test/features/graphql/graphql.e2e-spec.ts), [schema.expected.graphql](../../../../test/features/graphql/schema.expected.graphql), [max-query-depth.spec.ts](../../../../test/features/graphql/max-query-depth.spec.ts) | Patrón de pruebas: E2E con dos propietarios y comparación del esquema generado con una copia esperada. |
| F9 | [configure-http.ts](../../../../src/configure-http.ts) | `ValidationPipe` global con `transform`, `whitelist` y `forbidNonWhitelisted`; también se aplica a los argumentos de GraphQL. |

## Hallazgos que el plan debe tener en cuenta

1. **Reglas de tres tipos como entrada.** GraphQL no admite uniones en la entrada. Hay que elegir entre un `InputType` con `@oneOf` (lo admiten las versiones instaladas, ficha 02), un JSON o un tipo plano con campos opcionales y `type`. El despacho manual de F6 no existe en GraphQL.
2. **Reglas como salida.** Una unión de tipos (`createUnionType`) o un JSON de solo salida, como `originalValues` de `ImportRow`.
3. **Archivos.** `errores.csv` y `productos.tsv` son descargas binarias; GraphQL responde JSON (ficha 02). Lo natural es que GraphQL devuelva URL y metadatos y la descarga siga en REST, igual que la subida del CSV.
4. **Estados HTTP.** REST distingue 202 (evaluación en cola) y 201/200 (exportación nueva o existente). GraphQL siempre responde 200, así que esa información tiene que ir en el cuerpo (por ejemplo, `created`).
5. **Módulos.** `ExportsModule` no exporta `ExportsService` y `GraphqlApiModule` no importa reglas, evaluaciones ni exportaciones.
6. **Profundidad.** `evaluation → rows → problems → problem → es` tiene 5 niveles; cabe en el límite de 6, pero conviene comprobarlo en el plan.

## Límites de esta ficha

- No se ha ejecutado ninguna prueba de `@oneOf` con el `ValidationPipe` global; queda como experimento para el plan.
- No hay ningún cliente que consuma estas operaciones todavía (la web es otro repositorio).
