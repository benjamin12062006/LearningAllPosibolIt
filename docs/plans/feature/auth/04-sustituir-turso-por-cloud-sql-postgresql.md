# 04 — Sustituir Turso por PostgreSQL de Cloud SQL

Fecha de creación: 2026-10-22
Estado: Conexión, migraciones y sincronización ficticia verificadas en Cloud SQL; login real y eventual traslado histórico pendientes
Ámbito: persistencia de usuarios sincronizados desde Descope y sus espacios en `estadistica-forms-api`
Relacionada con: [aprovisionamiento](../../../../bitacora-construccion/auth/03-aprovisionar-usuario.md), [espacios propios](../../../../bitacora-construccion/auth/05-espacios-del-usuario.md), [Turso actual](../../../../bitacora-construccion/settings/05-usar-turso-en-desarrollo.md), [referencia Go y ADC](../../../fonts/cloud-sql/01-referencia-go-y-adc.md), [adaptación a Nest y Prisma](../../../fonts/cloud-sql/02-adaptacion-nest-prisma-postgresql.md).
Revisión de partida: `01a16a43bd61681bef0c603a31d0d2b280e423b3`, árbol limpio antes de este trabajo.

## Objetivo y decisión del usuario

Sustituir Turso por PostgreSQL de Google Cloud SQL para sincronizar y almacenar el usuario local de Descope. El destino final tendrá PostgreSQL como persistencia activa. La petición inicial de conservar ambos servicios fue corregida por el usuario durante el análisis.

El trabajo se ordena así: documentar el plan, preparar las migraciones PostgreSQL a partir del SQL actual y verificar los archivos localmente; después conectar Nest, aplicar el esquema, trasladar los datos y cambiar la persistencia activa. Preparar SQL no significa haberlo ejecutado en Cloud SQL.

Descope continúa validando sesiones. Se conserva la identidad `(identity_issuer, identity_subject)`, el aprovisionamiento idempotente y el contrato de `GET/PUT/PATCH /api/v1/users/me`. No se trasladan contraseñas ni tokens de Descope a PostgreSQL.

## Evidencia y estado observado

- [F1: código Go y documentación de conexión](../../../fonts/cloud-sql/01-referencia-go-y-adc.md): `navigate-business-api` usa Cloud SQL Go Connector con ADC, un pool `pgx` y usuario/contraseña SQL. Sus migraciones usan una CLI externa por otra conexión. Esta organización se adapta a Node; el código Go no se copia al backend Nest.
- [F2: código Nest de partida](../../../fonts/cloud-sql/02-adaptacion-nest-prisma-postgresql.md): Prisma 7.10.0 usaba `provider = "sqlite"` y `PrismaLibSql`. Las tres migraciones originales crean `app_users`, `statistical_spaces` y el índice de propietario. Los dos repositorios dependen del mismo `PrismaService`.
- El 2026-10-22, `gcloud sql instances describe` confirmó `expo-city-bol:us-east4:expo-city-bol-instance`, `POSTGRES_18`, `RUNNABLE` e IP pública habilitada. `gcloud sql databases list` confirmó `expo-city-bol-database` y la base administrativa `postgres`.
- Estas consultas verifican el plano de administración de Google Cloud. No demuestran ADC del proceso Node, privilegios SQL ni una sesión PostgreSQL desde Nest.
- La bitácora Go registra tablas `public.accounts`, `public.auth_identities` y `public.schema_migrations` en octubre. Ese inventario es histórico; deberá actualizarse por SQL antes de ejecutar DDL.

## Destino y aislamiento propuestos

Usar la instancia y la base existentes, con un esquema PostgreSQL exclusivo `estadistica_forms`. Los modelos y el SQL de este backend apuntan explícitamente a ese esquema. El usuario decidió encargarse personalmente de retirar las tres tablas `public.*` de Go; esta implementación no las elimina ni depende de ese borrado.

Crear o seleccionar una identidad SQL de runtime con permisos limitados sobre el esquema y una identidad propietaria para las migraciones. Los nombres propuestos son `estadistica_forms_api` y `estadistica_forms_owner`; su existencia y sus privilegios todavía no se han comprobado. No reutilizar automáticamente los permisos amplios históricos de `catalogo_api`.

`statistical_spaces.owner_id` referencia a `app_users.id`. La propuesta incluye trasladar los espacios existentes junto con sus usuarios para conservar esa relación y evitar dos fuentes de usuarios. Es una consecuencia del esquema actual, no una nueva feature de espacios.

## Migraciones: conservar la estructura actual

Al autorizar después la implementación de Nest y el reemplazo del runtime, se simplifica la ruta inicialmente prevista: PostgreSQL pasa a ser el proveedor del `prisma/schema.prisma` y `prisma.config.ts` actuales; `prisma/migrations/` contiene su nueva historia. El SQL SQLite original se conserva en `prisma/sqlite-legacy/migrations/`, sin cambiar su contenido. No se necesita una configuración operativa paralela para un destino que el usuario ya decidió sustituir.

