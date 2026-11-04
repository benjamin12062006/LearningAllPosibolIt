# 03 — Cursos y reconstrucciones para GraphQL de reglas, evaluaciones y exportaciones

Fecha de creación: 2026-11-02  
Estado: Cuatro guías reconstruidas, renderizadas, verificadas e instaladas; plan sin escribir; feature no implementada.  
Tipo de fuente: transcripciones originales, guías derivadas y registro de herramientas.  
Origen: Fernando Herrera/DevTalles, `NestJS GraphQL`.  
Fecha de consulta: 2026-11-02  
Revisión del proyecto: `f6b4bf9` con cambios sin commit (ficha 01).  
Relacionada con: [estado real](01-estado-real-y-antecedentes.md), [fuentes técnicas](02-fuentes-tecnicas.md), [mapa para el plan](04-mapa-de-necesidades-para-el-plan.md), [recetas](reconstrucciones/recetas/), [salida verificada](reconstrucciones/salida-2026-11-02/), [fuente db/04](../../db/04-curso-nest-graphql-reconstrucciones.md).

Biblioteca: `/Users/benji/Documents/chrome-extencions/trancripciones/`. Las rutas de las tablas son relativas a esa raíz.

## Necesidad y selección

La feature necesita:

1. exponer el detalle de un objeto (las filas de una evaluación) como campo paginado y filtrable;
2. agrupar conteos en un tipo propio;
3. saber cuántos elementos hay para paginar;
4. devolver el objeto completo tras una mutación.

El curso de GraphQL ya se usó en el proyecto (R1–R19, [fuente db/04](../../db/04-curso-nest-graphql-reconstrucciones.md)). Se listaron sus secciones y se buscó con `rg` en toda la biblioteca: `createUnionType`, `union type`, `oneOf`, `ValidateNested`, `InterfaceType`, `resolve field`, `parent`. Se leyeron completos con `nl -ba` los originales elegidos y el contexto previo (125 y la guía 106). Antes de instalar se comprobó dos veces que no existía ninguna guía de esas lecciones.

**Vacíos de la biblioteca:** ninguna lección enseña uniones, `@oneOf` ni la validación de entradas anidadas en GraphQL. `ValidateNested` solo aparece en `Microservicios con NestJS` (lecciones 69 y 109), ya usado para REST en la feature anterior. Se cubre con la [ficha 02](02-fuentes-tecnicas.md).

## Fuentes primarias y guías derivadas

| ID | Original (sección, líneas) | Guía instalada y mecanismo recuperado | Necesidad |
| --- | --- | --- | --- |
| C1 / RC1 | `NestJS/NestJS GraphQL/Sección 4 GraphQL TODO - Continuación/43. ObjectTypes - Aggregation.md`, l. 15–29; contexto 42 l. 19 y 27 | [43 — guía](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS GraphQL/Sección 4 GraphQL TODO - Continuación/43. ObjectTypes - Aggregation - Reconstrucción guiada.md>). Un `ObjectType` propio (`AggregationsType`) agrupa conteos `Int` en un nivel de la respuesta; `deprecationReason` marca obsoleto un campo que sobra. [Receta](reconstrucciones/recetas/graphql/43-objecttypes-aggregation.json). | Conteos de la evaluación como objeto (`counts`). |
| C2 / RC2 | `…/Sección 10 Paginaciones, paginaciones anidadas y filtros/126. Aplicar filtros a sub-campos.md`, l. 13–35; contexto 125 l. 17–27 y guía 106 | [126 — guía](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS GraphQL/Sección 10 Paginaciones, paginaciones anidadas y filtros/126. Aplicar filtros a sub-campos - Reconstrucción guiada.md>). Se quita el `@Field` de la relación y el campo se sirve con `@ResolveField` + `@Parent` y sus propios `@Args` de paginación y búsqueda, reutilizando el `findAll` del servicio. [Receta](reconstrucciones/recetas/graphql/126-filtros-sub-campos.json). | `Evaluation.rows(limit, offset, outcome)` con el mismo servicio que REST. |
| C3 / RC3 | `…/Sección 11 Entidad para el manejo de listas Maestro Detalle/139. Traer información de los items y conteos.md`, l. 15–37 | [139 — guía](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS GraphQL/Sección 11 Entidad para el manejo de listas Maestro Detalle/139. Traer información de los items y conteos - Reconstrucción guiada.md>). El detalle de un maestro como campo resuelto por el resolver del maestro, con `name` explícito; para inyectar el servicio del detalle hay que importar su módulo (el instructor corrige un `exports` que debía ser `imports`). [Receta](reconstrucciones/recetas/graphql/139-items-y-conteos.json). | Cableado: `GraphqlApiModule` debe importar los módulos que exportan los servicios. |
| C4 / RC4 | `…/Sección 11 Entidad para el manejo de listas Maestro Detalle/141. Filtrar por lista, paginar y conteo.md`, l. 15–45 | [141 — guía](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS GraphQL/Sección 11 Entidad para el manejo de listas Maestro Detalle/141. Filtrar por lista, paginar y conteo - Reconstrucción guiada.md>). Consulta del detalle filtrada por la clave del padre, paginada, y un campo `totalItems` aparte para saber cuántas páginas hay. [Receta](reconstrucciones/recetas/graphql/141-filtrar-paginar-conteo.json). | Total de filas por resultado (`counts.invalid`, etc.) junto a `rows`. |

