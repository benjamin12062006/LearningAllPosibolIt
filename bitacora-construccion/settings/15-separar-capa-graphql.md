# 15 — Separar la capa GraphQL de los módulos de negocio

Fecha de creación: 2026-10-30
Estado: Implementado y verificado
Ámbito: organización de `src/graphql/` y de los módulos `users`, `projects` y `catalog-import`
Relacionada con: [bitácora 13 (implementar GraphQL)](13-implementar-graphql.md), [bitácora 14 (límites)](14-ajustar-limites-y-consultas.md), [fuente db/04 (curso Nest + GraphQL)](../../docs/fonts/db/04-curso-nest-graphql-reconstrucciones.md).
Revisión de partida: `78e99f3`, con los cambios de Neon, GraphQL y límites aún sin commit.

## Necesidad y punto de partida

El usuario pidió organizar los módulos creando un directorio nuevo que separe GraphQL del módulo de negocio, para gestionar mejor GraphQL. Tras la [bitácora 13](13-implementar-graphql.md), cada módulo registraba su propio resolver y sus tipos (`users.resolver.ts`, `users.graphql.ts`…), las utilidades vivían en `src/common/graphql/` y la configuración de Apollo en `src/graphql/graphql-config.ts`. GraphQL quedaba repartido en cinco carpetas. Es un cambio de estructura: el esquema y el comportamiento no cambian.

## Evidencia y decisión

El curso coloca el resolver junto al servicio dentro de cada módulo: `TodoResolver` en el módulo de todos y `SeedResolver` registrado en `SeedModule` ([R4 y R17 de la fuente db/04](../../docs/fonts/db/04-curso-nest-graphql-reconstrucciones.md)). Es la organización que siguió la bitácora 13.

| Enfoque | Ventaja | Coste | Decisión |
| --- | --- | --- | --- |
| Resolver dentro de cada módulo (curso, R4/R17) | Todo lo de una feature en una carpeta | GraphQL repartido; cada módulo depende de `@nestjs/graphql` | Descartado por petición del usuario |
| Subcarpeta `graphql/` dentro de cada módulo | Separa archivos sin mover la propiedad | Sigue repartido en tres módulos y `common` | Descartado |
| **Directorio `src/graphql/` con un módulo propio** | Toda la capa GraphQL en un sitio; los módulos de negocio solo exponen servicios, igual que para REST | `GraphqlApiModule` importa los módulos de negocio; `CatalogImportModule` debe exportar su servicio | **Elegido** |

La organización elegida es una **propuesta propia** a partir de la petición del usuario; no se atribuye al curso. Trata GraphQL como un transporte más, igual que los controladores REST: los resolvers solo llaman a servicios que ya existían.

## Implementación

```text
src/graphql/
├── graphql-api.module.ts      GraphqlApiModule: Apollo + resolvers
├── graphql-config.ts          graphqlRootModule (sin cambios de contenido)
├── common/                    antes src/common/graphql/
│   ├── api-error.type.ts
│   ├── graphql-error.ts
│   ├── json.scalar.ts
│   ├── max-query-depth.rule.ts
│   └── pagination.args.ts
├── users/                     users.resolver.ts, users.graphql.ts
├── projects/                  projects.resolver.ts, projects.graphql.ts
└── catalog-import/            catalog-import.resolver.ts, catalog-import.graphql.ts
```

| Cambio | Archivo y símbolo | Motivo |
| --- | --- | --- |
| Módulo nuevo de la capa | [graphql-api.module.ts](../../src/graphql/graphql-api.module.ts) `GraphqlApiModule` | Importa `graphqlRootModule`, `AuthModule` (guard), `UsersModule`, `ProjectsModule` y `CatalogImportModule`; registra los tres resolvers. |
| Resolvers y tipos movidos sin cambiar su código | [src/graphql/users](../../src/graphql/users/), [projects](../../src/graphql/projects/), [catalog-import](../../src/graphql/catalog-import/) | Solo cambian las rutas de import. |
| Utilidades movidas | [src/graphql/common](../../src/graphql/common/) | `src/common/graphql/` se eliminó tras moverlas. |
| Módulos sin resolvers | [users.module.ts](../../src/users/users.module.ts), [projects.module.ts](../../src/projects/projects.module.ts), [catalog-import.module.ts](../../src/catalog-import/catalog-import.module.ts) | Ya no registran resolvers. `CatalogImportModule` añade `exports: [CatalogImportService]`; los otros dos ya exportaban su servicio. |
| Composición | [app.module.ts](../../src/app.module.ts) | Importa `GraphqlApiModule` en lugar de `graphqlRootModule`. |
| Filtro global | [api-exception.filter.ts](../../src/common/http/api-exception.filter.ts) | Importa `toGraphQLError` desde su nueva ruta. |
| Pruebas | [graphql.e2e-spec.ts](../../test/features/graphql/graphql.e2e-spec.ts), [max-query-depth.spec.ts](../../test/features/graphql/max-query-depth.spec.ts) | El e2e monta `GraphqlApiModule`; la otra prueba usa la ruta nueva de la regla. |

Fuera de `src/graphql/` solo conocen GraphQL tres archivos: `app.module.ts` (composición), `auth/request-context.ts` (el guard obtiene la request en HTTP o GraphQL) y el filtro global de errores, que atiende a los dos transportes.

## Comprobación

| Comprobación ejecutada | Resultado |
| --- | --- |
| Línea base antes del cambio: `pnpm build`, `pnpm lint`, `pnpm test:features` | Correctos; 203 pruebas en 14 suites |
| `pnpm format:check`, `pnpm build`, `pnpm lint` tras el cambio | Correctos |
| `pnpm test:features` | 203 pruebas en 14 suites correctas, incluida la comparación con `schema.expected.graphql` (el esquema no cambió) |
| `node --test test/route-wiring.test.mjs`, `pnpm db:verify`, `pnpm users:verify` | 1, 3 y 8 pruebas correctas |
| Arranque real de `dist/main.js` contra Neon | `POST /api/graphql` sin token devuelve `AUTH_SESSION_REQUIRED` bilingüe; `GET /api/v1/users/me` responde `401` |
| `dist/` tras compilar | Sin restos de las rutas antiguas (`deleteOutDir`) |

Falta, como en la bitácora 13, probar GraphQL con una sesión real de Descope desde un cliente.

## Consecuencias y continuidad

- Un resolver nuevo se añade en `src/graphql/<feature>/` y se registra en `GraphqlApiModule`. El módulo de negocio solo tiene que exportar su servicio.
- La bitácora 13 conserva las rutas antiguas como historia; esta entrada la sustituye en lo relativo a la ubicación de los archivos.
- Si GraphQL crece mucho, cada carpeta de `src/graphql/` podría tener su propio módulo; por ahora un solo módulo basta.
