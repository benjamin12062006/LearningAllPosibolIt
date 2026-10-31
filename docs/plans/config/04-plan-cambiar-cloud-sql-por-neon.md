# 04 — Cambiar la base de datos de Cloud SQL a Neon

Fecha de creación: 2026-10-30  
Estado: Aprobado e implementado en código. Migraciones preparadas, sin ejecutar en Neon.  
Ámbito: conexión a PostgreSQL del runtime, Prisma CLI, pruebas y documentación vigente. No incluye migrar datos.  
Relacionada con: [plan de Cloud SQL (sustituido)](../feature/auth/04-sustituir-turso-por-cloud-sql-postgresql.md), [migraciones remotas](../db/04-plan-migraciones-remotas-y-fechas.md), [activación en Cloud SQL](../../../bitacora-construccion/settings/07-aplicar-migraciones-y-verificar-cloud-sql.md).  
Revisión de referencia: `78e99f3`.

## Objetivo

Que la API use **Neon** (PostgreSQL) como única base y que no quede en el código ninguna dependencia de Google Cloud SQL. El plan estará completo cuando:

- el runtime Nest se conecte solo con `DATABASE_URL`;
- las cinco migraciones existentes estén listas para aplicarse con `pnpm db:migrate`;
- no existan restos de Cloud SQL en código, dependencias, scripts, variables ni documentación vigente.

## Punto de partida

- NestJS 12 + Prisma 7 + `@prisma/adapter-pg` + `pg.Pool`, conectado con `@google-cloud/cloud-sql-connector` y ADC.
- Variables: `INSTANCE_CONNECTION_NAME`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `GOOGLE_CLOUD_QUOTA_PROJECT` y `POSTGRES_MIGRATION_DATABASE_URL` (Auth Proxy en `127.0.0.1:5433`).
- Cinco migraciones en `prisma/migrations`; la primera crea el esquema `estadistica_forms`.
- El usuario ya añadió `DATABASE_URL` (host `-pooler` de Neon) al `.env`.

## Fuentes y decisiones

- **Se conserva Prisma + `adapter-pg`.** Cambiar a `@neondatabase/serverless` obligaría a reescribir el acceso a datos; Neon acepta conexiones `pg` con TLS. Se reutiliza la idea del ejemplo de Neon: leer `DATABASE_URL` con `ConfigService`.
- **Solo `DATABASE_URL`.** Para Prisma Migrate se deriva la URL directa quitando `-pooler` del host, porque el pooler no es adecuado para migrar.
- **Migraciones sin cambios:** no se crean nuevas ni se toca `schema.prisma`; el esquema sigue siendo `estadistica_forms`.
- **Los datos de Cloud SQL no se migran.** Nada se elimina ni se modifica en Google Cloud.
- **Historial:** bitácora y planes anteriores que nombran Cloud SQL no se reescriben.
- Fuente de la configuración del agente: `https://neon.com/prompts/agent-setup.md` (comandos globales de CLI, skills y MCP; el inicio de sesión lo hace el usuario).

## Incrementos

1. ✅ Reescribir `src/database/database-connection.ts` y `postgresql.connection.ts` para `DATABASE_URL` y `pg.Pool` con TLS.
2. ✅ `prisma.config.ts` usa `DATABASE_URL` y deriva la URL directa.
3. ✅ Quitar `@google-cloud/cloud-sql-connector`, `db:proxy` y `scripts/db/start-cloud-sql-proxy.mjs`.
4. ✅ Adaptar pruebas (`DATABASE_URL` en el PGlite de pruebas) y reescribir `test/database-connection.test.mjs`.
5. ✅ Actualizar `.env.example`, `README.md` y `src/users/sql/users.md`; entrada de bitácora.
6. ⏳ Aplicar las migraciones en Neon (`pnpm db:status`, `pnpm db:migrate`, `pnpm db:check`): lo ejecuta el usuario.
7. ⏳ Configurar el agente con Neon (CLI, skills y MCP): requiere `neon login` del usuario.

## Comprobación prevista

- `pnpm build`, `pnpm db:verify` y `pnpm test:features` correctos sin tocar Neon.
- Búsqueda sin resultados de `cloud.sql`, `INSTANCE_CONNECTION_NAME`, `GOOGLE_CLOUD`, `DB_PASSWORD`, `POSTGRES_MIGRATION` y `@google-cloud` en código vigente.
- Tras migrar: `db:status` sin pendientes, `db:check` con `usersTableExists: true` y `db:smoke` correcto.
