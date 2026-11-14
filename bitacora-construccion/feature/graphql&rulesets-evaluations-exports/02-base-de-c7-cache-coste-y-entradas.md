# 02 — C7.1: la base de GraphQL (caché por petición, coste y entradas)

Fecha de creación: 2026-11-14  
Estado: Implementado y verificado (2026-11-14). Sin commit.  
Relacionada con: [plan 02 de C7](../../../docs/plans/feature/graphql&rulesets-evaluations-exports/02-plan-c7-implementar-graphql.md) (G2, G3, G5 y G7), [ficha 05, inventario y mediciones](../../../docs/fonts/feature/graphql&rulesets-evaluations-exports/05-inventario-y-alcance-de-c7.md), [bitácora 01, piloto](01-piloto-de-c7-y-mediciones.md).  
Revisión de partida: `feature/cierre-backend` `fb32457` más los bloques A y B sin commit.

## Necesidad

El piloto dejó dos condiciones antes de añadir más campos: que GraphQL no haga más trabajo que REST (el diagnóstico hacía 38 sentencias SQL frente a 33) y que una consulta no pueda pedir sin límite. Además, C7.2 necesita dos piezas para las entradas: un JSON de entrada para los árboles del dominio y validar con el DTO REST lo que GraphQL recibe con otra forma.

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| Piloto: cada campo vuelve a buscar a la persona y su acceso al proyecto | Recordar esas dos lecturas durante una petición HTTP con `AsyncLocalStorage`; sirve a REST y a GraphQL | [`request-cache.ts`](../../../src/common/http/request-cache.ts); middleware en [`configure-http.ts`](../../../src/configure-http.ts); `UsersService.findCurrent` y `ProjectsRepository.findAccess` |
| Una lectura que falla no debe quedarse recordada; fuera de una petición (procesos de fondo) no hay nada que recordar | Se borra la promesa rechazada; sin petición, se lee siempre | `rememberForRequest` |
| 23 pide límites de coste además de la profundidad; no hay dependencia instalada y otra sesión toca `package.json` | Un cálculo propio en un plugin de Apollo, con las variables: cada campo 1; una lista, lo de dentro por su `limit` (o el de su página); los campos que leen archivos o catálogos, 10. Máximo 1.000 | [`query-cost.ts`](../../../src/graphql/common/query-cost.ts), [`query-cost.plugin.ts`](../../../src/graphql/common/query-cost.plugin.ts) |
| El primer cálculo multiplicaba por el límite todo lo que colgaba de una página (también los recuentos): el diagnóstico del piloto, legítimo, salía por encima de 1.000 | El límite de una página solo multiplica sus listas (`changes`), no `counts` ni `page` | `fieldCost` |
| Los árboles del dominio (filtro de filas, operaciones de un borrador, plantilla) ya tienen analizador | Entran como `JSONObject` (solo objetos) y los valida el mismo analizador que en REST | [`json-object.scalar.ts`](../../../src/graphql/common/json-object.scalar.ts) |
| Las reglas llegan por GraphQL con otra forma (`@oneOf`) que el cuerpo REST | Las opciones del `ValidationPipe` pasan a una constante y `validateAs(Dto, cuerpo)` valida con ellas, con la misma fábrica de errores | [`validation-options.ts`](../../../src/common/http/validation-options.ts) |

No se consultaron cursos: son las decisiones G2, G3, G5 y G7 del plan de C7, con la documentación de Nest y graphql-js de la ficha 02.

## Contrato

- Una consulta que cuesta más de 1.000 responde **HTTP 400** sin ejecutar nada, con `GRAPHQL_QUERY_TOO_COSTLY` (código nuevo, al final de `error-codes.ts` y `messages.ts`), `cost`, `maxCost` y `requestId` en `extensions`.
- `JSONObject` acepta un objeto escrito en la consulta (con variables dentro) o por variable; cualquier otra cosa se rechaza antes del resolver.
- REST no cambia: mismas respuestas, menos sentencias.

