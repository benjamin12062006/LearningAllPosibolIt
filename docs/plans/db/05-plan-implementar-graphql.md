# 05 — Implementar GraphQL sobre lo que ya existe

Fecha de creación: 2026-10-30  
Estado: Ejecutado el 2026-10-30 (incrementos 1–7). Ver la [bitácora 13](../../../bitacora-construccion/settings/13-implementar-graphql.md).  
Ámbito: una capa GraphQL de **solo las operaciones que ya ofrece la API REST** (`users`, `projects`, lectura de `catalog-import`). No añade funcionalidades, tablas ni migraciones.  
Relacionada con: [plan db/01](01-plan-graphql-desde-curso-fernando-herrera.md) (paso 5), [fuente db/04: lecciones R1–R19](../../fonts/db/04-curso-nest-graphql-reconstrucciones.md), [fuente db/01](../../fonts/db/01-curso-graphql-fernando-herrera.md), [ajustes de límites](../feature/projects&catalog-import/04-plan-ajustes-limites-y-consultas.md), [plan de eliminación](03-plan-eliminacion-de-datos.md), [plan de testing](../config/01-testing-nest-para-futuras-features.md), [errores bilingües](../config/02-mensajes-y-errores-bilingues-es-en.md), [cambio a Neon](../config/04-plan-cambiar-cloud-sql-por-neon.md).  
Revisión de referencia: `78e99f3` más los cambios de Neon aún sin commit.

## Objetivo

Exponer en `/api/graphql` las mismas operaciones que hoy sirve REST, reutilizando los servicios existentes sin duplicar reglas de negocio. El plan estará completo cuando:

- un cliente autenticado con Descope consulte `me`, `projects`, `project`, `importJob` e `importSnapshot` por GraphQL;
- las mutaciones equivalentes a las REST actuales (`updateMe`, `createProject`, `updateProject`) funcionen con las mismas validaciones y errores;
- REST siga intacto y sus pruebas pasen sin cambios.

## Punto de partida

- Servicios reutilizables que ya aplican la propiedad del recurso desde la sesión: `UsersService.findCurrent/updateCurrent`, `ProjectsService.findAll/findOwned/create/update`, `CatalogImportService.findJob/findSnapshot`.
- Autenticación: `DescopeSessionGuard` lee la request con `context.switchToHttp()`; en GraphQL ese método no devuelve la request ([descope-session.guard.ts](../../../src/auth/descope-session.guard.ts)).
- Errores: `ApiExceptionFilter` es global y también usa `switchToHttp()`; en un resolver fallaría o devolvería HTTP en lugar de un error GraphQL ([api-exception.filter.ts](../../../src/common/http/api-exception.filter.ts)).
- Validación: `ValidationPipe` global con `whitelist` y `forbidNonWhitelisted`; los DTO REST usan `class-validator` ([configure-http.ts](../../../src/configure-http.ts)).
- Los datos usan fechas `TEXT` ISO-8601 y estados como cadenas (`configurationStatus: 'required' | 'ready'`, `channelProfile: 'google_merchant'`).
- La subida de CSV (`POST projects/:id/imports`) es `multipart/form-data` y la procesa un worker; no encaja en GraphQL.

## Fuentes y decisiones

- **Curso (R1–R19, fuente db/04):** *code first* con `GraphQLModule`, `@ObjectType`, `@InputType`, `@Args`, `registerEnumType`, `forRootAsync` con `context`, y `GqlExecutionContext` para guard y decorador de usuario.
- **Adaptación vigente (fuente db/04, "Interpretación"):** el curso usa Nest 9 y `apollo-server-*`. Con Nest 12 se usan `@nestjs/graphql`, `@nestjs/apollo`, `@apollo/server`, `@as-integrations/express5` y `graphql`. **Las versiones exactas se confirman en la documentación oficial al instalar**, incluidas las peer dependencies con Nest 12 y la regla `minimumReleaseAge` de `pnpm-workspace.yaml`.
- **Solo lo existente:** quedan fuera la semilla por Mutation (R15–R17; el plan db/02 decidió un CLI), el borrado (plan db/03), filtros y búsqueda (lecciones 40–43 y 123–126), `@ResolveField` (R14), Docker/DigitalOcean, TypeORM y la autenticación propia con Passport. R14 solo tendrá sentido cuando exista un listado hijo (importaciones por proyecto, plan feature/04).
- **Propiedad desde la sesión (R13):** el propietario sale de la identidad Descope dentro de los servicios, nunca de un argumento del cliente. El resolver solo pasa la identidad.
- **Sin duplicar reglas:** los resolvers llaman a los servicios actuales. Los `InputType` repiten los decoradores de `class-validator` de los DTO REST importando las mismas constantes de longitud y valores permitidos; una prueba comprueba que ambos rechazan los mismos casos.
- **Tipos:** fechas como `String` ISO (igual que REST); `configurationStatus`, `channelProfile` y el estado del trabajo de importación como enums con `registerEnumType` (R11).
- **Convivencia con REST (propuesta propia):** GraphQL no sustituye a REST; ambos usan los mismos servicios y reglas. El alcance es solo el backend: ningún cliente condiciona el diseño.

## Incrementos

