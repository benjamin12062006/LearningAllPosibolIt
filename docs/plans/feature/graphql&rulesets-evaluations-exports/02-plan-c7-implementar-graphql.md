# 02 — C7: implementar GraphQL para FastAPI y Nuxt

Fecha de creación: 2026-11-14  
Estado: Implementado y verificado (2026-11-14): C7.1–C7.5. Sin commit.  
Ámbito: la capa GraphQL de la API Nest (`src/graphql/`). El servicio de IA y la web los llevan otras sesiones: aquí solo el contrato y un cliente Python mínimo de prueba.  
Relacionada con: [ficha 05, inventario y alcance](../../../fonts/feature/graphql&rulesets-evaluations-exports/05-inventario-y-alcance-de-c7.md), [ficha 04, necesidades N1–N13](../../../fonts/feature/graphql&rulesets-evaluations-exports/04-mapa-de-necesidades-para-el-plan.md), [ficha 02, fuentes técnicas](../../../fonts/feature/graphql&rulesets-evaluations-exports/02-fuentes-tecnicas.md), [plan aplazado](01-plan-aplazado-sincronizacion-graphql.md), [bitácora del piloto](../../../../bitacora-construccion/feature/graphql&rulesets-evaluations-exports/01-piloto-de-c7-y-mediciones.md), [23, plan C7](../../../../../docs-diagrams/23-graphql-nest-para-fastapi-y-nuxt.md), [plan 02 de cierre](../cierre-backend/02-plan-terminar-hojas-visor-y-agente.md).  
Revisión de partida: `feature/cierre-backend` `fb32457` más el Bloque A sin commit.

## Objetivo

Que las 85 rutas elegidas en la ficha 05 tengan su equivalente GraphQL con los mismos permisos, validación, errores y resultados que REST, sin multiplicar el trabajo del servidor, y que un cliente Python llame a Nest por GraphQL con las garantías de aislamiento de siempre. Al terminar, el agente (Bloque C) y la web (E7) tienen un contrato probado.

## Decisiones

