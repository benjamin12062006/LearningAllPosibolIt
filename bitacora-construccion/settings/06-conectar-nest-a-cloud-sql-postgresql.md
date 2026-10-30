# 06 — Conectar Nest y sincronizar usuarios en PostgreSQL

Fecha de creación: 2026-10-22
Última actualización: 2026-10-22
Estado: Implementado y verificado localmente; pendiente de configuración, migración y login real en Cloud SQL
Ámbito: conexión Cloud SQL, persistencia del perfil y espacios propios
Relacionada con: [plan previo](../../docs/plans/feature/auth/04-sustituir-turso-por-cloud-sql-postgresql.md), [referencia Go](../../docs/fonts/cloud-sql/01-referencia-go-y-adc.md), [fuentes Node y Prisma](../../docs/fonts/cloud-sql/02-adaptacion-nest-prisma-postgresql.md), [destino Turso anterior](05-usar-turso-en-desarrollo.md).
Revisión de partida: `01a16a43bd61681bef0c603a31d0d2b280e423b3`; únicamente estaba añadido el plan de este mismo trabajo.

## Necesidad y decisiones propuestas

El usuario pide implementar la conexión Nest y que el usuario de Descope se sincronice en PostgreSQL, indicando las variables nuevas del entorno. Solicita adaptar las migraciones al SQL actual de Turso. La eliminación de las tres tablas históricas de Go queda a cargo del usuario, por su última instrucción; este incremento no las elimina.

Se conserva el contrato HTTP y la identidad por emisor/sujeto. Se adapta el conector oficial de Node a Prisma 7.10.0, con un pool compartido y cierre explícito. El schema PostgreSQL activo conserva IDs, fechas y columnas de texto, checks y claves de las migraciones previas; estas se archivan como historia SQLite.

## Evidencia y adaptación

La [referencia Go](../../docs/fonts/cloud-sql/01-referencia-go-y-adc.md) conserva las seis fuentes locales pertinentes y los símbolos consultados. La [ficha Node/Prisma](../../docs/fonts/cloud-sql/02-adaptacion-nest-prisma-postgresql.md) vincula cada decisión con documentación oficial: O1 respalda una historia por proveedor, O4 el conector con `pg`, O5 la composición del pool y O8 la comprobación aislada. No se atribuye el código Nest al instructor de un curso ni se copia la identidad Firebase de Go.

## Implementación

| Decisión | Código y comportamiento |
| --- | --- |
| Conexión propia del runtime con ADC | [createPostgreSqlConnection](../../src/database/postgresql.connection.ts) crea un pool de cinco conexiones a la instancia pública, usa las credenciales `DB_*` y conserva un cierre idempotente del pool/conector. |
| Configuración explícita, sin fallback Turso | [resolveDatabaseConnection](../../src/database/database-connection.ts) exige instancia, base, usuario y contraseña. No recorta la contraseña ni acepta las variables antiguas como destino alternativo. |
| Composición de Nest y Prisma 7.10.0 | [PrismaModule](../../src/database/prisma.module.ts) usa un proveedor asíncrono; [PrismaService](../../src/database/prisma.service.ts) recibe su pool, configura `PrismaPg`, ejecuta `SELECT 1` al iniciar y libera recursos al cerrar o fallar. |
| Misma estructura del producto | [schema](../../prisma/schema.prisma) y [migraciones](../../prisma/migrations) conservan las columnas `TEXT`, identidad única, checks, FK y orden del índice. Se usa el esquema `estadistica_forms`. |
| Historia SQLite conservada en ese momento | `prisma/sqlite-legacy/migrations` guardó los tres SQL anteriores con contenido idéntico al de la revisión de partida. Posteriormente se retiró del árbol; sigue recuperable en el commit `a551ed8`, según la [entrada 09](09-retirar-turso-tras-guardar-restauracion.md). |
| Contratos de usuario y espacios conservados | [UsersRepository](../../src/users/users.repository.ts) usa `IS DISTINCT FROM` y alias PostgreSQL entrecomillados; [StatisticalSpacesRepository](../../src/statistical-spaces/statistical-spaces.repository.ts) comparte el cliente y namespace. Los guards, DTOs y controllers no cambian. |
| Operaciones explícitas | [prisma.config.ts](../../prisma.config.ts) acepta exclusivamente `POSTGRES_MIGRATION_DATABASE_URL` con `schema=estadistica_forms`. [db:check](../../scripts/db/check-postgres.mjs) verifica por lectura el destino y la existencia de la tabla. Migrar sigue siendo una acción aparte del arranque. |
| Entorno documentado | [.env.example](../../.env.example) y [README](../../README.md) explican ADC, contraseña literal, URL codificada, proxy de CLI y los comandos `db:status`, `db:migrate`, `db:check`. El `.env` privado no se modificó. |

