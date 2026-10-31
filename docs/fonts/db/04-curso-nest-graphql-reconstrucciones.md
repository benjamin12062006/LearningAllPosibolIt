# 04 — Curso Nest + GraphQL: lecciones seleccionadas y reconstrucciones

Fecha de creación: 2026-10-30  
Tipo de fuente: transcripciones y reconstrucciones derivadas  
Origen: Fernando Herrera, *Nest + GraphQL* (Udemy `nest-graphql`; cabecera del curso: «Autenticación, autorización, DigitalOcean, Docker, Docker Hub, code first, queries, mutations, enumeraciones y más»). Carpeta local `NestJS/NestJS GraphQL`.  
Fecha de consulta: 2026-10-30  
Relacionada con: [plan GraphQL](../../plans/db/01-plan-graphql-desde-curso-fernando-herrera.md), [disponibilidad del curso](01-curso-graphql-fernando-herrera.md), [plan de semillas](../../plans/db/02-plan-semillas-de-desarrollo.md), [ajustes de paginación](../../plans/feature/projects&catalog-import/04-plan-ajustes-limites-y-consultas.md).

## Necesidad de consulta

El plan db/01 pide conseguir el curso de GraphQL de Fernando Herrera y reconstruir las lecciones pertinentes antes de diseñar cualquier implementación. El usuario añadió el curso a la biblioteca el 2026-10-30 y pidió usar solo esta ruta, descartando las secciones antiguas de `NestJS API Profesional`.

## Localización verificable

- Biblioteca: `/Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS GraphQL/`. Contiene 138 lecciones en 13 secciones, extraídas el 2026-10-30.
- Instructor: el enlace de cada lección apunta a `udemy.com/course/nest-graphql`. El instructor se refiere a «mi curso de Nest» y usa su propio usuario («Fernando Herrera») en los datos de ejemplo (lección 106, l. 45).
- Las transcripciones son reconocimiento de voz con mucho ruido («Graf Jewel» = GraphQL, «Apolo» = Apollo, «Cid» = seed). El código **no aparece literal**: cada guía lo ensambla a partir de las explicaciones y marca su certeza.

### Inventario y selección

| Sección | Lecciones | Criterio |
| --- | --- | --- |
| 1–2 Introducción y repaso REST | 1–15 | Descartadas: instalación del entorno y repaso de Nest REST, que el proyecto ya domina. |
| 3 Nest + GraphQL | 21, 22, 26 | **Seleccionadas:** instalación, primer resolver y argumentos. 23–25 se usan como contexto. |
| 4 GraphQL TODO | 32, 36, 37, 38, 39 | **Seleccionadas:** ObjectType, Mutation, InputType con validación, actualización y borrado. 33–34 se usan como contexto. Filtros y agregaciones (40–43) quedan pendientes. |
| 5 Anylist + Postgres | — | Descartada por ahora: TypeORM y Docker; el proyecto usa Prisma y Cloud SQL. |
| 6 Autenticación | 75, 77 | **Seleccionadas:** guard JWT en el contexto GraphQL y decorador `CurrentUser`; son el puente para Descope. |
| 7 Roles y enums | 87, 95 | **Seleccionadas:** `registerEnumType` y `forRootAsync` con `context`. |
| 8 Items + usuarios | 102, 106 | **Seleccionadas:** filtrar por propietario y `@ResolveField` con `@Parent`. |
| 9 Seed | 111, 112, 113 | **Seleccionadas:** semilla como Mutation, protección por entorno y purga ordenada. |
| 10 Paginación | 121, 122 | **Seleccionadas:** `PaginationArgs` reutilizable y `take`/`skip`. Búsqueda y paginación anidada (123–126) quedan pendientes. |
| 11 Maestro-detalle | — | Pendiente si el proyecto lo necesita. |
| 12 Despliegues | — | Descartada: DigitalOcean y Docker Hub; el plan de operación es aparte. |

## Reconstrucciones (R1–R19)

Se generaron con `reconstruir-cursos-con-scripts`: `render` y después `verify`, que comprobó 19 guías y 25 originales. Hay una receta JSON revisada por lección en [reconstrucciones/recetas](reconstrucciones/recetas/) y la salida en [reconstrucciones/salida-2026-10-30](reconstrucciones/salida-2026-10-30/manifest.json). Las guías también se instalaron junto a cada transcripción original con `install`, sin sobrescribir nada.

