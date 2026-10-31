# 13 — Implementar GraphQL sobre lo existente

Fecha de creación: 2026-10-30
Última actualización: 2026-10-30
Estado: Implementado y verificado con PGlite y un arranque real contra Neon
Ámbito: capa GraphQL de `users`, `projects` y lectura de `catalog-import`
Relacionada con: [plan db/05](../../docs/plans/db/05-plan-implementar-graphql.md), [fuente db/04](../../docs/fonts/db/04-curso-nest-graphql-reconstrucciones.md), [bitácora 12 (Neon)](12-cambiar-cloud-sql-por-neon.md).
Revisión de referencia: `78e99f3`, con los cambios de Neon y de esta entrada aún sin commit.

## Necesidad y autorización

El usuario pidió ejecutar de una vez todo el plan db/05. Solo se exponen operaciones que ya existían en REST; no hay migraciones ni cambios de esquema.

## Cambios

- **Dependencias** (versiones comprobadas con sus peers de Nest 12): `@nestjs/graphql` 14.1.0, `@nestjs/apollo` 14.1.1, `@apollo/server` 5.5.1, `@as-integrations/express5` 1.1.2 y `graphql` 16.14.2 (la 17 no es compatible con Apollo Server 5). `pnpm-workspace.yaml` marca `@apollo/protobufjs` como sin scripts de compilación.
- **Módulo base** `src/graphql/graphql-config.ts`: `/api/graphql`, code first en memoria, sin playground ni batching, introspección fuera de producción, `formatError` que normaliza errores de Apollo, regla de profundidad máxima 6.
- **Auth:** `src/auth/request-context.ts` obtiene la request en HTTP o GraphQL; `DescopeSessionGuard` lo usa sin cambiar su lógica. `@CurrentIdentity()` entrega la identidad a los resolvers.
- **Errores:** `ApiExceptionFilter` distingue `graphql` y devuelve un `GraphQLError` con el mismo código, mensaje `es`/`en`, `requestId` e `issues`. HTTP no cambia.
- **Resolvers:** `UsersResolver` (`me`, `updateMe`), `ProjectsResolver` (`projects`, `project`, `createProject`, `updateProject`) y `CatalogImportResolver` (`importJob`, `importSnapshot`). Los `InputType` heredan los DTO REST, así que las validaciones son las mismas. Fechas como `String` ISO y enums con `registerEnumType`.
- **Paginación:** `PaginationArgs` (`limit` 1–100, 20 por defecto; `offset` ≥ 0). `findAllByOwner` y `findAll` aceptan `page` opcional; sin él, REST conserva su llamada original.

## Comprobación

- `pnpm build`, `pnpm lint` y `pnpm test:features` (195 pruebas, 13 suites) correctos; `db:verify`, `users:verify` y `route-wiring` correctos.
- Nuevas: `graphql.e2e-spec.ts` (sesión, propiedad, validación, equivalencia con REST, importaciones, errores de Apollo, batching y esquema esperado) y `max-query-depth.spec.ts`.
- Arranque real de `dist/main.js` contra Neon: `POST /api/graphql` sin token devuelve `AUTH_SESSION_REQUIRED` bilingüe y REST sigue respondiendo `401`.

## Notas

- Apollo responde `200` a errores de resolvers y `400` a análisis, documento y variables.
- Queda fuera: borrado, semilla, filtros, `@ResolveField` y subida de CSV.
- Falta probar con una sesión real de Descope desde un cliente.
