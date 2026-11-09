# 01 — Fuentes para llevar la base a un Cloud SQL propio

Fecha de creación: 2026-11-08  
Última actualización: 2026-11-08  
Estado: Investigación. Respalda el [plan 01 de google-cloud/db](../../../plans/google-cloud/db/01-plan-cloud-sql-propio.md).  
Relacionada con: [fuentes anteriores de Cloud SQL](../../cloud-sql/02-adaptacion-nest-prisma-postgresql.md), [plan que cambió Cloud SQL por Neon](../../../plans/config/04-plan-cambiar-cloud-sql-por-neon.md), [bitácora de la activación anterior en Cloud SQL](../../../../bitacora-construccion/settings/07-aplicar-migraciones-y-verificar-cloud-sql.md), skill `conectar-cloud-sql-datagrip`.  
Revisión de partida: rama `feature/cierre-backend`, commit `5c276ca`.

## Pregunta

¿Cómo se cambia la base de la API de Neon a una instancia de Cloud SQL para PostgreSQL en un proyecto de Google Cloud propio, parecida a la de `expo-city-bol`, sin tocar el acceso a datos de la API y sin guardar contraseñas?

## Estado real

| ID | Fuente | Hallazgo | Consecuencia |
| --- | --- | --- | --- |
| E1 | `gcloud` 587.0.0 y `cloud-sql-proxy` en `/opt/homebrew/bin`; cuenta activa `benjamin12062006@gmail.com`; proyecto por defecto `expo-city-bol` | Las herramientas ya están instaladas y con sesión. `psql` y `pg_dump` no lo están. | No hace falta instalar nada para crear la instancia ni para conectarse. Sin `pg_dump`, copiar datos exige otra vía (E7). |
| E2 | `gcloud sql instances describe expo-city-bol-instance` (solo lectura, 2026-11-08) | Referencia: `POSTGRES_18`, `us-east4`, edición `ENTERPRISE`, `db-f1-micro`, `ZONAL`, 10 GB `PD_SSD` sin crecimiento automático, IP pública sin redes autorizadas, `sslMode: ALLOW_UNENCRYPTED_AND_ENCRYPTED`, **copias de seguridad desactivadas** (la consola lo marca como problema de prioridad alta), `cloudsql.iam_authentication=on`, sin protección contra borrado. | Copiar la forma, corrigiendo dos cosas: activar las copias automáticas y exigir conexiones cifradas. |
| E3 | `gcloud billing accounts list` / `projects describe` | Cuentas abiertas: «My Billing Account» (`0138D5-…`, la de `expo-city-bol`) y «Pago de Firebase». | Un proyecto nuevo necesita una cuenta de facturación vinculada para Cloud SQL: **genera coste**. |
| E4 | [`database-connection.ts`](../../../../src/database/database-connection.ts), [`prisma.config.ts`](../../../../prisma.config.ts), [`test/database-connection.test.mjs`](../../../../test/database-connection.test.mjs) | La API solo lee `DATABASE_URL`. Fuera de `localhost` exige `sslmode=require`; en `127.0.0.1` no. `prisma.config.ts` quita `-pooler` del host (solo afecta a Neon) y fija el esquema `estadistica_forms`. | Con el proxy en `127.0.0.1` y la URL apuntando a él, **no hay que cambiar código**: solo el `.env`, comentarios que nombran Neon y un script para arrancar el proxy. |
| E5 | `.env` (solo nombres y valores no secretos) | Quedan variables de la etapa anterior en Cloud SQL (`INSTANCE_CONNECTION_NAME=expo-city-bol:us-east4:expo-city-bol-instance`, `DB_NAME`, `DB_USER=catalogo_api`, `DB_PASSWORD`, `POSTGRES_MIGRATION_DATABASE_URL`), que el código actual ya no usa. | Limpiarlas al cambiar, para no mezclar la instancia vieja con la nueva. |
| E6 | `gcloud sql users create --help` | Existen `--type=cloud_iam_user` y `--database-roles=cloudsqlsuperuser`. | Un usuario IAM (la cuenta de Google) con permisos de administración en la base, **sin contraseña**: el proxy obtiene el token con `--auto-iam-authn`. |
| E7 | Neon, 29 migraciones aplicadas (2026-11-07) | La base de Neon tiene el esquema completo y los datos del uso real; el cambio anterior (Cloud SQL → Neon) no migró datos. | Hay que decidir si se copian los datos o se empieza con la base vacía. Copiarlos sin `pg_dump`: un script con `pg` que lea Neon y escriba tabla a tabla en orden de claves foráneas, comprobando los recuentos. |

## Documentación oficial

| ID | Fuente | Evidencia | Uso |
| --- | --- | --- | --- |
| F1 | [Opciones de despliegue de servicios de Cloud Run](https://docs.cloud.google.com/run/docs/deployment-options-for-services?hl=es-419), consultada el 2026-11-08 | Despliegue con consola, `gcloud run deploy`, YAML, Terraform, bibliotecas, API REST, Compose y servidor MCP. **No trata bases de datos ni Cloud SQL.** | Fuente pedida por el usuario: sirve para desplegar la API más adelante, no para este cambio de base. Se registra para esa etapa. |
| F2 | [Conectarse con Cloud SQL Auth Proxy](https://docs.cloud.google.com/sql/docs/postgres/connect-auth-proxy), consultada el 2026-11-08 | Es «the recommended method for connecting to a Cloud SQL instance». Necesita el rol `roles/cloudsql.client` y la Cloud SQL Admin API; con autenticación IAM, `roles/cloudsql.instanceUser`. Escucha por defecto en `127.0.0.1`. Cifra la conexión hasta la instancia aunque el cliente use `sslmode=disable`; el tramo cliente → proxy no va cifrado, así que solo debe escuchar en interfaces de confianza. | El proxy en `127.0.0.1:5433` es el único camino a la base, tanto para la API como para Prisma Migrate. |
| F3 | Ayuda de `gcloud sql instances create` (`--edition`, `--tier`, `--database-version`, `--region`, `--storage-size`, `--storage-type`, `--backup-start-time`, `--retained-backups-count`, `--ssl-mode`, `--database-flags`, `--availability-type`, `--deletion-protection`) | Todas las opciones de E2 se pueden fijar al crear la instancia. | Creación reproducible con un solo comando, anotado en la bitácora. |

## Mapa

| Necesidad | Hallazgos | Decisión del plan |
| --- | --- | --- |
| Proyecto propio con facturación | E3 | G1 |
| Instancia parecida a la de referencia, con copias y cifrado | E2, F3 | G2 |
| Sin contraseñas | E6, F2 | G3 |
| Sin cambiar el acceso a datos | E4, F2 | G4 |
| Esquema y datos | E7 | G5 |
| Limpiar la configuración vieja | E5 | G6 |
| Desplegar la API (más adelante) | F1 | Fuera de este plan |