| ID | Decisión | Respaldo |
| --- | --- | --- |
| G1 | **Mismos servicios que REST.** Ningún resolver lee la base: llama al servicio que usa el controlador, que ya decide permisos (404, 403, 409) y errores. | Ficha 05; piloto |
| G2 | **Caché de lecturas por petición.** La persona actual (`UsersService.findCurrent`) y su acceso a un proyecto (`ProjectsRepository.findAccess`) se recuerdan durante una petición HTTP con `AsyncLocalStorage`, abierto por un middleware en `configureHttp`. Sirve a REST y a GraphQL. Solo esas dos lecturas: no cambian dentro de una petición (ningún campo GraphQL cambia roles ni la persona). Objetivo medible: el diagnóstico del piloto no pasa de las 33 sentencias de REST. | Piloto: 38 frente a 33 por repetir el acceso en cada campo |
| G3 | **Límite de coste además de la profundidad 6.** Un plugin de Apollo calcula el coste de la operación con sus variables: cada campo cuesta 1; un campo con `limit` multiplica lo de dentro por su valor (el pedido o el de por defecto); los campos que leen archivos o recorren catálogos (`rows`, `products`, `comparison`, `attention`, `diff`, `rulesPreview`) pesan 10. Máximo 1.000. Sin dependencias nuevas: `graphql-query-complexity` no está instalado y el `package.json` lo está cambiando otra sesión. **Ajuste (C7.4):** una lista solo multiplica sus listas, no los recuentos de su página; y la profundidad sube a 8, porque cada página (`items`) suma un nivel y con 6 no cabían «libros con sus hojas» ni la procedencia de una versión del feed. | 23 («límites de coste, cantidad y profundidad»); [Complejidad en Nest](https://docs.nestjs.com/graphql/complexity) |
| G4 | **Sin DataLoader por ahora.** Ninguna lista del esquema tiene hijos que hagan una consulta por elemento salvo los campos pesados de G3, que el coste acota. Un proyecto tiene como mucho un feed. Si una pantalla de Nuxt lo necesita, se añade con medición. | Piloto; G3 |
| G5 | **Entradas simples tipadas, árboles como JSON de entrada.** Ids, nombres, páginas y enumerados son argumentos y `@InputType` que heredan del DTO REST (como `CreateProjectInput`). Lo que ya es un árbol validado por un analizador del dominio (filtro de filas, operaciones de un borrador, plantilla de mapeo, consulta de una vista, política del feed) entra como `JSONObject` y pasa por el mismo analizador: igual que REST, que lo recibe con `@IsObject()`. | N3; REST |
| G6 | **Reglas con `@oneOf`** (N2): `RuleInput { cleanText | buildTitle | excludeWhen }`. El resolver lo convierte en el cuerpo REST y lo valida con el DTO REST (`validateAs`), así los errores tienen los mismos campos (`rules.2.template`). El experimento pendiente queda en las pruebas: dos campos a la vez lo rechaza GraphQL antes del resolver. | N2; fichas 02 (F11–F13, F18) |
| G7 | **`validateAs(Dto, cuerpo)`**: el mismo `ValidationPipe` y la misma fábrica de errores que REST, para las entradas que se convierten al cuerpo REST. Las opciones salen de `configureHttp` a una constante compartida. | N3, N10 |
| G8 | **Lo que cuelga de un recurso es un campo suyo** (`Project.feeds`, `Worksheet.revisions`, `Evaluation.rows`): las lecturas compuestas en una llamada. Las mutaciones devuelven el recurso, como REST; las que en REST responden 202 devuelven el recurso en cola. | Piloto; N8, N9 |
| G9 | **Identidad de quien llama.** En C7, el cliente Python llama con la sesión Bearer de una persona, igual que la web. La identidad delegada del agente (token por ejecución) es de E6.3a; GraphQL no decide qué puede hacer el agente. | 23; plan E6, D6 y D9 |
| G10 | **Fuera de GraphQL:** subidas, descargas, URL pública del feed, SSE, salud, organizaciones y token de entrega (ficha 05). | Ficha 05 |

## Etapas

Cada etapa: código, E2E de paridad con REST (mismos datos, otra organización 404, rol sin permiso 403, sin sesión), defectos a propósito, verificación y bitácora en `bitacora-construccion/feature/graphql&rulesets-evaluations-exports/`.

| Etapa | Qué | Comprobación |
| --- | --- | --- |
| **C7.1** | Base: caché por petición (G2), coste (G3), `JSONObject` de entrada y `validateAs` (G5, G7). Repetir la medición del diagnóstico. | Diagnóstico ≤ 33 sentencias; consulta cara rechazada; las pruebas REST siguen igual. ✅ 22 sentencias (REST 26); [bitácora 02](../../../../bitacora-construccion/feature/graphql&rulesets-evaluations-exports/02-base-de-c7-cache-coste-y-entradas.md) |
| **C7.2** | Proyecto, reglas, evaluaciones y exportaciones: `Project.{access, imports, rulesets, evaluations, feeds, knowledge, workbooks}`, `organizationProjects`, `ruleset`, `createRuleset` (G6), `requestEvaluation`, `rulesPreview`, `Evaluation.rows`, `export`, `approveExport`, `Export.{products, product}` | Recorrido importar → reglas → evaluar → exportar por GraphQL igual que por REST. ✅ [bitácora 03](../../../../bitacora-construccion/feature/graphql&rulesets-evaluations-exports/03-proyecto-reglas-evaluaciones-y-exportaciones.md) |
| **C7.3** | Feeds y conocimiento: `createFeed`, `Feed.versions`, `FeedVersion.{products, product}`, `publishFeed`, `setFeedSource`, `setFeedSchedule`, `approveFeedPolicy`, `requestFeedRefresh`, `feedRefresh`, `reindexKnowledge` | Publicar por GraphQL y servir el TSV por la URL pública. ✅ [bitácora 04](../../../../bitacora-construccion/feature/graphql&rulesets-evaluations-exports/04-feeds-y-conocimiento.md) |
| **C7.4** | Hojas: libros, hojas, borradores, importaciones, exportaciones, plantillas, vistas y el puente al catálogo (≈40 operaciones) | Recorrido crear hoja → borrador → aplicar → vista → catálogo por GraphQL. ✅ [bitácora 05](../../../../bitacora-construccion/feature/graphql&rulesets-evaluations-exports/05-hojas-borradores-vistas-y-catalogo.md) |
| **C7.5** | Cliente Python mínimo (solo biblioteca estándar) con operaciones predefinidas contra Nest arrancado; dos organizaciones; credencial inválida; contrato para Nuxt por pantalla; esquema esperado; cobertura final medida | Script Python en verde; cobertura 85 / 109 comprobada por un script que cruza rutas y esquema. ✅ [bitácora 06](../../../../bitacora-construccion/feature/graphql&rulesets-evaluations-exports/06-cliente-python-contrato-y-cobertura.md) |

## Comprobación al cerrar

La de 23: matriz y mediciones, GraphQL implementado, Python contra Nest con datos de prueba, credencial incorrecta rechazada, aislamiento con dos organizaciones, paridad con REST en permisos, validación y resultados, límites y esquema, y la batería REST intacta.

## Límites

- No se tocan `package.json`, `main.ts` ni `app.module.ts` (los está cambiando la sesión de observabilidad).
- El cliente Python vive en la API como prueba del contrato; el del agente lo escribe la sesión de FastAPI con este contrato.
- Commits solo cuando el usuario los pida.
