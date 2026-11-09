# 01 — Cambiar la base de Neon a un Cloud SQL propio

Fecha de creación: 2026-11-08  
Última actualización: 2026-11-08  
Estado: Implementado y verificado.  
Relacionada con: [plan 01](../../../docs/plans/google-cloud/db/01-plan-cloud-sql-propio.md) (G1–G6), [fuentes 01](../../../docs/fonts/google-cloud/db/01-fuentes-de-cloud-sql-propio.md), [cambio anterior de Cloud SQL a Neon](../../settings/12-cambiar-cloud-sql-por-neon.md).  
Revisión de partida: rama `feature/cierre-backend`, `5c276ca`.

## Necesidad y autorización

El usuario pide (2026-11-08) cambiar la base de la API de Neon a una instancia de Cloud SQL para PostgreSQL como la de `expo-city-bol`, en un proyecto nuevo solo para esta API, usando `gcloud` desde la terminal. Confirma:

- vincular «My Billing Account», sabiendo que genera coste mensual;
- empezar con la base vacía (sin copiar los datos de Neon);
- activar las copias automáticas (diarias, 7 retenidas).

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| E3 | G1: proyecto propio con «My Billing Account» | `gcloud projects create estadistica-forms-api`, `gcloud billing projects link`, `gcloud services enable sqladmin.googleapis.com` |
| E2, F3 | G2: la forma de la referencia, con copias y cifrado | Un solo `gcloud sql instances create` (abajo) |
| E6, F2 | G3: usuario IAM sin contraseña | `gcloud sql users create benjamin12062006@gmail.com --type=cloud_iam_user --database-roles=cloudsqlsuperuser`; el proxy usa `--auto-iam-authn` |
| E4, F2 | G4: el código de acceso a datos no cambia | [`scripts/db/cloud-sql-proxy.mjs`](../../../scripts/db/cloud-sql-proxy.mjs) y `pnpm db:proxy`; mensajes y comentarios que nombraban Neon |
| E7 | G5: base vacía, por decisión del usuario | Solo `pnpm db:migrate` |
| E5 | G6: `.env` limpio | `DATABASE_URL` al proxy, `NEON_DATABASE_URL` de respaldo, fuera las variables de `expo-city-bol` |

## Lo que se ejecutó

Todo con la cuenta `benjamin12062006@gmail.com`; el proyecto por defecto de `gcloud` sigue siendo `expo-city-bol` (cada comando lleva `--project`).

1. **Proyecto:** `estadistica-forms-api` («Estadistica Forms API», número 758688457791), `ACTIVE`; facturación `billingAccounts/0138D5-6DC475-8D3107` con `billingEnabled: true`; servicio `sqladmin.googleapis.com` habilitado.
2. **Instancia** (9 min, de 22:02:51 a 22:12:07 UTC):

   ```sh
   gcloud sql instances create estadistica-forms-db --project=estadistica-forms-api \
     --database-version=POSTGRES_18 --edition=ENTERPRISE --tier=db-f1-micro \
     --region=us-east4 --availability-type=ZONAL --storage-type=SSD --storage-size=10GB \
     --no-storage-auto-increase --ssl-mode=ENCRYPTED_ONLY \
     --database-flags=cloudsql.iam_authentication=on \
     --backup-start-time=07:00 --retained-backups-count=7 --deletion-protection
   ```

   `describe` confirmó: `estadistica-forms-api:us-east4:estadistica-forms-db`, `RUNNABLE`, `POSTGRES_18`, `ENTERPRISE`, `db-f1-micro`, `ZONAL`, 10 GB `PD_SSD` sin crecimiento automático, copias activas a las 07:00 con 7 retenidas, IP pública **sin redes autorizadas**, `sslMode: ENCRYPTED_ONLY`, `cloudsql.iam_authentication=on` y protección contra borrado.
3. **Base y usuario:** base `estadistica_forms`; usuarios `benjamin12062006@gmail.com` (`CLOUD_IAM_USER`) y `postgres` (`BUILT_IN`, sin contraseña y sin uso).
4. **`.env`** (copia previa guardada fuera del repositorio, en la carpeta temporal de la sesión): `CLOUD_SQL_INSTANCE`, `DATABASE_URL` al proxy con el usuario IAM codificado, `NEON_DATABASE_URL` con la URL anterior; retiradas `GOOGLE_CLOUD_QUOTA_PROJECT`, `INSTANCE_CONNECTION_NAME`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` y `POSTGRES_MIGRATION_DATABASE_URL`. Ningún valor se imprimió. `.env` sigue ignorado por Git.
5. **Proxy** (`pnpm db:proxy`): «Authorizing with Application Default Credentials», «Listening on 127.0.0.1:5433», «ready for new connections».
6. **Migraciones:** `pnpm db:status` (29 encontradas, todas pendientes, datasource `estadistica_forms` en `127.0.0.1:5433`) → `pnpm db:migrate` («All migrations have been successfully applied») → `pnpm db:status` («Database schema is up to date!»).

## Ajustes al escribir el código

- **Puerto 5433**: el 5432 lo usa la conexión de DataGrip a `expo-city-bol`.
- **No se ejecutó `pnpm db:smoke`**: escribe un usuario ficticio y el usuario pidió empezar con la base vacía. La lectura de `pnpm db:check` y el arranque real bastan para comprobar la conexión.
- **La página de Cloud Run (F1) no trata bases de datos**: se usó la de Cloud SQL Auth Proxy (F2) y queda F1 para desplegar la API.
- **El precio no se pudo leer** de la página de precios (llega cortada); el usuario aprobó el coste sabiéndolo.

## Implementación

- `scripts/db/cloud-sql-proxy.mjs` (nuevo) y `package.json` (`db:proxy`).
- `src/database/database-connection.ts` y `postgresql.connection.ts`, `prisma.config.ts`: solo mensajes y comentarios; la validación no cambia (en `127.0.0.1` no se exige `sslmode`, fuera sí).
- `.env.example` y `README.md` («Configurar Cloud SQL»).

## Comprobaciones realmente ejecutadas

2026-11-08.

- `pnpm db:check` contra Cloud SQL: `{"ok":1,"database":"estadistica_forms","user":"benjamin12062006@gmail.com","usersTableExists":true}`.
- **Arranque real** de la API compilada contra Cloud SQL en el puerto 18080: `GET /api/v1/health` → 200 `{"status":"ok"}`; `GET /api/v1/projects` sin sesión → 401; ningún error de los workers. La API y el proxy se pararon después.
- Batería local (no toca la nube): `pnpm db:verify` 3 de 3; `pnpm test:features` 91 suites y 1.514 pruebas, 5 saltadas; `tsc`, `pnpm lint` y Prettier limpios.

## Consecuencias

- **Para usar la API en local hay que abrir antes el proxy** (`pnpm db:proxy`) en otra terminal; `pnpm db:status` y `pnpm db:migrate` también lo necesitan. Las migraciones futuras se aplican así en Cloud SQL, no en Neon.
- **Coste:** la instancia, el disco y las copias se facturan en «My Billing Account» mientras existan.
- **Neon no se tocó**: conserva sus datos y su URL queda en `NEON_DATABASE_URL`. Retirarlo es decisión del usuario.
- **Pendiente:** desplegar la API (Cloud Run, F1) con una cuenta de servicio como usuario IAM, en otro plan.