1. **Preparar y dejar el esquema vacío.** Instalar las dependencias verificadas; `GraphQLModule.forRootAsync` con `ApolloDriver`, *code first*, `autoSchemaFile: true` (en memoria; decisión G2), `sortSchema`, `useGlobalPrefix` y `path: '/graphql'` para servir en `/api/graphql`, `playground` desactivado, introspección solo fuera de producción, `context: ({ req }) => ({ req })` (R1, R2, R12). Sin batching. Comprobar que el prefijo global funciona con el driver.
2. **Guard y usuario en el contexto GraphQL.** Extraer en `src/auth/` una función que obtenga la request según `context.getType()` (HTTP o `graphql` con `GqlExecutionContext`) y úsala en `DescopeSessionGuard`, sin cambiar su lógica ni sus códigos de error. Añadir el decorador `@CurrentIdentity()` (R9, R10). Pruebas REST existentes sin cambios.
3. **Errores bilingües en GraphQL.** Hacer que `ApiExceptionFilter` distinga `host.getType()`: en HTTP, comportamiento actual; en GraphQL, devolver un `GraphQLError` con `extensions: { code, message: { es, en }, requestId, issues? }` reutilizando `publicError` y `API_MESSAGES`. Errores desconocidos → `INTERNAL_ERROR` sin texto ni *stack* (`includeStacktraceInErrorResponses: false`).
4. **Lecturas.** Módulo `graphql` o un resolver por feature junto a su servicio:
   - `Query.me` → `UsersService.findCurrent`.
   - `Query.projects(limit, offset)` → `ProjectsService.findAll`; usa `PaginationArgs` (R18, R19) con los mismos límites que fije el plan feature/04 (propuesta: por defecto 20, máximo 100). **No se publica antes de que REST tenga paginación.**
   - `Query.project(id)` → `findOwned`.
   - `Query.importJob(projectId, id)` e `importSnapshot(projectId, id)` → `CatalogImportService`.
   - IDs validados como UUID con el mismo mecanismo que `uuidParamPipe`.
5. **Mutaciones equivalentes a REST.** `updateMe`, `createProject`, `updateProject` con sus `InputType` (R5–R7). Mismas reglas: configuración todo-o-nada, actualización vacía rechazada, configuración bloqueada con importaciones. **No se añaden** `delete*`, `executeSeed` ni subida de importaciones.
6. **Límites de la capa.** Profundidad máxima de consulta (regla de validación propia, sin dependencia nueva; esquema actual poco profundo), tamaño de cuerpo ya limitado por el middleware existente, sin batching ni suscripciones. El límite de peticiones se hereda del mecanismo REST cuando exista (plan config/03); GraphQL no abre una vía adicional.
7. **Pruebas y documentación.** Ver abajo. Actualizar `README.md`, una entrada en `bitacora-construccion/` y marcar el paso 5 del plan db/01.

## Decisiones tomadas al ejecutar

- **G1:** `/api/graphql`. **G2:** esquema en memoria, con copia esperada en `test/features/graphql/schema.expected.graphql`. **G3:** Apollo responde `200` a errores de resolvers y `400` a análisis, validación del documento y variables; ambos con el contrato bilingüe. **G4:** el usuario pidió ejecutar todo el plan de una vez, así que `projects` se publicó con paginación propia de GraphQL (por defecto 20, máximo 100) sin cambiar REST.

### Decisiones originales

- **G1 — ruta:** `/api/graphql` (propuesto) frente a `/api/v1/graphql`. La versión por URI de REST no aplica a GraphQL, que evoluciona por esquema.
- **G2 — esquema:** generarlo en memoria (propuesto) o escribir `schema.gql` en el repositorio para revisarlo en cada cambio.
- **G3 — estado HTTP de los errores:** Apollo responde `200` con `errors`; se mantiene así salvo que un cliente necesite `401` para sesión inválida.
- **G4 — orden:** este plan va después de semillas, eliminación y ajustes de paginación (prioridad baja del plan db/01). Si se adelanta, `projects` se publica sin paginación solo con el mismo tope provisional que REST.

## Comprobación prevista

Con PGlite, como el resto de la suite ([plan config/01](../config/01-testing-nest-para-futuras-features.md)):

- **Unitarias:** resolvers delegan en el servicio con la identidad; el filtro produce `extensions.code` y mensajes `es`/`en`.
- **Integración/e2e** con `POST /api/graphql`: sin token → `AUTH_SESSION_REQUIRED`; token inválido → `AUTH_SESSION_INVALID`; proyecto de otro usuario → `PROJECT_NOT_FOUND`; entrada inválida → `VALIDATION_FAILED` con `issues`; límites de paginación; enums con los valores esperados.
- **Equivalencia con REST:** los mismos casos por ambas rutas devuelven los mismos datos y códigos.
- **Esquema:** prueba que compara el SDL generado con una copia esperada.
- `pnpm build`, `pnpm test:features` y las pruebas REST existentes siguen en verde; `src/generated` y las migraciones no cambian.

## Límites y continuidad

- No se instalan dependencias ni se crean resolvers hasta aprobar este plan y cerrar los prerrequisitos de G4.
- Cada incremento se cierra con sus pruebas antes de pasar al siguiente.
