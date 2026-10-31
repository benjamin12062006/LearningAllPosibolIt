# 04 — Migraciones pendientes en Cloud SQL y tipo de las fechas

Fecha de creación: 2026-10-30  
Estado: Plan. Investigación pendiente por indicación del usuario.  
Ámbito: esquema `estadistica_forms` en Cloud SQL y columnas de fecha.  
Relacionada con: [plan de Cloud SQL](../feature/auth/04-sustituir-turso-por-cloud-sql-postgresql.md), [activación verificada](../../../bitacora-construccion/settings/07-aplicar-migraciones-y-verificar-cloud-sql.md), [plan de eliminación](03-plan-eliminacion-de-datos.md), [ajustes 04](../feature/projects&catalog-import/04-plan-ajustes-limites-y-consultas.md), [fuente 06: paginación](../../fonts/feature/projects&catalog-import/06-paginacion-y-limites.md).  
Revisión de referencia: `78e99f3`.

## Objetivo

> **Nota 2026-10-30:** la base remota pasó de Cloud SQL a Neon ([plan config/04](../config/04-plan-cambiar-cloud-sql-por-neon.md)). Las referencias a Cloud SQL y a su proxy de este plan son históricas; las migraciones pendientes se aplican ahora a Neon con `pnpm db:migrate`.

Alinear Cloud SQL con las migraciones locales antes de construir más, y decidir si las fechas pasan de `TEXT` a `timestamptz` mientras haya pocas tablas.

## Punto de partida

- Cloud SQL tiene aplicadas las tres primeras migraciones (bitácora settings/07).
- `20261025000100_configure_projects` y `20261026000100_create_catalog_import` solo están verificadas en PGlite.
- Todas las fechas (`created_at`, `updated_at`, `started_at`, `finished_at`) son `TEXT` con ISO-8601 generado en Node.
- El orden de los listados depende de que ese formato sea siempre el mismo.

## Fuentes y decisiones

- **Procedimiento existente:** proxy en `127.0.0.1:5433`, `POSTGRES_MIGRATION_DATABASE_URL`, `pnpm db:status`, revisión del SQL, `pnpm db:migrate` y `pnpm db:check` ([README](../../../README.md)).
- **Decisión abierta F1:** mantener `TEXT` y validar el formato con `CHECK`, o migrar a `timestamptz` con `ALTER COLUMN ... TYPE timestamptz USING ...::timestamptz`, adaptando los mapeos a `Date` en los repositorios y los contratos JSON.
- Sin fuentes nuevas consultadas; investigar antes de decidir F1.

## Incrementos

1. **Copia de seguridad o punto de restauración** de Cloud SQL antes de migrar.
2. **Aplicar las migraciones pendientes** de projects y catalog-import con el procedimiento existente y registrar el resultado en una entrada de bitácora (`settings/12`).
3. **Comprobar en remoto** con `db:check` y peticiones `requests/projects.http` y `requests/catalog-import.http` con una sesión real de Descope. Así se cierra también el login real pendiente de `auth/01`.
4. **Decidir F1.** Si se migra a `timestamptz`, hacerlo en una migración propia, antes de las de eliminación y paginación, con pruebas que comprueben que las respuestas JSON siguen siendo cadenas ISO.
5. **Coordinar el orden** de las migraciones futuras de los planes de eliminación y de ajustes para aplicarlas juntas y en orden.

## Comprobación prevista

- `db:status` sin migraciones pendientes.
- `db:check` correcto.
- Peticiones `.http` con `200` y `202`.
- Si se migran las fechas: integración con PGlite y orden de los listados sin cambios.

## Límites y continuidad

No cambia la conexión del runtime ni los permisos SQL. Antes del piloto queda pendiente comprobar la restauración conjunta de la base y los archivos.
