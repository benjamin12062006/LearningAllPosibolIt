# 01 — Cambiar la base de Neon a un Cloud SQL propio

Fecha de creación: 2026-11-08  
Última actualización: 2026-11-08  
Estado: Hecho (2026-11-08). El usuario confirmó la cuenta «My Billing Account», la base vacía y las copias automáticas. [Bitácora 01](../../../../bitacora-construccion/google-cloud/db/01-cloud-sql-propio.md).  
Ámbito: proyecto de Google Cloud nuevo, una instancia de Cloud SQL para PostgreSQL, la conexión local de la API y Prisma. No incluye desplegar la API (Cloud Run, F1).  
Relacionada con: [fuentes 01](../../../fonts/google-cloud/db/01-fuentes-de-cloud-sql-propio.md), [plan que cambió Cloud SQL por Neon](../../config/04-plan-cambiar-cloud-sql-por-neon.md), [plan de cierre del backend](../../feature/cierre-backend/01-plan-cierre-de-pendientes.md) (C6 va después).  
Revisión de referencia: rama `feature/cierre-backend`, `5c276ca`.

## Objetivo

Que la API use una instancia de Cloud SQL para PostgreSQL en un proyecto de Google Cloud solo para ella, con la misma forma que la de `expo-city-bol` pero con copias automáticas y conexiones cifradas, accedida a través de Cloud SQL Auth Proxy con la cuenta de Google y sin contraseñas.

## Decisiones

| ID | Decisión | Respaldo |
| --- | --- | --- |
| G1 | **Proyecto nuevo** `estadistica-forms-api` (nombre visible «Estadistica Forms API»), vinculado a «My Billing Account» (`0138D5-…`), elegida por el usuario. Se habilita solo la Cloud SQL Admin API. | E3 |
| G2 | **Instancia** `estadistica-forms-db` en `us-east4`: PostgreSQL 18, edición Enterprise, `db-f1-micro`, zonal, 10 GB SSD, IP pública **sin redes autorizadas** (solo se entra por el proxy), `--ssl-mode=ENCRYPTED_ONLY`, `cloudsql.iam_authentication=on`, copias automáticas diarias con 7 retenidas y protección contra borrado. Base `estadistica_forms`. | E2, F3 |
| G3 | **Sin contraseñas.** Usuario IAM `benjamin12062006@gmail.com` con `cloudsqlsuperuser`; el proxy se conecta con `--auto-iam-authn`. El usuario `postgres` se queda sin contraseña y no se usa. | E6, F2 |
| G4 | **El código de acceso a datos no cambia.** `DATABASE_URL` apunta al proxy (`postgresql://<usuario IAM codificado>@127.0.0.1:5433/estadistica_forms`). Script `pnpm db:proxy` para arrancarlo en `127.0.0.1:5433` (el `5432` lo usa la conexión de DataGrip a `expo-city-bol`). Se actualizan los comentarios que nombran Neon. | E4, F2 |
| G5 | **Esquema con las 29 migraciones** (`pnpm db:migrate`). **Base vacía**, por decisión del usuario: no se copian datos de Neon. Neon no se borra: sigue con sus datos hasta que el usuario decida. | E7 |
| G6 | En el `.env`: `DATABASE_URL` pasa a la del proxy y la de Neon se guarda como `NEON_DATABASE_URL` (comentada si no se usa); se retiran las variables de la etapa anterior que ya no usa el código. Nada de esto se imprime ni entra en Git. | E5 |

## Etapas

1. ✅ **B1 — Proyecto y facturación:** crear el proyecto, vincular la facturación, habilitar la Cloud SQL Admin API. Comprobación: `gcloud projects describe` y `gcloud billing projects describe`.
2. ✅ **B2 — Instancia, base y usuario IAM:** un comando de creación con las opciones de G2, la base y el usuario IAM. Comprobación: `describe` con estado `RUNNABLE` y las opciones esperadas.
3. ✅ **B3 — Conexión local:** `pnpm db:proxy`, `DATABASE_URL` nueva, `pnpm db:status` → `pnpm db:migrate` → `pnpm db:status`. Comprobación: «Database schema is up to date!» con 29 migraciones.
4. ~~**B4 — Datos**~~: retirada, el usuario eligió empezar con la base vacía.
5. ✅ **B5 — La API contra Cloud SQL:** `pnpm db:check`, `pnpm db:smoke` y arranque real de la API con una lectura. Bitácora cerrada, contexto y `.env.example` actualizados.

## Comprobación prevista

La de cada etapa, la suite completa (sigue en PGlite: no toca la nube) y `pnpm db:verify`. Ningún secreto en Git ni en los documentos.

## Límites

- **Coste:** la instancia, el disco y las copias se facturan mientras existan, aunque no se usen. El precio exacto lo da la calculadora de Google; no se pudo leer de la página de precios.
- Las pruebas de la batería siguen en PGlite y en el contenedor local de C3: nunca contra Cloud SQL.
- Desplegar la API en Cloud Run (F1) es otro plan.