## Medición repetida (2026-11-14)

Los mismos recorridos del piloto, contando las sentencias SQL (`pg.Client.query`) con PGlite. Datos de las pruebas, no los 500 productos del piloto: el número de sentencias no depende del tamaño.

| Recorrido | Sin caché (REST / GraphQL) | Con caché (REST / GraphQL) |
| --- | --- | --- |
| Diagnóstico del feed (feed, entrega, comparación y «Requiere atención») | 33 / 38 | **26 / 22** |
| Hoja con columnas y filas | 9 / 9 | 9 / 8 |
| Control: un proyecto | 3 / 3 | 3 / 3 |

Sin caché salen exactamente las cifras del piloto. **El objetivo se cumple: el diagnóstico por GraphQL baja de 38 a 22 sentencias, por debajo de las 26 de REST.** REST también baja (33 → 26) porque sus servicios repetían las mismas dos lecturas dentro de una ruta.

## Comprobaciones realmente ejecutadas (2026-11-14)

- **Pruebas nuevas:** 4 de la caché ([`request-cache.spec.ts`](../../../test/features/http/request-cache.spec.ts)), 5 del coste ([`query-cost.spec.ts`](../../../test/features/graphql/query-cost.spec.ts)), 4 del escalar ([`json-object.scalar.spec.ts`](../../../test/features/graphql/json-object.scalar.spec.ts)) y, en [`pilot.e2e-spec.ts`](../../../test/features/graphql/pilot.e2e-spec.ts), el rechazo con 400 de una consulta cara (literal y por variables) y que el diagnóstico no hace más SQL que REST y lee **una sola vez** a la persona y su acceso.
- **Prueba añadida al contrato HTTP:** un campo que el DTO no declara se rechaza con `FIELD_NOT_ALLOWED` y su nombre ([`errors.e2e-spec.ts`](../../../test/features/http/errors.e2e-spec.ts)). Nadie comprobaba esa opción con la configuración real: la prueba del DTO de reglas usa su propia copia de las opciones.
- **Batería completa** (con la caché, antes de C7.2): **113 suites pasan (1 saltada) y 1.785 pruebas (5 saltadas).**
- **Defectos a propósito:** **15 de 15 detectados.** La primera tanda dejó dos sin detectar; se reforzaron las pruebas y se repitieron.

  | Id | Defecto | Detectado |
  | --- | --- | --- |
  | C71-1 | Una sola clave para todo | Sí |
  | C71-2 | Se recuerda un fallo | Sí |
  | C71-3 | La caché se comparte entre peticiones | Sí |
  | C71-4 | La persona no se recuerda | Sí |
  | C71-5 | El acceso no se recuerda | Sí, tras contar las lecturas de acceso en el diagnóstico |
  | C71-6 | Las listas no se multiplican | Sí |
  | C71-7 | La página no pasa su límite | Sí |
  | C71-8 | Límite de las variables ignorado | Sí |
  | C71-9 | Campos pesados como cualquiera | Sí |
  | C71-10 | Fragmentos sin contar | Sí |
  | C71-11 | El plugin no rechaza | Sí |
  | C71-12 | Plugin sin registrar | Sí |
  | C71-13 | `JSONObject` admite listas | Sí |
  | C71-14 | `JSONObject` admite cualquier literal | Sí |
  | C71-15 | Opciones de validación cambiadas | Sí, tras la prueba de `FIELD_NOT_ALLOWED` |

## Consecuencias

- Cada campo nuevo de C7.2–C7.4 puede volver a llamar a su servicio sin coste en la base por la persona ni por el acceso.
- Una lista sin `limit` cuenta una vez. Si alguna crece sin límite del dominio, necesita `limit` o un peso en `HEAVY_FIELDS`.
- `@Args()` sin nombre recibe **todos** los argumentos de la operación: con la lista blanca, una clase de página debe dejar pasar los demás (lo encontró C7.2, ver la [bitácora 03](03-proyecto-reglas-evaluaciones-y-exportaciones.md)).