| ID | Lección | Mecanismo reconstruido | Guía |
| --- | --- | --- | --- |
| R1 | 21. Instalar GraphQL en Nest | `GraphQLModule.forRoot` + `ApolloDriver` + `autoSchemaFile` (code first) | [guía](<reconstrucciones/salida-2026-10-30/Sección 3 Nest + GraphQL - Introducción/21. Instalar GraphQL en Nest - Reconstrucción guiada.md>) |
| R2 | 22. Mi primer Resolver | `@Resolver`, `@Query(() => String)`, `/graphql`, `playground` | [guía](<reconstrucciones/salida-2026-10-30/Sección 3 Nest + GraphQL - Introducción/22. Mi primer Resolver - Reconstrucción guiada.md>) |
| R3 | 26. Arguments | `@Args` con `type: () => Int`, `nullable`, valor por defecto, alias | [guía](<reconstrucciones/salida-2026-10-30/Sección 3 Nest + GraphQL - Introducción/26. Arguments - Reconstrucción guiada.md>) |
| R4 | 32. Todo Resolver y Custom object types | `@ObjectType` + `@Field`, `Query` que devuelve `[Todo]` | [guía](<reconstrucciones/salida-2026-10-30/Sección 4 GraphQL TODO - Continuación/32. Todo Resolver y Custom object types - Reconstrucción guiada.md>) |
| R5 | 36. Mutation e Inputs | `@Mutation`, `@InputType`, variables | [guía](<reconstrucciones/salida-2026-10-30/Sección 4 GraphQL TODO - Continuación/36. Mutation e Inputs - Reconstrucción guiada.md>) |
| R6 | 37. Validaciones y creación de Todo | `class-validator` en inputs + `ValidationPipe` global | [guía](<reconstrucciones/salida-2026-10-30/Sección 4 GraphQL TODO - Continuación/37. Validaciones y creación de Todo - Reconstrucción guiada.md>) |
| R7 | 38. Actualizar un Todo | `UpdateTodoInput` parcial (`nullable` + `@IsOptional`), `id` obligatorio | [guía](<reconstrucciones/salida-2026-10-30/Sección 4 GraphQL TODO - Continuación/38. Actualizar un Todo - Reconstrucción guiada.md>) |
| R8 | 39. Eliminar un Todo | Mutation `removeTodo(id: Int): Boolean`, `@Resolver(() => Todo)` | [guía](<reconstrucciones/salida-2026-10-30/Sección 4 GraphQL TODO - Continuación/39. Eliminar un Todo - Reconstrucción guiada.md>) |
| R9 | 75. JwtAuthGuard | `AuthGuard('jwt')` + `getRequest` con `GqlExecutionContext` | [guía](<reconstrucciones/salida-2026-10-30/Sección 6 Autenticación y autorización/75. JwtAuthGuard - Reconstrucción guiada.md>) |
| R10 | 77. Custom Decorator - CurrentUser | `createParamDecorator` + `GqlExecutionContext` → `req.user` | [guía](<reconstrucciones/salida-2026-10-30/Sección 6 Autenticación y autorización/77. Custom Decorator - CurrentUser - Reconstrucción guiada.md>) |
| R11 | 87. GraphQL Enumerations | `registerEnumType` | [guía](<reconstrucciones/salida-2026-10-30/Sección 7 Usuarios y enumeraciones - Admin Roles/87. GraphQL Enumerations - Reconstrucción guiada.md>) |
| R12 | 95. Bonus - GraphQLModule forRootAsync | `forRootAsync` (`imports`/`inject`/`useFactory`) y `context` por petición | [guía](<reconstrucciones/salida-2026-10-30/Sección 7 Usuarios y enumeraciones - Admin Roles/95. Bonus - GraphQLModule forRootAsync - Reconstrucción guiada.md>) |
| R13 | 102. findAll por usuario | Propietario desde `CurrentUser` y `where` por relación | [guía](<reconstrucciones/salida-2026-10-30/Sección 8 Items + Usuarios - Peticiones autenticadas/102. findAll por usuario - Reconstrucción guiada.md>) |
| R14 | 106. ResolveField con información del padre | `@ResolveField` + `@Parent`; ejecución por cada padre | [guía](<reconstrucciones/salida-2026-10-30/Sección 8 Items + Usuarios - Peticiones autenticadas/106. ResolveField con información del padre - Reconstrucción guiada.md>) |
| R15 | 111. Seed Resolver | Semilla como Mutation `executeSeed` en un módulo propio | [guía](<reconstrucciones/salida-2026-10-30/Sección 9 Seed Data - Cargar y purgar base de datos/111. Seed Resolver - Reconstrucción guiada.md>) |
| R16 | 112. Seed - Paso 1 Protección | Bloqueo por `STATE=prod` con `ConfigService` | [guía](<reconstrucciones/salida-2026-10-30/Sección 9 Seed Data - Cargar y purgar base de datos/112. Seed - Paso 1 Protección - Reconstrucción guiada.md>) |
| R17 | 113. Seed - Paso 2 Borrar registros anteriores | Purga hijos → padres con repositorios inyectados | [guía](<reconstrucciones/salida-2026-10-30/Sección 9 Seed Data - Cargar y purgar base de datos/113. Seed - Paso 2 Borrar registros anteriores - Reconstrucción guiada.md>) |
| R18 | 121. Paginar resultados - Args | `PaginationArgs` (`@ArgsType`, `Int`, defaults, `@Min`) en `common` | [guía](<reconstrucciones/salida-2026-10-30/Sección 10 Paginaciones, paginaciones anidadas y filtros/121. Paginar resultados - Args - Reconstrucción guiada.md>) |
| R19 | 122. Aplicar la paginación | `take`/`skip` conservando el filtro por usuario | [guía](<reconstrucciones/salida-2026-10-30/Sección 10 Paginaciones, paginaciones anidadas y filtros/122. Aplicar la paginación - Reconstrucción guiada.md>) |