Prisma documenta que las migraciones dependen del motor y que crear un esquema nuevo no transfiere datos. Por ello se prepara SQL PostgreSQL equivalente, en vez de ejecutar la historia SQLite sobre el nuevo destino. [O1](https://www.prisma.io/docs/orm/v7/prisma-migrate/understanding-prisma-migrate/limitations-and-known-issues), sección sobre cambio de proveedor; consulta 2026-10-22.

| Migración actual | Equivalente PostgreSQL previsto | Regla que debe conservar |
| --- | --- | --- |
| `20260924000100_create_app_users` | `20261022000100_create_app_users` | Mismas columnas; PK de texto; unicidad de emisor/sujeto; identidad no vacía. |
| `20260924000200_create_statistical_spaces` | `20261022000200_create_statistical_spaces` | Nombre de 1–120 caracteres tras recortar espacios; FK hacia usuario; borrado restringido. |
| `20260924000300_index_statistical_spaces_owner` | `20261022000300_index_statistical_spaces_owner` | Índice por propietario, fecha descendente e ID descendente. |

Mantener IDs, fechas ISO y las demás columnas como `TEXT` en este primer traslado. Preservar `NULL`, claves y valores existentes evita mezclar un cambio de proveedor con una conversión de tipos. Un cambio posterior a UUID nativo o `timestamptz` requerirá otra decisión y migración. Los `CHECK` del SQL actual se conservarán en los archivos SQL aunque Prisma no los represente en sus modelos.

El schema y el historial nuevos quedan aislados por `provider = "postgresql"`, ruta de migraciones explícita y `POSTGRES_MIGRATION_DATABASE_URL`. Esa URL debe señalar el esquema `estadistica_forms`; no tendrá fallback hacia `DATABASE_URL` o Turso.

## Configuración prevista

Estas variables forman el contrato implementado y quedan documentadas en `.env.example`; el usuario debe completar su `.env` privado:

```dotenv
DESCOPE_PROJECT_ID=<proyecto-Descope-actual>
GOOGLE_CLOUD_QUOTA_PROJECT=expo-city-bol
INSTANCE_CONNECTION_NAME=expo-city-bol:us-east4:expo-city-bol-instance
DB_NAME=expo-city-bol-database
DB_USER=<usuario-SQL-runtime>
DB_PASSWORD=<secreto-local>
POSTGRES_MIGRATION_DATABASE_URL=<URL-del-propietario-por-proxy-con-schema=estadistica_forms>
```

`GOOGLE_CLOUD_QUOTA_PROJECT` selecciona el proyecto de cuota de las llamadas Google. ADC autoriza el canal y `DB_USER`/`DB_PASSWORD` autentican la sesión SQL. [O2](https://docs.cloud.google.com/docs/quotas/set-quota-project), sección de variables de entorno; consulta 2026-10-22.

Si ADC local no está preparado, el procedimiento es `gcloud auth application-default login` y `gcloud auth application-default set-quota-project expo-city-bol`. Son pasos condicionales: no renovar ni cambiar credenciales que ya funcionen. Que `gcloud sql ...` responda no prueba ADC, porque la CLI y las librerías pueden usar credenciales distintas. [O3](https://docs.cloud.google.com/docs/authentication/provide-credentials-adc), sección «The gcloud CLI and ADC»; consulta 2026-10-22.

## Incrementos y criterio de cierre

### 1. Preparar las migraciones locales

Crear los tres SQL PostgreSQL, su `migration_lock.toml`, schema y configuración activa. Validar Prisma y comparar tablas, nulabilidad, checks, claves e índice con los SQL actuales. Aplicar en PostgreSQL temporal y verificar migraciones y restricciones. Este incremento no cambia el `.env` privado ni aplica DDL remoto.

### 2. Probar conexión desde Node

Añadir el conector oficial `@google-cloud/cloud-sql-connector`, `pg`, tipos de `pg` y `@prisma/adapter-pg` alineado con Prisma 7.10.0. Elegir las versiones del conector y driver durante la implementación, comprobando compatibilidad. Construir un único pool compartido mediante ADC y las variables `DB_*`, con cierre ordenado y timeout de comprobación.

El comando `db:check` queda preparado para verificar por lectura la conexión real. La API exige la nueva configuración y ya no tiene fallback a Turso. La activación en el equipo requiere que el usuario complete el `.env`, compruebe la conexión y aplique las migraciones. [F2, O4 y O5](../../../fonts/cloud-sql/02-adaptacion-nest-prisma-postgresql.md).

### 3. Aplicar el esquema propio

Actualizar por SQL el inventario de tablas/esquemas y permisos. Revisar que el DDL preparado solo afecta a `estadistica_forms`. Para Prisma CLI, usar Auth Proxy en un puerto libre; por ejemplo, el siguiente comando es un paso futuro:

```sh
cloud-sql-proxy --address 127.0.0.1 --port 5433 expo-city-bol:us-east4:expo-city-bol-instance
```

La URL privada de migración debe usar ese puerto, la base elegida, la identidad propietaria y `schema=estadistica_forms`. Después ejecutar:

```sh
pnpm db:status
pnpm db:migrate
```

Generar cambios futuros con PostgreSQL local y su shadow database; usar `deploy` para aplicar SQL revisado en Cloud SQL. `deploy` no requiere shadow database. [O6](https://www.prisma.io/docs/cli/v7/migrate/deploy); consulta 2026-10-22. Comprobar la ubicación y el contenido de `_prisma_migrations` y repetir `deploy` para verificar que no reaplica versiones.

### 4. Adaptar repositorios y trasladar datos

Conservar SQL parametrizado y sus reglas. Sustituir comparaciones SQLite `valor IS NOT otro_valor` por `IS DISTINCT FROM` y entrecomillar alias como `"displayName"`, `"createdAt"` y `"updatedAt"`. Calificar tablas con `estadistica_forms`. El contrato de los controllers no cambia.

Inventariar por lectura los usuarios y espacios de la base Turso seleccionada. Preparar una copia de recuperación protegida; impedir escrituras concurrentes de la aplicación durante la copia final. Importar primero usuarios y después espacios, conservando IDs, identidad externa, fechas, nombres y valores nulos. Verificar las filas esperadas por IDs y valores, no solo por conteos. Rechazar conflictos de identidad con otro ID; no fusionar cuentas por email ni sobrescribir datos silenciosamente.

La copia y la creación del esquema son operaciones distintas. No copiar las tablas internas de migraciones de Turso. Verificar una importación repetida sobre un destino aislado antes de usar los datos reales; no registrar filas personales o credenciales en la bitácora.

### 5. Cambiar la persistencia activa y verificar auth

Conectar `PrismaService` al cliente PostgreSQL y al pool verificado. `UsersRepository` y `StatisticalSpacesRepository` deben usar el mismo destino. Retirar del runtime el adaptador libSQL y su fallback; conservar la fuente Turso sin borrados durante la validación.

Adaptar las pruebas existentes a PostgreSQL temporal: aprovisionamiento repetido y concurrente, cambio/ausencia de email, edición/borrado de nombre, perfil ausente y aislamiento de propietarios. Ejecutar build, lint y comprobaciones de usuarios/espacios. El éxito previo con SQLite no demuestra compatibilidad PostgreSQL.

Comprobar con una sesión Descope real: `PUT /users/me` dos veces conserva el ID, `GET/PATCH` mantienen su contrato y los espacios siguen perteneciendo al usuario correcto. Registrar por separado pruebas de código y login real. El navegador sigue a cargo del usuario.

### 6. Cerrar el cambio

Actualizar README, ejemplo de entorno, scripts y bitácora con PostgreSQL como destino activo. Retirar las dependencias y comandos de Turso cuando ya no sean necesarios para el traslado. Conservar la historia documental y una referencia Git de las migraciones anteriores. No eliminar la base remota Turso como parte de esta tarea.

Antes de nuevas escrituras en PostgreSQL, recuperar la revisión Git previa y su configuración permite abortar el cambio. El código nuevo ya no admite seleccionar Turso mediante entorno. Después de aceptar escrituras nuevas, una reversión requiere reconciliar esos datos; regresar a la versión anterior sin hacerlo perdería cambios.

## Estado y siguiente paso

El análisis identifica una ruta viable y una instancia existente. El usuario amplió expresamente el alcance para implementar también Nest y su sincronización PostgreSQL. La [entrada 06](../../../../bitacora-construccion/settings/06-conectar-nest-a-cloud-sql-postgresql.md) conserva la implementación y sus resultados. La conexión real, el DDL remoto y la eventual copia de filas Turso siguen siendo comprobaciones separadas; no se consideran realizados por tener el código listo.

Continuación ejecutada el 2026-10-22: la [entrada 07](../../../../bitacora-construccion/settings/07-aplicar-migraciones-y-verificar-cloud-sql.md) registra la conexión real, las tres migraciones aplicadas y el usuario ficticio consultado. También documenta la retirada de variables Turso del entorno. El login válido con Descope y la copia opcional de registros anteriores siguen sin ejecutarse.

Decisión posterior del usuario: [plan 05](05-preparar-turso-independiente.md) y
[entrada 08](../../../../bitacora-construccion/settings/08-preparar-turso-independiente.md)
restauran Turso para el futuro con su propio cliente, variables y migrador.
PostgreSQL conserva los consumidores actuales. Esta ampliación sustituye la
retirada definitiva del código Turso, sin revertir la migración PostgreSQL.

Decisión final posterior: el usuario solicitó guardar primero un punto de restauración
y retirar también la integración preparada. La [entrada 09](../../../../bitacora-construccion/settings/09-retirar-turso-tras-guardar-restauracion.md)
registra esa retirada y el commit recuperable `a551ed8`. El código vigente queda
únicamente con PostgreSQL; los párrafos anteriores conservan la secuencia histórica.
