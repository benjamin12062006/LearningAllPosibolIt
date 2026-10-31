# 12 — Cambiar Cloud SQL por Neon

Fecha de creación: 2026-10-30
Última actualización: 2026-10-30
Estado: Código y pruebas locales completados; migraciones preparadas, sin aplicar en Neon
Ámbito: conexión PostgreSQL del runtime, Prisma CLI, pruebas y documentación vigente
Relacionada con: [plan config/04](../../docs/plans/config/04-plan-cambiar-cloud-sql-por-neon.md), [entrada 06 (Cloud SQL)](06-conectar-nest-a-cloud-sql-postgresql.md), [entrada 07](07-aplicar-migraciones-y-verificar-cloud-sql.md).
Revisión de referencia: `78e99f3`, con los cambios de esta entrada aún sin commit.

## Necesidad y autorización

El usuario pide sustituir la base de Google Cloud SQL por Neon, sin cambiar nada más, y que el código deje de estar vinculado a Cloud SQL. Define `DATABASE_URL` en su `.env`.

## Cambios

- `src/database/database-connection.ts`: lee `DATABASE_URL`, valida protocolo y exige `sslmode` fuera de localhost; los errores no incluyen la URL.
- `src/database/postgresql.connection.ts`: `pg.Pool` con `connectionString`; sin Cloud SQL Connector ni ADC.
- `prisma.config.ts`: usa `DATABASE_URL`, quita `-pooler` del host para migrar y fija `schema=estadistica_forms`.
- Eliminados `@google-cloud/cloud-sql-connector`, el script `db:proxy` y `scripts/db/start-cloud-sql-proxy.mjs`.
- Pruebas: el PGlite temporal se pasa por `DATABASE_URL`; `test/database-connection.test.mjs` reescrito.
- `.env.example`, `README.md` y `src/users/sql/users.md` describen Neon.

## Comprobación

`pnpm build`, `pnpm db:verify` (3 pruebas), `pnpm test:features` (180 pruebas) y `pnpm users:verify` (8 pruebas) correctos. Una búsqueda de `cloud.sql`, `INSTANCE_CONNECTION_NAME`, `GOOGLE_CLOUD`, `DB_PASSWORD`, `POSTGRES_MIGRATION` y `@google-cloud` en `src`, `scripts`, `test`, `package.json`, `pnpm-lock.yaml`, `prisma.config.ts`, `.env.example` y `requests` no devuelve resultados, y `node_modules/@google-cloud` ya no existe.

## Pendiente

- Aplicar las cinco migraciones en Neon (`pnpm db:status`, `pnpm db:migrate`, `pnpm db:check`): lo ejecuta el usuario.
- Los datos de Cloud SQL no se migraron y nada se modificó en Google Cloud.
- Las variables antiguas del `.env` real quedan sin uso y pueden borrarse.
