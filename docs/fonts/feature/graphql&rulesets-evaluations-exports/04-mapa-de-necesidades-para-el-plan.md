# 04 — Mapa de necesidades y fuentes para el plan de GraphQL de reglas, evaluaciones y exportaciones

Fecha de creación: 2026-11-02  
Última actualización: 2026-11-02 (feature aplazada al final del backend: [plan 01](../../../plans/feature/graphql&rulesets-evaluations-exports/01-plan-aplazado-sincronizacion-graphql.md))  
Estado: Investigación guardada; feature aplazada; nada decidido ni implementado.  
Tipo de fuente: elaboración propia a partir de las fichas 01–03.  
Origen: código actual, planes del proyecto, curso reconstruido y documentación oficial.  
Fecha de consulta: 2026-11-02  
Revisión del proyecto: `f6b4bf9` con cambios sin commit (ficha 01).  
Relacionada con: [estado real](01-estado-real-y-antecedentes.md), [fuentes técnicas](02-fuentes-tecnicas.md), [cursos y reconstrucciones](03-cursos-y-reconstrucciones.md), [plan aplazado](../../../plans/feature/graphql&rulesets-evaluations-exports/01-plan-aplazado-sincronizacion-graphql.md), carpeta de bitácora `bitacora-construccion/feature/graphql&rulesets-evaluations-exports/` (vacía).

## Propósito

Índice para escribir el plan sin repetir la búsqueda, con el formato **Necesidad → requisito → fuentes → decisión pendiente**. Los `F` remiten a las fichas 01–02 y los `C`/`RC`, a la ficha 03.

## Necesidad → requisito → fuentes → decisión pendiente

| # | Necesidad | Requisito | Fuentes | Decisión que debe tomar el plan |
| --- | --- | --- | --- | --- |
| N1 | Qué operaciones se exponen | Plan db/05: solo lo que ya ofrece REST | F3, F5, F15 | Reglas: crear, listar y consultar una revisión. Evaluaciones: evaluar, consultar y filas. Exportaciones: exportar y consultar. ¿Se excluyen las descargas (`errores.csv`, `productos.tsv`) devolviendo solo su URL, igual que la subida del CSV? |
| N2 | Recibir una lista de reglas de tres tipos | Mismas reglas y límites que REST | F6, F9, F11–F13, F18 | `@InputType({ isOneOf: true })` con un campo por tipo (`cleanText`, `buildTitle`, `excludeWhen`), un JSON de entrada o un tipo plano con `type` y campos opcionales. ¿Cómo valida el `ValidationPipe` cada clase anidada (necesita `@ValidateNested` + `@Type` en GraphQL)? Requiere un experimento antes de decidir. |
| N3 | Validar igual que REST | Plan db/05: mismos validadores y misma prueba de paridad | F3, F6 | Reutilizar las constantes de `RULESET_LIMITS`, `PRODUCT_ATTRIBUTES`, etc.; comprobar que los mensajes y `field` de los issues son equivalentes (`rules.2.template` frente al nombre del campo `@oneOf`). Validación cruzada (`RULESET_REFERENCE_INVALID`): la hace el servicio y llega igual. |
| N4 | Devolver las reglas guardadas | Contrato de la vista de REST | F7, F10, F4 (`JsonScalar`) | Unión de salida con `resolveType` por `type` (`createUnionType`), o JSON de solo salida como `originalValues`. |
| N5 | Tipo de la evaluación | Mismos datos que `GET …/evaluations/:id` | F7, RC1 | `Evaluation` con versiones, estado (enum), `counts` como objeto (RC1) que puede ser nulo, `resultChecksum`, fechas y `error` (`ApiErrorType`). ¿`sample` como campo o se sustituye por `rows(limit: 20)`? |
| N6 | Filas del informe | `GET …/rows?outcome&limit&offset` | F5, F7, RC2, RC4, F14 | `rows(outcome, limit, offset)` como `@ResolveField` con `@Parent` que llama a `EvaluationsService.findRows`, frente a una query independiente `evaluationRows`. El total para paginar sale de `counts` (no hace falta el `totalItems` de RC4). |
| N7 | Problemas con texto es/en | `ProblemView` | F7, F4 (`LocalizedMessageType`) | Tipo `RowProblem { attribute code problem: LocalizedMessage suggestion: LocalizedMessage }`; valores de la fila como objeto tipado o JSON de solo salida. |
| N8 | Evaluar | `POST` 202 en cola | F5, C6 | Mutación `evaluate(projectId, input)` que devuelve la evaluación en cola (C6) o `{ evaluationId, status, statusUrl }` como REST. |
| N9 | Exportar | `POST` 201/200 y `downloadUrl` | F5, F15, hallazgo 4 de la ficha 01 | Mutación que devuelve `{ export, downloadUrl, created }`, porque GraphQL siempre responde 200. Query `export(projectId, id)`. |
| N10 | Errores | Mismos códigos y contrato bilingüe | F3, F4 | Los errores del servicio ya pasan por el filtro global; comprobar `EXPORT_*`, `EVALUATION_*`, `RULESET_*` y los issues de validación anidada. |
| N11 | Límites de la capa | Profundidad 6, paginación máxima 100 | F4, hallazgo 6 de la ficha 01 | Comprobar la consulta más profunda prevista; `ArrayMaxSize` en las listas de entrada. |
| N12 | Cableado | Capa separada | F4, RC3, hallazgo 5 de la ficha 01 | `ExportsModule` exporta `ExportsService`; `GraphqlApiModule` importa `RulesetsModule`, `EvaluationsModule` y `ExportsModule`; resolvers en `src/graphql/rulesets`, `src/graphql/evaluations`, `src/graphql/exports`. |
| N13 | Pruebas | Patrón de F8 | F8, F3 | E2E con dos propietarios del recorrido completo por GraphQL; esquema esperado actualizado; prueba de paridad de validación con REST; profundidad. |

## Vacíos sin fuente suficiente

- Comportamiento de `@oneOf` con el `ValidationPipe` global y Apollo Server 5: no probado (ficha 02).
- Ningún curso enseña uniones ni entradas `@oneOf`.
- No hay cliente que fije preferencias de forma (por ejemplo, unión frente a JSON para las reglas).

## Siguiente paso

Escribir `docs/plans/feature/graphql&rulesets-evaluations-exports/01-plan-graphql-reglas-evaluaciones-exportaciones.md` cuando el usuario lo pida, con una decisión `D` por cada `N` y, antes de cerrarlo, el experimento de N2.