Se retiraron las dependencias runtime libSQL y sus scripts/pruebas exclusivos. Su código anterior se recupera en Git; la historia SQL permanece archivada en el árbol actual. Ninguna base de datos ni fila del usuario fue eliminada.

## Comprobación ejecutada

| Comprobación real | Resultado |
| --- | --- |
| Generación de Prisma Client 7.10.0, validación y formato del schema | Correctos para PostgreSQL. |
| `node node_modules/@nestjs/cli/bin/nest.js build` | Correcto. |
| Oxlint con tipos sobre `src/` | Sin diagnósticos; salida 0. |
| Prettier sobre TypeScript de `src/`, configuración, pruebas y script nuevo | Correcto. |
| `node --test --test-concurrency=1 test/*.test.mjs` | 15/15 aprobadas, sin pruebas omitidas: configuración, migraciones/repetición, wiring Nest, perfil, upsert repetido y concurrente, identidad por emisor/sujeto y aislamiento de espacios. |
| Comparación binaria de los tres SQL archivados con `git show HEAD:prisma/migrations/...` | Idénticos. |
| `git diff --check` | Sin incidencias. |
| Comprobación de presencia de variables, sin mostrar sus valores | El `.env` conserva Descope pero todavía no contiene `INSTANCE_CONNECTION_NAME`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` ni `POSTGRES_MIGRATION_DATABASE_URL`. |

Las pruebas arrancan PostgreSQL WASM temporal mediante PGlite/socket y ejecutan Prisma CLI, `pg`, `PrismaPg`, Prisma Client y los repositorios reales. El primer intento quedó limitado por el sandbox al abrir el puerto local; la repetición autorizada sí ejecutó el recorrido completo. Durante la adaptación se corrigieron carpetas de migraciones antiguas vacías y un doble cierre del pool detectado por el wiring de Nest.

PGlite multiplexa sesiones sobre un solo motor. Las peticiones concurrentes verifican el upsert y la unicidad en ese entorno; no son una prueba de carga ni de concurrencia multiproceso en Cloud SQL.

## Pendientes de activación

El usuario debe completar el entorno con credenciales SQL válidas, comprobar ADC y ejecutar las migraciones mediante el proxy indicado en el README. Después puede ejecutar `db:check` y arrancar Nest. La base/instancia fueron verificadas por `gcloud` durante el análisis, pero no se declara conectado el runtime con unas variables que todavía faltan.

No se ejecutaron DDL o escrituras en Cloud SQL ni se hizo login real. No se copiaron filas existentes de Turso: la sincronización en PostgreSQL funciona cuando los usuarios accedan, pero conservar perfiles editados e IDs históricos requiere el traslado de datos previsto en el plan antes del uso real. Las tres tablas Go y sus datos quedaron a cargo del usuario; este trabajo no las eliminó.

Continuación posterior de este mismo día: la [entrada 07](07-aplicar-migraciones-y-verificar-cloud-sql.md) registra la aplicación remota y la comprobación de un usuario ficticio, autorizadas después de cerrar esta entrega local. Los resultados anteriores conservan el estado de ese momento.