### Contexto citado sin nueva guía

| ID | Original y líneas | Evidencia y uso |
| --- | --- | --- |
| C5 | `…/Sección 4…/42. Agregar conteos como campos adicionales.md`, l. 15–29 | Conteos como queries sueltas (`totalTodos`, `pendingTodos`, `completedTodos`); el instructor prefiere después agruparlos (C1). Contraste para no crear una query por conteo. |
| C6 | `…/Sección 11…/147. Regresar información completa tras creación.md`, l. 15–19 | Tras crear, se vuelve a leer el registro para devolver sus relaciones en la respuesta de la mutación. En el proyecto, `createRuleset` y `createExport` ya devuelven la vista completa del servicio; sirve de argumento para que la mutación de evaluar devuelva también la evaluación y no solo su id. |
| C7 | Guías ya existentes de R5–R7 (36–38), R11 (87), R14 (106) y R18–R19 (121–122), [fuente db/04](../../db/04-curso-nest-graphql-reconstrucciones.md) | Mutaciones con `InputType`, enums, `@ResolveField` y `PaginationArgs`: se reutilizan sin regenerarlas. |

## Diferencia entre evidencia y adaptación

| Evidencia del curso | Interpretación limitada | Posible uso (a decidir en el plan) |
| --- | --- | --- |
| RC2/RC4: `@ResolveField` con `@Parent` y `@Args` | El curso pagina con `take`/`skip` de TypeORM y filtra por el padre. | `Evaluation.rows(outcome, limit, offset)` llama a `EvaluationsService.findRows` (mismo límite de 100 que REST). |
| RC4: `totalItems` como campo resuelto aparte | Es una consulta `count` adicional. | No hace falta otra consulta: `counts` ya guarda válidos, inválidos y excluidos. |
| RC1: `ObjectType` para conteos | Datos en memoria. | `EvaluationCounts { total valid invalid excluded }`. |
| RC3: importar el módulo que exporta el servicio | Error típico de Nest si se pone en `exports`. | `ExportsModule` debe exportar `ExportsService` y `GraphqlApiModule` importarlo. |
| Ninguna lección cubre uniones ni `@oneOf` | Vacío de la biblioteca. | Decidir con F10–F13 y un experimento. |

## Incertidumbres conservadas en las guías

- RC1: texto de la descripción y de `deprecationReason`, normalizados.
- RC2: opciones de la relación `@OneToMany` (clase 105, no consultada).
- RC3: campos de las entidades de las clases 135–138, no consultadas.
- RC4: la búsqueda por nombre se copia tal cual de `ItemsService` aunque `ListItem` no tiene esa columna; la clase no la prueba.

## Registro de herramientas

| Paso | Comando | Resultado |
| --- | --- | --- |
| Render | `reconstruction.py render --spec-dir reconstrucciones/recetas/graphql --date 2026-11-02` | 4 guías. |
| Verificación | `reconstruction.py verify` | 4 verificadas, 7 originales con huella, 0 escrituras. |
| Instalación | `reconstruction.py install` | 4 guías creadas junto a sus originales; ninguna existía antes. |

La validación comprueba frases, IDs y huellas; no compila el código del curso.
