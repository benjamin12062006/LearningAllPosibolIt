# 01 — Referencia local Go: Cloud SQL, ADC y migraciones

Fecha de creación: 2026-10-22
Tipo de fuente: código propio y documentación histórica de otro proyecto
Origen: `ANGULAR-GO/navigate-business-api`
Fecha de consulta: 2026-10-22
Relacionada con: [plan](../../plans/feature/auth/04-sustituir-turso-por-cloud-sql-postgresql.md), [adaptación Node](02-adaptacion-nest-prisma-postgresql.md), [implementación Nest](../../../bitacora-construccion/settings/06-conectar-nest-a-cloud-sql-postgresql.md).
Revisión consultada: `4b9d0e9`; `internal/config/config.go` tenía un cambio local de puerto, conservado.

## Inventario recuperable

La referencia se consulta en su ubicación real; no se copian sus credenciales ni su autenticación Firebase a Estadística Forms.

| Fuente original consultada | Localizador y utilidad |
| --- | --- |
| [01: Google Auth Admin y SQL Connect](/Users/benji/Documents/ANGULAR-GO/navigate-business-api/docs/fonts/firebase/01-google-auth-admin-y-sql-connect.md) | Tabla «Fuentes y evidencia», O5–O9: separa identidad Google, usuario SQL y migraciones externas. |
| [02: configuración inicial Firebase](/Users/benji/Documents/ANGULAR-GO/navigate-business-api/docs/fonts/firebase/02-whoConectFirebase.md) | Pasos 1–3. Antecedente sin fecha propia; propone un JSON de servicio. No representa la solución ADC posterior ni se adopta su configuración de identidad. |
| [03: conector Go y ADC](/Users/benji/Documents/ANGULAR-GO/navigate-business-api/docs/fonts/firebase/03-conector-cloud-sql-go-adc.md) | «Evidencia» e «Interpretación y límites»: ADC autoriza el canal; usuario/contraseña autentican PostgreSQL. |
| [04: guía reproducible](/Users/benji/Documents/ANGULAR-GO/navigate-business-api/docs/fonts/firebase/04-guia-cloud-sql-go-desde-cero.md) | Secciones 2, 3, 5, 6, 8 y 11: instancia, usuario, `gcloud`, variables, conexión y migraciones. |
| [05: DataGrip y proxy](/Users/benji/Documents/ANGULAR-GO/navigate-business-api/docs/fonts/firebase/05-conexion-datagrip-cloud-sql-mcp.md) | Secciones 3 y 5: proxy TCP y distinción entre conexión local y canal cifrado. Las rutas antiguas `EXPO-GO` son históricas. |
| [06: cuota ADC](/Users/benji/Documents/ANGULAR-GO/navigate-business-api/docs/fonts/firebase/06-contexto-sdk-y-cuota-adc.md) | Líneas 10–30: diagnóstico histórico de `GOOGLE_CLOUD_QUOTA_PROJECT` y contexto Go. El problema de Firebase no se atribuye al SDK Descope. |
| [app.New / App.Close](/Users/benji/Documents/ANGULAR-GO/navigate-business-api/internal/app/app.go:25) | Líneas 30–71: configura pool, conector, `Ping` limitado y cierre. |
| [config.Load](/Users/benji/Documents/ANGULAR-GO/navigate-business-api/internal/config/config.go:20) | Lee `INSTANCE_CONNECTION_NAME` y `DB_*`; Firebase se configura por separado. |
| [Makefile](/Users/benji/Documents/ANGULAR-GO/navigate-business-api/Makefile:6) | `migrate-up` entrega `DATABASE_URL` a `golang-migrate`; la API usa otro mecanismo de conexión. |
| [bitácora de conexión](/Users/benji/Documents/ANGULAR-GO/navigate-business-api/bitacora-construccion/config/02-conexion-cloud-sql-go-adc.md) | «Comprobación»: conexión verificada históricamente en septiembre. |
| [migración real Go](/Users/benji/Documents/ANGULAR-GO/navigate-business-api/bitacora-construccion/auth/06-limpieza-tablas-y-migracion-inicial-real.md:31) | Tablas `public.accounts`, `public.auth_identities` y `public.schema_migrations`; registro histórico de octubre, no inventario SQL actual. |

## Interpretación y adaptación

El mecanismo transferible es configuración validada → credenciales ADC → conector → pool compartido → repositorio → cierre. El conector de Go y `pgx` no son dependencias Node: Nest utiliza las equivalentes oficiales de su plataforma. La elección de Prisma, el esquema `estadistica_forms` y el SQL compatible con el contrato Descope son adaptaciones propias.

La infraestructura compartida no convierte las cuentas Firebase de Go en usuarios Descope. Las migraciones de cada aplicación tienen su propia historia. No se reconstruyeron clases ni se atribuyeron decisiones nuevas a los instructores citados por estos documentos históricos.

## Verificación realizada en esta consulta

`gcloud sql instances describe` confirmó el 2026-10-22 una instancia `POSTGRES_18`, `RUNNABLE`, con nombre `expo-city-bol:us-east4:expo-city-bol-instance` e IP pública habilitada. `gcloud sql databases list` confirmó `expo-city-bol-database`. Son comprobaciones de administración, no una prueba SQL desde Nest. No se consultaron ni copiaron los secretos de `.env` de Go.
