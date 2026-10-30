# 02 — Adaptación a Nest, Prisma 7 y PostgreSQL

Fecha de creación: 2026-10-22
Tipo de fuente: documentación oficial, código del proveedor y código propio
Origen: Google Cloud, Prisma y Electric SQL
Fecha de consulta: 2026-10-22
Relacionada con: [referencia Go](01-referencia-go-y-adc.md), [plan](../../plans/feature/auth/04-sustituir-turso-por-cloud-sql-postgresql.md), [implementación](../../../bitacora-construccion/settings/06-conectar-nest-a-cloud-sql-postgresql.md).

## Fuentes y evidencia

| ID | Fuente y sección | Decisión respaldada |
| --- | --- | --- |
| O1 | [Prisma v7: limitaciones de migraciones](https://www.prisma.io/docs/orm/v7/prisma-migrate/understanding-prisma-migrate/limitations-and-known-issues), cambio de proveedor | Los SQL son específicos del motor. Se conserva la historia SQLite en un archivo histórico y se inicia una historia PostgreSQL. El DDL nuevo no copia filas. |
| O2 | [Google: proyecto de cuota](https://docs.cloud.google.com/docs/quotas/set-quota-project), variables de entorno | Node admite `GOOGLE_CLOUD_QUOTA_PROJECT`. Su función no es elegir una base ni autenticar al usuario SQL. |
| O3 | [Google: configurar ADC](https://docs.cloud.google.com/docs/authentication/provide-credentials-adc), «The gcloud CLI and ADC» | La autenticación de la CLI y ADC de las librerías son distintas. El éxito de `gcloud sql ...` no prueba una sesión de la API. |
| O4 | [Cloud SQL Node.js Connector](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector), «Credentials», «Using with PostgreSQL» y requisitos | El conector descubre ADC y aporta opciones al driver `pg`. La identidad Google necesita Cloud SQL Client y la API administrativa habilitada; la sesión SQL conserva sus credenciales propias. |
| O5 | [Prisma adapter-pg 7.10.0](https://github.com/prisma/orm/blob/7.10.0/packages/adapter-pg/src/pg.ts), `PrismaPgAdapterFactory`, `PrismaPgOptions` y `dispose` | Acepta un `pg.Pool` externo y un schema. Por defecto no cierra ese pool: la composición de la aplicación debe liberarlo. |
| O6 | [Prisma CLI v7: migrate deploy](https://www.prisma.io/docs/cli/v7/migrate/deploy), «Characteristics» | Aplica pendientes y no requiere shadow database. Se usa con un extremo TCP del Auth Proxy, independientemente del conector del runtime. |
| O7 | [Prisma v7: multi-schema](https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/multi-schema), `schemas` y `@@schema` | Los modelos pueden asignarse al namespace PostgreSQL previsto. Las consultas raw se califican explícitamente para no depender de un `search_path` implícito. |
| O8 | [PGlite](https://github.com/electric-sql/pglite), «Node/Bun/Deno» y «Limitations»; [socket oficial](https://raw.githubusercontent.com/electric-sql/pglite/main/packages/pglite-socket/README.md), API y limitaciones | PostgreSQL WASM permite verificar SQL temporalmente. El servidor socket permite usar Prisma/pg y su CLI reales. Multiplexa conexiones sobre un motor; no reemplaza una prueba de carga ni demuestra conectividad Cloud SQL. |

Las versiones instaladas se consultaron con `pnpm view`: Cloud SQL Connector 1.12.1, `pg` y sus tipos 8.23.1, Prisma/adapter-pg 7.10.0, PGlite 0.5.11 y socket 0.2.14. La documentación web principal de Prisma ya muestra otras versiones; se consultaron las rutas v7 y el código del adaptador 7.10.0 para este cambio.

## Código propio y adaptación

En la revisión de partida, `prisma/schema.prisma` usaba SQLite; las tres migraciones creaban usuarios, espacios y su índice. Ambos repositorios dependían del mismo cliente. El traslado conserva ese límite y las columnas `TEXT`, las claves y los `CHECK` originales.

[UsersRepository](../../../src/users/users.repository.ts) adapta comparación nullable con `IS DISTINCT FROM` y alias entrecomillados; [StatisticalSpacesRepository](../../../src/statistical-spaces/statistical-spaces.repository.ts) usa el mismo schema y cliente. Son decisiones de adaptación al SQL PostgreSQL, no una reimplementación del login Firebase de la referencia Go.

[createPostgreSqlConnection](../../../src/database/postgresql.connection.ts) crea el pool; [PrismaModule](../../../src/database/prisma.module.ts) lo resuelve como proveedor asíncrono y [PrismaService](../../../src/database/prisma.service.ts) verifica una consulta al iniciar y libera los recursos al cerrar. Los tokens siguen bajo responsabilidad del módulo Descope.

## Límites

Compilar y pasar pruebas aisladas no demuestra credenciales SQL, grants o ADC del usuario. El comando `db:check` está preparado para comprobar esa conexión por lectura. No se trasladan filas Turso ni se ejecuta DDL remoto durante las pruebas locales.