## Interpretación y límites

- **Versiones:** el curso usa Nest 9, `apollo-server-express` y `apollo-server-core` (2022). Según la documentación vigente de Nest ([F5 de la ficha 01](01-curso-graphql-fernando-herrera.md)), con Express hoy se usan `@apollo/server` y `@as-integrations/express5`, y `@nestjs/apollo` v14 requiere Apollo Server 5. Las APIs de Nest (`@Resolver`, `@Query`, `@Mutation`, `@Args`, `@InputType`, `@ObjectType`, `@ResolveField`, `GqlExecutionContext`, `registerEnumType`) son las mismas; los paquetes y plugins de Apollo no.
- **Persistencia:** el curso usa TypeORM (`find`, `take`/`skip`, `createQueryBuilder().delete()`). El proyecto usa Prisma y `$queryRaw` parametrizado. Solo se transfiere el mecanismo, no el código del repositorio.
- **Autenticación:** el curso valida JWT propios con Passport. El proyecto usa Descope con `DescopeSessionGuard`. Lo transferible es el patrón de R9/R10: obtener la request con `GqlExecutionContext` dentro del guard y del decorador.
- **Seguridad:** R12 muestra que bloquear el esquema en `context` impide también las operaciones públicas. El instructor aconseja dejar el registro y el login fuera de GraphQL. En este proyecto la sesión ya la emite Descope fuera de la API.
- **Seed por HTTP:** R15–R17 exponen la semilla como Mutation protegida solo por el entorno. El [plan db/02](../../plans/db/02-plan-semillas-de-desarrollo.md) ya decidió usar un CLI (`prisma db seed`); esta evidencia lo contrasta, no lo sustituye.
- **Fidelidad:** `verify` comprueba localizadores y huellas, no que el código compile ni que cada inferencia corresponda al instructor. Cada guía declara su certeza.

## Aplicación en el proyecto

Estas fuentes alimentan el paso 5 del [plan db/01](../../plans/db/01-plan-graphql-desde-curso-fernando-herrera.md), el plan de implementación, todavía sin escribir. Relación prevista, sin implementar:

```text
R1/R2  → GraphQLModule.forRoot con driver Apollo vigente y autoSchemaFile, junto a REST /api/v1
R4/R3  → ObjectType Project y Query projects con PaginationArgs (R18/R19) traducido a LIMIT/OFFSET en $queryRaw
R9/R10 → DescopeSessionGuard y decorador de usuario adaptados con GqlExecutionContext
R13    → filtro owner_id desde la sesión, nunca desde un argumento del cliente
R5–R8  → mutations solo después de cerrar los planes de eliminación y ajustes en REST
R11    → registerEnumType para estados (configurationStatus, estado de importación)
```
