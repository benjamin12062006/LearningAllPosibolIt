# 07 — Aplicar migraciones y verificar el usuario en Cloud SQL

Fecha de creación: 2026-10-22
Última actualización: 2026-10-22
Estado: Ejecutado y verificado en Cloud SQL; login real con Descope pendiente
Ámbito: PostgreSQL remoto, configuración local y comprobación de sincronización
Relacionada con: [implementación Nest](06-conectar-nest-a-cloud-sql-postgresql.md), [plan](../../docs/plans/feature/auth/04-sustituir-turso-por-cloud-sql-postgresql.md), [fuentes oficiales y adaptación](../../docs/fonts/cloud-sql/02-adaptacion-nest-prisma-postgresql.md).
Revisión de referencia: `01a16a43bd61681bef0c603a31d0d2b280e423b3`, con la implementación PostgreSQL del incremento anterior aún sin commit.

## Necesidad y autorización

El usuario solicita ejecutar las migraciones, crear un usuario de prueba, consultarlo después y retirar la configuración activa de Turso. Autoriza DDL de la historia PostgreSQL y datos ficticios para verificar la sincronización. La eliminación de las tres tablas Go permanece a cargo del usuario por su indicación anterior.

## Secuencia

1. Verificar el destino SQL con las variables actuales, sin mostrar secretos.
2. Preparar la URL privada de migraciones y retirar las variables de conexión antiguas.
3. Aplicar únicamente las migraciones pendientes del esquema `estadistica_forms` mediante Prisma CLI y Auth Proxy.
4. Ejecutar el servicio/repositorio real con una identidad ficticia, repetir su aprovisionamiento y consultar la fila resultante.
5. Registrar resultados, filas ficticias conservadas y límites de la prueba.

La clave de gestión Descope no está configurada. El usuario ficticio de esta comprobación pertenece a la persistencia del producto; no equivale a crear una cuenta Descope ni demuestra un login real. No se incorpora ninguna ruta HTTP que omita el guard.

## Evidencia y decisiones aplicadas

La [ficha de fuentes](../../docs/fonts/cloud-sql/02-adaptacion-nest-prisma-postgresql.md) respalda el conector ADC y el pool `pg` (O4/O5), la historia de migraciones por motor (O1) y la aplicación de pendientes mediante Prisma CLI (O6). Se conserva la separación de responsabilidades del [proyecto Go de referencia](../../docs/fonts/cloud-sql/01-referencia-go-y-adc.md): el runtime usa un conector dentro del proceso y la CLI recibe un extremo PostgreSQL del proxy.

La comprobación inicial por SQL confirmó `expo-city-bol-database`, usuario `catalogo_api`, permiso `CREATE` sobre la base y ausencia de tablas en `public` y `estadistica_forms`. No se borraron tablas ni se ejecutó un reset. El proxy temporal escuchó únicamente en `127.0.0.1:5433`.

Se preparó `POSTGRES_MIGRATION_DATABASE_URL` en el `.env` ignorado usando las credenciales `DB_*` ya presentes y codificando los componentes de la URL. Se retiraron del mismo archivo `DATABASE_URL`, `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN`. El cambio se aplicó sin mostrar valores privados. No se alteraron ADC, IAM, contraseñas SQL o configuración Descope.

## Migraciones ejecutadas

| Migración | Resultado remoto |
| --- | --- |
| `20261022000100_create_app_users` | Aplicada; esquema propio y tabla de usuarios. |
| `20261022000200_create_statistical_spaces` | Aplicada; tabla de espacios y referencia a usuario. |
| `20261022000300_index_statistical_spaces_owner` | Aplicada; índice por propietario/fecha/ID. |

Se ejecutó Prisma 7.10.0 mediante su CLI instalada, con `migrate status` antes, `migrate deploy` y `migrate status` después. El estado final fue `Database schema is up to date!`. Una consulta separada a `estadistica_forms._prisma_migrations` confirmó las tres filas con `finished_at` presente y `rolled_back_at` nulo.

## Usuario ficticio y consulta posterior

Se añadió [scripts/db/smoke-postgres.mjs](../../scripts/db/smoke-postgres.mjs), disponible como `pnpm db:smoke`. Arranca el contexto real de Nest con `AppModule`, resuelve `UsersService` y `PrismaService` por inyección y usa la conexión nativa Cloud SQL, sin depender del proxy para el runtime.

El fixture tiene un emisor reservado `urn:estadistica-forms:postgresql-smoke-test` y sujeto `postgresql-smoke-user`. Es independiente de las identidades Descope de los usuarios reales. El script aprovisionó dos veces, comparó los resultados, cambió el nombre mediante el servicio, leyó el perfil y consultó directamente por su identidad. Las cinco comprobaciones pasaron y el conteo fue una única fila.

La fila ficticia se conserva deliberadamente para inspección:

| Campo | Valor de prueba |
| --- | --- |
| `id` | `4997ff84-7bc0-4d6b-8d60-5e46570036bb` |
| `email` | `postgresql-smoke@example.test` |
| `display_name` | `Usuario de prueba PostgreSQL` |
| `created_at` | `2026-10-22T11:54:20.450Z` |
| `updated_at` | `2026-10-22T11:54:20.571Z` |

Una conexión posterior e independiente ejecutó [requests/postgresql-smoke.sql](../../requests/postgresql-smoke.sql) y recuperó esos mismos valores. Esta prueba usa una identidad ficticia interna para comprobar persistencia; no crea un usuario en Descope ni permite iniciar sesión con ese correo.

## Verificaciones adicionales

- Nest real arrancó temporalmente en un puerto local asignado por el sistema con prefijo `/api` y versión `/v1`. `GET /auth/me` y `PUT /users/me` sin sesión respondieron `401`; `PUT /users/me` con un Bearer inválido también respondió `401`. La aplicación temporal se cerró al terminar.
- Generación Prisma Client y compilación Nest correctas antes de ejecutar las pruebas remotas.
- Script nuevo revisado con `node --check` y Prettier; Oxlint del código fuente y `git diff --check` correctos.
- Búsqueda en código activo, scripts, dependencias directas, configuración Prisma y ejemplo de entorno: sin referencias de conexión Turso/libSQL. Verificación privada del entorno: ninguna de las tres claves retiradas sigue presente.
- El Compose SQLite anterior se archivó en `prisma/sqlite-legacy`, junto a la historia SQL. Posteriormente se retiró del árbol, según la [entrada 09](09-retirar-turso-tras-guardar-restauracion.md); el antecedente se conserva en el commit `a551ed8`.

## Estado final y límites

Prisma continúa en uso: define el modelo, administra la historia PostgreSQL y ejecuta el SQL parametrizado de los repositorios mediante `PrismaPg`/`pg`. No se sustituyó por un driver directo en el dominio ni se conservaron adaptadores activos de Turso. La sintaxis SQL fue adaptada expresamente a PostgreSQL en el incremento 06.

Quedan comprobadas la conexión real, las migraciones, el aprovisionamiento idempotente, la edición, la consulta posterior y el rechazo HTTP de solicitudes no autenticadas. El recorrido de login con un JWT válido de Descope no se probó en esta ejecución; falta la clave de gestión para utilizar el helper de usuarios de prueba del proveedor o una sesión real proporcionada por el flujo normal.

No se trasladaron registros antiguos de Turso ni se eliminaron sus datos o sus recursos remotos. El usuario de prueba PostgreSQL permanece visible; futuras ejecuciones del smoke reutilizan su identidad. El proxy se usa únicamente para la CLI y se detiene al finalizar esta operación; Nest conserva su conexión nativa sin proxy.
