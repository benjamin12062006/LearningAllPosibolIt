# 02 — Fuentes técnicas para GraphQL de reglas, evaluaciones y exportaciones

Fecha de creación: 2026-11-02  
Estado: Investigación; feature sin plan ni código.  
Tipo de fuente: documentación oficial (NestJS, especificaciones de GraphQL) y paquetes instalados.  
Fecha de consulta: 2026-11-02 (todas las URL de esta ficha)  
Revisión del proyecto: `f6b4bf9` con cambios sin commit (ficha 01).  
Relacionada con: [estado real](01-estado-real-y-antecedentes.md), [cursos y reconstrucciones](03-cursos-y-reconstrucciones.md), [mapa para el plan](04-mapa-de-necesidades-para-el-plan.md), [fuente db/04 (curso de GraphQL, R1–R19)](../../db/04-curso-nest-graphql-reconstrucciones.md).

## Necesidad

Cubrir lo que el curso no enseña: entradas con varios tipos posibles (las reglas), uniones de salida, el alcance de GraphQL sobre HTTP para archivos y lo que admiten las versiones instaladas. Los textos son paráfrasis; se indica la sección.

## Fuentes consultadas

| ID | Fuente y sección | Qué establece (paráfrasis) | Uso para el plan |
| --- | --- | --- | --- |
| F10 | [NestJS: Unions and Enums](https://docs.nestjs.com/graphql/unions-and-enums), «Unions → Code first» | `createUnionType({ name, types: () => [A, B] as const })`; por defecto el tipo concreto se deduce de la instancia devuelta, así que hay que devolver instancias de clase y no objetos literales; con `resolveType(value)` se elige la clase a mano. La página no habla de uniones de entrada. | Salida tipada de las reglas (unión de tres tipos) frente a JSON. |
| F11 | [GraphQL Specification, Working Draft](https://spec.graphql.org/draft/#sec-OneOf-Input-Objects), §3.10.1 «OneOf Input Objects», §3.10 (validación, punto 2.5) y §3.13.5 «@oneOf» | Un `@oneOf` debe recibir exactamente un campo, y no nulo; si no, es un error de la petición. Todos sus campos deben ser anulables y sin valor por defecto. Directiva `directive @oneOf on INPUT_OBJECT`. | Entrada de una regla como «uno de tres tipos» sin JSON ni despacho manual. |
| F12 | Paquete instalado `@nestjs/graphql` 14.1.0: `dist/decorators/input-type.decorator.d.ts` (opción `isOneOf`, que cita la edición de septiembre de 2025 de la especificación) y `dist/schema-builder/factories/input-type-definition.factory.js` (l. 26, pasa `isOneOf` al tipo) | `@InputType({ isOneOf: true })` existe y llega al esquema en la versión instalada. | Confirma que la opción de F11 es viable sin dependencias nuevas. |
| F13 | Paquete instalado `graphql` 16.14.2: `type/definition.d.ts` (l. 3116, `isOneOf: boolean`) y `type/directives.d.ts` | El motor de GraphQL instalado conoce los tipos `@oneOf`. | Ídem. |
| F14 | [NestJS: Resolvers](https://docs.nestjs.com/graphql/resolvers), «Code first» (resolvers de campo) | Un resolver de campo necesita el objeto padre; `@Parent()` lo da, y con resolvers de campo `@Resolver()` debe recibir el tipo padre. `@Field` admite `nullable`, `description` y `deprecationReason`. La página no trata argumentos en resolvers de campo ni DataLoader. | `Evaluation.rows(...)` como campo resuelto (RC2–RC4). |
| F15 | [GraphQL over HTTP, Current Working Draft](https://http-spec.graphql.org/draft/), §3.1 «Media Types» y §5.1 «Body» | Las respuestas son JSON (`application/graphql-response+json`, o `application/json` para clientes antiguos). No define respuestas binarias ni subidas; `multipart/form-data` solo aparece en una advertencia de seguridad (§6.2.3). | Las descargas de `errores.csv` y `productos.tsv` se quedan en REST; GraphQL devuelve su URL. |
| F16 | [nestjs/graphql, issue #3687](https://github.com/nestjs/graphql/issues/3687) (encontrada por búsqueda; no se leyó el hilo) | Petición de añadir `isOneOf` a `@InputType`. | Contexto: la opción es reciente; F12 confirma que la versión instalada ya la tiene. |

### Fuentes reutilizadas

| ID local | Ficha original | Por qué importa aquí |
| --- | --- | --- |
| F17 | [Fuente db/04](../../db/04-curso-nest-graphql-reconstrucciones.md) (R1–R19) y [plan db/05](../../../plans/db/05-plan-implementar-graphql.md) | Base de la capa: inputs y mutaciones (R5–R7), enums (R11), `@ResolveField` (R14), paginación (R18–R19) y las adaptaciones a Nest 12. |
| F18 | [Ficha 05 de rulesets&evaluations](../rulesets&evaluations/05-experimento-discriminador-y-validationpipe.md) | Por qué la lista de reglas usa un despacho manual en REST: el discriminador de class-transformer 0.5.1 falla con `null`. Un input `@oneOf` evitaría ese discriminador, pero hay que comprobar cómo valida el `ValidationPipe` cada clase anidada. |

## Conclusiones verificables y límites

- **`@oneOf` es viable con las versiones instaladas** (F11–F13), pero no se ha probado con el `ValidationPipe` global ni con Apollo Server 5: qué error llega al cliente si envía dos campos, y si class-validator valida la clase del campo elegido. El plan debería empezar con un experimento, como la ficha 05 de la feature anterior.
- **Uniones de salida:** exigen devolver instancias de clase o un `resolveType` propio (F10). Las vistas actuales son objetos literales, así que haría falta `resolveType` por el campo `type`.
- **Archivos:** GraphQL sobre HTTP no los cubre (F15); confirma la decisión del plan db/05 para la subida.
- No se consultó documentación de DataLoader: `Evaluation.rows` se resuelve para una evaluación cada vez y no hay listados de evaluaciones con filas anidadas.
